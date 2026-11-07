/**
 * Renderer-side wrapper around the main process undo snapshots.
 *
 * A snapshot is a copy of patch directories (phrases and audio included) taken before a
 * destructive operation, so it can be undone and redone reliably. The main process owns the
 * data (see `PatchRestore.ts`); the renderer only holds snapshot ids in the undo history.
 *
 * @module undoSnapshots
 */

import { toast } from 'react-toastify';

export type UndoErrorCode =
  'INVALID_ARGUMENT' | 'NOT_FOUND' | 'TOO_LARGE' | 'SLOT_OCCUPIED' | 'WRONG_FOLDER' | 'FAILED';

/**
 * Failure of an undo/redo step. `fatal` means the entry can never work again (its data is gone
 * or belongs to something else), so it is dropped from the history instead of blocking it.
 */
export class UndoError extends Error {
  readonly code: UndoErrorCode;

  constructor(code: UndoErrorCode, message: string) {
    super(message);
    this.name = 'UndoError';
    this.code = code;
  }

  get fatal(): boolean {
    return (
      this.code === 'NOT_FOUND' || this.code === 'WRONG_FOLDER' || this.code === 'INVALID_ARGUMENT'
    );
  }
}

export type SnapshotScope = { kind: 'patches'; patches: string[] } | { kind: 'all' };

/**
 * Takes a snapshot, or returns `null` and tells the user why this action can't be undone.
 * The operation the snapshot protects should go ahead either way: the user already confirmed it.
 */
export const snapshotOrWarn = async (
  folder: string,
  scope: SnapshotScope,
): Promise<string | null> => {
  try {
    const result = await window.electronAPI.createUndoSnapshot(folder, scope);
    if (result.ok) return result.snapshot.id;
    toast.warning(`This action can't be undone: ${result.message}`);
  } catch (error) {
    console.error('Failed to create undo snapshot:', error);
    toast.warning("This action can't be undone: the undo data could not be saved");
  }
  return null;
};

/** Takes a snapshot for a redo; unlike {@link snapshotOrWarn} it stays silent (the caller decides) */
export const snapshotQuietly = async (
  folder: string,
  scope: SnapshotScope,
): Promise<string | null> => {
  try {
    const result = await window.electronAPI.createUndoSnapshot(folder, scope);
    return result.ok ? result.snapshot.id : null;
  } catch (error) {
    console.error('Failed to create undo snapshot:', error);
    return null;
  }
};

/**
 * Restores a snapshot into `folder`.
 * @throws UndoError carrying the main process error code
 */
export const restoreSnapshot = async (
  snapshotId: string,
  folder: string,
  mode: 'add' | 'replace',
  only?: string[],
): Promise<void> => {
  let result;
  try {
    result = await window.electronAPI.restoreUndoSnapshot(snapshotId, folder, mode, only);
  } catch (error) {
    throw new UndoError('FAILED', error instanceof Error ? error.message : 'Unknown error');
  }
  if (!result.ok) throw new UndoError(result.code, result.message);
};

/** Frees snapshots that the undo history no longer references. Never throws. */
export const discardSnapshots = (ids: Array<string | null | undefined>): void => {
  for (const id of new Set(ids)) {
    if (!id) continue;
    Promise.resolve()
      .then(() => window.electronAPI.discardUndoSnapshot(id))
      .catch(error => console.warn('Failed to discard undo snapshot:', error));
  }
};
