/**
 * Folder paths of a pedal connected over USB.
 *
 * For a pedal bank the main process hands out `jamman-pedal://<bank>` instead
 * of a disk path (see `PedalBankInfo.path`). The renderer only needs to tell
 * them apart and label them; the main process validates them.
 */
import type { PedalBankId, PedalInfo } from '@app/preload/ipc-contract';

const PEDAL_PATH_PREFIX = 'jamman-pedal://';

export function isPedalPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.startsWith(PEDAL_PATH_PREFIX);
}

export const BANK_LABELS: Record<PedalBankId, string> = {
  internal: 'Internal memory',
  sd: 'SD card',
};

/** "JamMan Stereo (USB), SD card" for a pedal path; null for a disk folder. */
export function pedalFolderLabel(path: string | null, pedal: PedalInfo | null): string | null {
  if (!isPedalPath(path)) return null;
  const bank = pedal?.banks.find(b => b.path === path);
  const bankLabel = bank ? BANK_LABELS[bank.id] : path;
  return `${pedal?.name ?? 'JamMan'} (USB), ${bankLabel}`;
}

/** Measured on a JamMan Stereo: reading ~1.3 MB/s, writing ~1.5 MB/s. */
const BYTES_PER_SECOND = { download: 1.3e6, upload: 1.5e6 } as const;

/** "about 3 minutes", "less than a minute": how long a transfer over USB takes. */
export function transferTime(bytes: number, direction: keyof typeof BYTES_PER_SECOND): string {
  const minutes = bytes / BYTES_PER_SECOND[direction] / 60;
  if (minutes < 1) return 'less than a minute';
  const rounded = Math.round(minutes);
  return `about ${rounded} minute${rounded === 1 ? '' : 's'}`;
}

/** Whether an IPC error is the user stopping a pedal operation. */
export function isCanceled(error: unknown): boolean {
  return error instanceof Error && /\bCanceled\b/.test(error.message);
}
