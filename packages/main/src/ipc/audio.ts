/**
 * Audio: playback URLs, WAV validation and raw reads, plus the `jamman://`
 * protocol that serves the WAVs to `<audio>`.
 *
 * Channels: `phrase:getAudioURL`, `audio:validateWav`, `audio:readFile`.
 *
 * @module ipc/audio
 */
import * as mm from 'music-metadata';
import type { Protocol } from 'electron';
import type { AudioValidationResult, IpcHandlers } from '@app/preload/ipc-contract';
import { PathValidator } from '../PathValidator.js';
import {
  createJammanProtocolHandler,
  JAMMAN_SCHEME,
  toJammanPedalUrl,
  toJammanUrl,
  type JammanPedalAudio,
  type JammanProtocolLogger,
} from '../security/jammanProtocol.js';
import { isPedalPath, parseWavPath } from '../usb/pedalPaths.js';
import type { FolderAccess } from '../security/folderAccess.js';
import type { IpcDeps } from './deps.js';
import { errorMessage } from './errors.js';

export type AudioChannel = 'phrase:getAudioURL' | 'audio:validateWav' | 'audio:readFile';

/**
 * Registers `jamman://` as a privileged scheme. Must run before `app.ready`.
 * No `bypassCSP`: the CSP allows `media-src jamman:` explicitly.
 *
 * `standard` is required for playback of long WAVs that carry chunks after the
 * audio data (Logic Pro adds `LGWV`, `cue ` and `LIST`). To read them the media
 * stack makes a second range request near the end of the file. With a
 * non-standard scheme every response has an opaque origin, Chromium refuses to
 * mix them in one media resource, and the `<audio>` fails with
 * MEDIA_ERR_SRC_NOT_SUPPORTED. `secure` keeps the app page, a secure context in
 * production (`file://`), from treating the audio as mixed content.
 */
export function registerJammanScheme(protocol: Pick<Protocol, 'registerSchemesAsPrivileged'>) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: JAMMAN_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Serves only `.wav` files inside the approved folder, with range support.
 * Must run after `app.ready`.
 */
export function handleJammanProtocol(
  protocol: Pick<Protocol, 'handle'>,
  {
    folderAccess,
    log,
    pedal,
  }: { folderAccess: FolderAccess; log: JammanProtocolLogger; pedal?: JammanPedalAudio },
) {
  protocol.handle(
    JAMMAN_SCHEME,
    createJammanProtocolHandler({ getAllowedRoot: () => folderAccess.getRoot(), log, pedal }),
  );
}

/** Bytes of a pedal WAV read to validate its format: the header, with room for extra chunks. */
const PEDAL_WAV_HEAD_BYTES = 64 * 1024;

/**
 * Seconds of audio from the `fmt ` and `data` chunks of a WAV header. Used for
 * pedal WAVs, where only the head of the file is read (music-metadata would
 * measure the buffer instead of the file).
 */
export function wavDurationFromHeader(head: Buffer): number | undefined {
  if (head.length < 12 || head.toString('ascii', 0, 4) !== 'RIFF') return undefined;
  let offset = 12;
  let byteRate: number | undefined;
  while (offset + 8 <= head.length) {
    const id = head.toString('ascii', offset, offset + 4);
    const size = head.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 16 <= head.length) {
      byteRate = head.readUInt32LE(offset + 16);
    } else if (id === 'data') {
      return byteRate ? size / byteRate : undefined;
    }
    offset += 8 + size + (size % 2);
  }
  return undefined;
}

type WavFormat = Pick<
  mm.IFormat,
  'container' | 'sampleRate' | 'numberOfChannels' | 'bitsPerSample' | 'duration'
>;

/** Whether a WAV has the format the pedal expects, as the renderer receives it. */
function validationResult(format: WavFormat, fileSizeBytes: number): AudioValidationResult {
  const { sampleRate, numberOfChannels, bitsPerSample, duration, container } = format;
  const isValid =
    container === 'WAVE' &&
    sampleRate === 44100 &&
    bitsPerSample === 16 &&
    (numberOfChannels === 1 || numberOfChannels === 2);

  return {
    valid: isValid,
    sampleRate,
    bitsPerSample,
    numberOfChannels,
    duration,
    fileSizeBytes,
    error: isValid ? null : 'Unsupported WAV format. Expected 44.1kHz, 16-bit, mono/stereo.',
    canAttemptPlayback: true, // Even if format is unexpected, let browser try
  };
}

const UNPARSEABLE_WAV: AudioValidationResult = {
  valid: false,
  error: 'Unable to parse WAV file metadata.',
  warning: 'File format could not be validated, but playback will be attempted.',
  canAttemptPlayback: true,
};

export function createAudioHandlers({
  fs,
  log,
  folderAccess,
  pedal,
}: Pick<IpcDeps, 'fs' | 'log' | 'folderAccess' | 'pedal'>): IpcHandlers<AudioChannel> {
  return {
    'phrase:getAudioURL': async filePath => {
      if (isPedalPath(filePath)) {
        // Only the exact phrase WAV shape; the protocol checks it again per request.
        return parseWavPath(filePath) && pedal.status() ? toJammanPedalUrl(filePath) : null;
      }
      try {
        log.info(`getAudioURL called with filePath: ${filePath}`);

        // Security: Validate filePath
        if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
          log.error('Invalid or empty filePath provided to getAudioURL');
          return null;
        }

        if (!PathValidator.hasAllowedExtension(filePath, ['.wav'])) {
          log.error('Invalid file extension for audio file:', filePath);
          return null;
        }

        // Security: playback is served only from the approved folder
        if (!folderAccess.isInsideRoot(filePath)) {
          log.warn('Audio file is outside the approved folder:', filePath);
          return null;
        }

        if (!PathValidator.pathExists(filePath, 'file')) {
          log.warn(`Audio file not found or is not a file: ${filePath}`);
          return null;
        }

        const url = toJammanUrl(filePath);
        log.info(`Generated audio URL: ${url}`);
        return url;
      } catch (error) {
        log.error('Error getting audio URL:', error);
        return null;
      }
    },

    'audio:validateWav': async filePath => {
      if (isPedalPath(filePath)) {
        const ref = parseWavPath(filePath);
        if (!ref) {
          return { valid: false, error: 'Invalid file path', canAttemptPlayback: false };
        }
        try {
          const { head, size } = await pedal.readWavHead(ref, PEDAL_WAV_HEAD_BYTES);
          const { format } = await mm.parseBuffer(
            head,
            { mimeType: 'audio/wav', size },
            { skipPostHeaders: true },
          );
          return validationResult({ ...format, duration: wavDurationFromHeader(head) }, size);
        } catch (error) {
          log.warn(`Unable to validate pedal WAV ${filePath}:`, error);
          return pedal.status()
            ? UNPARSEABLE_WAV
            : { valid: false, error: 'The pedal is not connected', canAttemptPlayback: false };
        }
      }

      // Security: Validate file path
      if (!filePath || typeof filePath !== 'string') {
        return { valid: false, error: 'Invalid file path', canAttemptPlayback: false };
      }

      if (!PathValidator.hasAllowedExtension(filePath, ['.wav'])) {
        return { valid: false, error: 'Invalid file extension', canAttemptPlayback: false };
      }

      // Security: approved folder or a file the user picked in the dialog
      try {
        folderAccess.assertReadableFile(filePath, ['.wav']);
      } catch {
        return { valid: false, error: 'Access denied', canAttemptPlayback: false };
      }

      if (!PathValidator.pathExists(filePath, 'file')) {
        return { valid: false, error: 'File not found', canAttemptPlayback: false };
      }

      try {
        const metadata = await mm.parseFile(filePath);
        const fileSizeBytes = (await fs.promises.stat(filePath)).size;
        const { sampleRate, numberOfChannels, bitsPerSample, container } = metadata.format;
        log.info(
          `WAV metadata for ${filePath}: ${container}, ${sampleRate}Hz, ${bitsPerSample}bit, ${numberOfChannels}ch, ${(fileSizeBytes / 1024 / 1024).toFixed(2)}MB`,
        );
        return validationResult(metadata.format, fileSizeBytes);
      } catch (error) {
        // Can't parse metadata, but file might still be playable
        log.warn(`Unable to parse WAV metadata for ${filePath}:`, error);
        return UNPARSEABLE_WAV;
      }
    },

    'audio:readFile': async filePath => {
      if (isPedalPath(filePath)) {
        const ref = parseWavPath(filePath);
        if (!ref) throw new Error('Invalid file path');
        return pedal.readWav(ref);
      }

      // Security: Validate file path
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path');
      }

      if (!PathValidator.hasAllowedExtension(filePath, ['.wav'])) {
        throw new Error('Invalid file extension');
      }

      // Security: approved folder or a file the user picked in the dialog
      folderAccess.assertReadableFile(filePath, ['.wav']);

      if (!PathValidator.pathExists(filePath, 'file')) {
        throw new Error('File not found');
      }

      try {
        const buffer = await fs.promises.readFile(filePath);
        log.info(`Read audio file: ${filePath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
        // A Buffer is a Uint8Array; the renderer receives it as one.
        return buffer;
      } catch (error) {
        log.error('Error reading audio file:', error);
        throw new Error(`Failed to read audio file: ${errorMessage(error)}`, { cause: error });
      }
    },
  };
}
