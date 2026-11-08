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
import type { IpcHandlers } from '@app/preload/ipc-contract';
import { PathValidator } from '../PathValidator.js';
import {
  createJammanProtocolHandler,
  JAMMAN_SCHEME,
  toJammanUrl,
  type JammanProtocolLogger,
} from '../security/jammanProtocol.js';
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
  { folderAccess, log }: { folderAccess: FolderAccess; log: JammanProtocolLogger },
) {
  protocol.handle(
    JAMMAN_SCHEME,
    createJammanProtocolHandler({ getAllowedRoot: () => folderAccess.getRoot(), log }),
  );
}

export function createAudioHandlers({
  fs,
  log,
  folderAccess,
}: Pick<IpcDeps, 'fs' | 'log' | 'folderAccess'>): IpcHandlers<AudioChannel> {
  return {
    'phrase:getAudioURL': async filePath => {
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
        const { sampleRate, numberOfChannels, bitsPerSample, duration, container } =
          metadata.format;

        const fileSizeBytes = (await fs.promises.stat(filePath)).size;

        log.info(
          `WAV metadata for ${filePath}: ${container}, ${sampleRate}Hz, ${bitsPerSample}bit, ${numberOfChannels}ch, ${(fileSizeBytes / 1024 / 1024).toFixed(2)}MB`,
        );

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
      } catch (error) {
        // Can't parse metadata, but file might still be playable
        log.warn(`Unable to parse WAV metadata for ${filePath}:`, error);
        return {
          valid: false,
          error: 'Unable to parse WAV file metadata.',
          warning: 'File format could not be validated, but playback will be attempted.',
          canAttemptPlayback: true,
        };
      }
    },

    'audio:readFile': async filePath => {
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
