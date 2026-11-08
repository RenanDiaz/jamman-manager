/**
 * The JamMan connected over USB: connect, disconnect, status, and the cache of
 * its audio (how much is here, download the rest, cancel a long operation).
 *
 * Reading patches and audio from the pedal goes through the usual channels
 * (`patches:read`, `phrase:getAudioURL`…) with a `jamman-pedal://` path; the
 * channels that cannot work on a pedal yet are refused centrally in
 * `register.ts` (see `PEDAL_AWARE_CHANNELS`).
 *
 * Channels: `pedal:connect`, `pedal:disconnect`, `pedal:status`,
 * `pedal:audioStatus`, `pedal:downloadAudio`, `pedal:cancel`.
 *
 * @module ipc/pedal
 */
import type { IpcHandlers } from '@app/preload/ipc-contract';
import type { IpcDeps } from './deps.js';
import { parseBankPath, PATCH_DIR_RE } from '../usb/pedalPaths.js';

export type PedalChannel =
  | 'pedal:connect'
  | 'pedal:disconnect'
  | 'pedal:status'
  | 'pedal:audioStatus'
  | 'pedal:downloadAudio'
  | 'pedal:cancel'
  | 'pedal:setButton';

function bankOf(bankPath: string) {
  const bank = parseBankPath(bankPath);
  if (!bank) throw new Error('Invalid pedal folder path');
  return bank;
}

export function createPedalHandlers({ pedal }: Pick<IpcDeps, 'pedal'>): IpcHandlers<PedalChannel> {
  return {
    'pedal:connect': () => pedal.connect(),
    'pedal:disconnect': () => pedal.disconnect(),
    'pedal:status': () => pedal.status(),
    'pedal:audioStatus': (bankPath, patches) => {
      if (
        patches !== undefined &&
        (!Array.isArray(patches) || !patches.every(d => PATCH_DIR_RE.test(d)))
      ) {
        throw new Error('Invalid patch directory names');
      }
      return pedal.audioStatus(bankOf(bankPath), patches);
    },
    'pedal:downloadAudio': bankPath => pedal.downloadAudio(bankOf(bankPath)),
    'pedal:cancel': () => pedal.cancel(),
    'pedal:setButton': (button, command) => {
      if (!['left', 'middle', 'right'].includes(button) || typeof command !== 'string') {
        throw new Error('Invalid button setting');
      }
      return pedal.setButton(button, command);
    },
  };
}
