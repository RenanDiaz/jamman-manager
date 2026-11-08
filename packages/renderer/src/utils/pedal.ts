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
