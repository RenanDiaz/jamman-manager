/**
 * Undo/Redo Handler
 *
 * Coordinates undo/redo actions between the undo store and patch store.
 * Handles execution of undo/redo operations by calling appropriate store methods.
 *
 * How each action is reversed:
 * - REORDER_PATCHES: puts the patches back in the stored order. `patches:reorder` renames
 *   `order[i]` to `Patch{i+1}`, so the order to send is expressed in the folder names the
 *   patches have *now*, not the ones they had when the action was recorded (see
 *   `reorderBetween`).
 * - DELETE_PATCH / DELETE_PATCHES: undo restores the patches (phrases and audio included) from
 *   the snapshot taken before the delete; redo deletes them again and keeps the same snapshot.
 * - UPDATE_PATCH / RESTORE_BACKUP: undo captures the current state into a new snapshot (for
 *   redo) and then restores the snapshot taken before the operation; redo restores the captured
 *   one. If the capture is not possible the action can be undone but not redone.
 *
 * @module undoHandler
 */

import { useUndoStore, UndoAction } from '../store/useUndoStore';
import { usePatchStore } from '../store/usePatchStore';
import {
  UndoError,
  type SnapshotScope,
  discardSnapshots,
  restoreSnapshot,
  snapshotQuietly,
} from './undoSnapshots';
import type { Patch } from '../types';
import { toast } from 'react-toastify';

/** What `executeAction` reports back */
interface ActionOutcome {
  /** False when the action was undone but can't be redone */
  redoable?: boolean;
}

/**
 * Executes an undo operation
 * @returns True if undo was successful, false if nothing to undo
 */
export const executeUndo = async (): Promise<boolean> => {
  const undoStore = useUndoStore.getState();

  if (!undoStore.canUndo()) {
    return false;
  }

  const action = undoStore.undo();
  if (!action) {
    return false;
  }

  try {
    const outcome = await executeAction(action, 'undo');
    if (outcome.redoable === false) {
      undoStore.dropAction(action);
      toast.warning(`Undone: ${action.description} (it can't be redone)`);
    } else {
      toast.info(`Undone: ${action.description}`);
    }
    return true;
  } catch (error) {
    console.error('Error executing undo:', error);
    if (error instanceof UndoError && error.fatal) {
      // Its data is gone: keeping it would block every older action
      undoStore.dropAction(action);
      toast.error(`Can't undo "${action.description}": ${error.message}`);
    } else {
      // Keep it undoable so the user can retry (e.g. after freeing a patch slot)
      undoStore.revertUndo(action);
      toast.error(
        error instanceof UndoError
          ? `Can't undo "${action.description}": ${error.message}`
          : 'Failed to undo action',
      );
    }
    return false;
  }
};

/**
 * Executes a redo operation
 * @returns True if redo was successful, false if nothing to redo
 */
export const executeRedo = async (): Promise<boolean> => {
  const undoStore = useUndoStore.getState();

  if (!undoStore.canRedo()) {
    return false;
  }

  const action = undoStore.redo();
  if (!action) {
    return false;
  }

  try {
    await executeAction(action, 'redo');
    toast.info(`Redone: ${action.description}`);
    return true;
  } catch (error) {
    console.error('Error executing redo:', error);
    if (error instanceof UndoError && error.fatal) {
      undoStore.dropAction(action);
      toast.error(`Can't redo "${action.description}": ${error.message}`);
    } else {
      undoStore.revertRedo(action);
      toast.error(
        error instanceof UndoError
          ? `Can't redo "${action.description}": ${error.message}`
          : 'Failed to redo action',
      );
    }
    return false;
  }
};

/**
 * Makes sure the action belongs to the folder that is open now
 * @throws UndoError (fatal) when it does not
 */
const requireSameFolder = (folder: string): void => {
  if (usePatchStore.getState().currentFolder !== folder) {
    throw new UndoError('WRONG_FOLDER', 'It belongs to a different JamMan folder');
  }
};

const patchDirName = (position: number): string => `Patch${String(position).padStart(2, '0')}`;

/**
 * Works out the order to send to `patches:reorder` to turn the layout `from` into `to`.
 *
 * `from` and `to` hold the same patches (identified by the `dir` they had when the action
 * was recorded). `patches:reorder` renames `order[i]` to `Patch{i+1}`, so after applying
 * either side the patch at index `i` of that side lives in folder `Patch{i+1}`. Sending the
 * old folder names of `to` would therefore be the identity; each patch has to be named by
 * the folder it occupies in `from`.
 *
 * @throws UndoError (fatal) when the folders on disk no longer match `from`
 */
const reorderBetween = (from: Patch[], to: Patch[]): Patch[] => {
  const expected = from.map((_, i) => patchDirName(i + 1));
  const actual = usePatchStore
    .getState()
    .patches.map(p => p.dir)
    .sort();
  if (actual.length !== expected.length || actual.some((dir, i) => dir !== expected[i])) {
    throw new UndoError('NOT_FOUND', 'The patches changed after the reorder');
  }
  return to.map(patch => {
    const position = from.findIndex(candidate => candidate.dir === patch.dir);
    if (position === -1) {
      throw new UndoError('NOT_FOUND', 'The patches changed after the reorder');
    }
    return { ...patch, dir: expected[position] };
  });
};

/**
 * Restores the state before an UPDATE_PATCH / RESTORE_BACKUP (undo) or after it (redo)
 */
const swapSnapshot = async (
  action: Extract<UndoAction, { type: 'UPDATE_PATCH' | 'RESTORE_BACKUP' }>,
  direction: 'undo' | 'redo',
): Promise<ActionOutcome> => {
  const { folder } = action;
  requireSameFolder(folder);
  const scope: SnapshotScope =
    action.type === 'UPDATE_PATCH'
      ? { kind: 'patches', patches: [action.directory] }
      : { kind: 'all' };

  if (direction === 'redo') {
    if (!action.redoSnapshotId) {
      throw new UndoError('NOT_FOUND', 'The state to redo was not saved');
    }
    await restoreSnapshot(action.redoSnapshotId, folder, 'replace');
    await usePatchStore.getState().loadPatches(folder, true);
    return {};
  }

  // Undo: capture the current state first so it can be redone, then go back
  const captured = await snapshotQuietly(folder, scope);
  await restoreSnapshot(action.beforeSnapshotId, folder, 'replace');
  discardSnapshots([action.redoSnapshotId]); // from an earlier undo/redo cycle
  action.redoSnapshotId = captured;
  await usePatchStore.getState().loadPatches(folder, true);
  return { redoable: captured !== null };
};

/**
 * Executes an undo/redo action by calling appropriate store methods
 * @param action - Action to execute
 * @param direction - Whether this is an undo or redo operation
 */
const executeAction = async (
  action: UndoAction,
  direction: 'undo' | 'redo',
): Promise<ActionOutcome> => {
  const patchStore = usePatchStore.getState();

  switch (action.type) {
    case 'REORDER_PATCHES': {
      requireSameFolder(action.folder);
      // Undo goes from the new layout back to the previous one; redo the other way round
      const order =
        direction === 'undo'
          ? reorderBetween(action.newOrder, action.previousOrder)
          : reorderBetween(action.previousOrder, action.newOrder);
      await patchStore.reorderPatches(order, true); // skipUndo = true
      return {};
    }

    case 'DELETE_PATCH': {
      requireSameFolder(action.folder);
      if (direction === 'undo') {
        await restoreSnapshot(action.snapshotId, action.folder, 'add');
        await patchStore.loadPatches(action.folder, true);
      } else {
        await patchStore.deletePatch(action.directory, true); // skipUndo = true
      }
      return {};
    }

    case 'DELETE_PATCHES': {
      requireSameFolder(action.folder);
      if (direction === 'undo') {
        await restoreSnapshot(action.snapshotId, action.folder, 'add', action.directories);
        await patchStore.loadPatches(action.folder, true);
      } else {
        await patchStore.deletePatches(action.directories, true); // skipUndo = true
      }
      return {};
    }

    case 'UPDATE_PATCH':
    case 'RESTORE_BACKUP':
      return swapSnapshot(action, direction);

    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unknown action type: ${(exhaustiveCheck as UndoAction).type}`);
    }
  }
};

/**
 * Checks if undo is available
 */
export const canUndo = (): boolean => {
  return useUndoStore.getState().canUndo();
};

/**
 * Checks if redo is available
 */
export const canRedo = (): boolean => {
  return useUndoStore.getState().canRedo();
};

/**
 * Gets description of next undo action
 */
export const getUndoDescription = (): string | null => {
  return useUndoStore.getState().getUndoDescription();
};

/**
 * Gets description of next redo action
 */
export const getRedoDescription = (): string | null => {
  return useUndoStore.getState().getRedoDescription();
};
