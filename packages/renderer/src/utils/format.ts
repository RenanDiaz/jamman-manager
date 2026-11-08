/** Presentation helpers shared by the main screen. */

/** Human-readable size: KB below 1 MB, MB below 1 GB, then GB. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

/** Seconds as M:SS, or `-:--` when unknown. */
export const formatTime = (seconds: number | null): string => {
  if (seconds === null || !isFinite(seconds)) return '-:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/** Two-digit slot number of a `PatchNN` folder, or `--`. */
export const slotNumber = (dir: string): string =>
  dir.match(/(\d{1,2})$/)?.[1].padStart(2, '0') ?? '--';

/** `PatchNN` folder for a slot from 1 to 99. */
export const patchDirForSlot = (slot: number): string => `Patch${String(slot).padStart(2, '0')}`;

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);

/** Shortcut label for the current platform, e.g. `⌘O` or `Ctrl+O`. */
export const shortcut = (key: string, { shift = false } = {}): string =>
  isMac ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;

/** Last part of a path, with either separator (paths come from macOS or Windows). */
export const fileName = (path: string): string => path.split(/[\\/]/).pop() || path;
