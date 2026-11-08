/**
 * The JamMan connected over USB: connect, disconnect and status.
 *
 * Reading patches and audio from the pedal goes through the usual channels
 * (`patches:read`, `phrase:getAudioURL`…) with a `jamman-pedal://` path; the
 * channels that cannot work on a pedal yet are refused centrally in
 * `register.ts` (see `PEDAL_AWARE_CHANNELS`).
 *
 * Channels: `pedal:connect`, `pedal:disconnect`, `pedal:status`.
 *
 * @module ipc/pedal
 */
import type { IpcHandlers } from '@app/preload/ipc-contract';
import type { IpcDeps } from './deps.js';

export type PedalChannel = 'pedal:connect' | 'pedal:disconnect' | 'pedal:status';

export function createPedalHandlers({ pedal }: Pick<IpcDeps, 'pedal'>): IpcHandlers<PedalChannel> {
  return {
    'pedal:connect': () => pedal.connect(),
    'pedal:disconnect': () => pedal.disconnect(),
    'pedal:status': () => pedal.status(),
  };
}
