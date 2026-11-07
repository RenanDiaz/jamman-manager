/**
 * Undo/Redo Store - History Management
 *
 * This module provides undo/redo functionality for destructive operations.
 * It maintains a history stack and allows users to revert changes.
 *
 * Supported Operations:
 * - Patch deletion (single and batch)
 * - Patch reordering
 * - Patch updates
 * - Backup restore
 *
 * Deletes, updates and backup restores keep their data in main-process snapshots (see
 * `PatchRestore.ts`); actions only hold snapshot ids. The store frees a snapshot as soon as
 * its action leaves the history (trimmed, superseded by a new action, or cleared).
 *
 * Features:
 * - Stack-based history with configurable size
 * - Keyboard shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
 * - Automatic cleanup of old history
 * - Toast notifications for undo/redo actions
 *
 * @module useUndoStore
 */

import { create } from 'zustand';
import { Patch } from '../types';
import { discardSnapshots } from '../utils/undoSnapshots';

/**
 * Undo action types
 */
export type UndoActionType =
  'DELETE_PATCH' | 'DELETE_PATCHES' | 'REORDER_PATCHES' | 'UPDATE_PATCH' | 'RESTORE_BACKUP';

/**
 * Base interface for undo actions
 */
interface BaseUndoAction {
  type: UndoActionType;
  timestamp: number;
  description: string;
}

/**
 * Delete single patch action.
 * `snapshotId` holds the deleted patch (phrases and audio included).
 */
interface DeletePatchAction extends BaseUndoAction {
  type: 'DELETE_PATCH';
  /** JamMan folder the patch was deleted from */
  folder: string;
  directory: string;
  patch?: Patch;
  snapshotId: string;
}

/**
 * Delete multiple patches action.
 * `directories` lists only the patches that were really deleted.
 */
interface DeletePatchesAction extends BaseUndoAction {
  type: 'DELETE_PATCHES';
  folder: string;
  directories: string[];
  patches: Patch[];
  snapshotId: string;
}

/**
 * Reorder patches action
 */
interface ReorderPatchesAction extends BaseUndoAction {
  type: 'REORDER_PATCHES';
  folder: string;
  /** Patches before the reorder; each `dir` is the folder it had then. */
  previousOrder: Patch[];
  /** Patches as sent to `patches:reorder`; each `dir` is the folder the patch had before it. */
  newOrder: Patch[];
}

/**
 * Update patch action.
 * `beforeSnapshotId` holds the patch as it was before the edit. `redoSnapshotId` is filled in
 * when the edit is undone (it captures the edited state); it is `null` when that was not
 * possible, in which case the edit can be undone but not redone.
 */
interface UpdatePatchAction extends BaseUndoAction {
  type: 'UPDATE_PATCH';
  folder: string;
  directory: string;
  beforeSnapshotId: string;
  redoSnapshotId?: string | null;
}

/**
 * Restore backup action.
 * `beforeSnapshotId` holds the whole folder as it was before the restore; `redoSnapshotId`
 * works as in {@link UpdatePatchAction}.
 */
interface RestoreBackupAction extends BaseUndoAction {
  type: 'RESTORE_BACKUP';
  folder: string;
  beforeSnapshotId: string;
  redoSnapshotId?: string | null;
  patchesRestored: number;
}

/**
 * Union type for all undo actions
 */
export type UndoAction =
  | DeletePatchAction
  | DeletePatchesAction
  | ReorderPatchesAction
  | UpdatePatchAction
  | RestoreBackupAction;

/**
 * Ids of the main-process snapshots an action depends on
 */
export const getSnapshotIds = (action: UndoAction): string[] => {
  switch (action.type) {
    case 'DELETE_PATCH':
    case 'DELETE_PATCHES':
      return [action.snapshotId];
    case 'UPDATE_PATCH':
    case 'RESTORE_BACKUP':
      return [action.beforeSnapshotId, ...(action.redoSnapshotId ? [action.redoSnapshotId] : [])];
    default:
      return [];
  }
};

const releaseSnapshots = (actions: UndoAction[]) => {
  discardSnapshots(actions.flatMap(getSnapshotIds));
};

/**
 * Undo store interface
 */
interface UndoStore {
  /** History stack of undoable actions */
  undoStack: UndoAction[];

  /** Redo stack for redoing undone actions */
  redoStack: UndoAction[];

  /** Maximum number of actions to keep in history */
  maxHistorySize: number;

  /**
   * Adds an action to the undo stack
   * @param action - Action to add
   */
  pushUndo: (action: UndoAction) => void;

  /**
   * Undoes the last action
   * @returns The action that was undone, or null if nothing to undo
   */
  undo: () => UndoAction | null;

  /**
   * Redoes the last undone action
   * @returns The action that was redone, or null if nothing to redo
   */
  redo: () => UndoAction | null;

  /**
   * Puts an action whose undo failed back on top of the undo stack (it stays undoable)
   */
  revertUndo: (action: UndoAction) => void;

  /**
   * Puts an action whose redo failed back on top of the redo stack (it stays redoable)
   */
  revertRedo: (action: UndoAction) => void;

  /**
   * Removes an action from both stacks and frees its snapshots. Used when an action can no
   * longer be undone or redone.
   */
  dropAction: (action: UndoAction) => void;

  /**
   * Checks if undo is available
   */
  canUndo: () => boolean;

  /**
   * Checks if redo is available
   */
  canRedo: () => boolean;

  /**
   * Gets a description of the next undo action
   */
  getUndoDescription: () => string | null;

  /**
   * Gets a description of the next redo action
   */
  getRedoDescription: () => string | null;

  /**
   * Clears all history
   */
  clearHistory: () => void;
}

export const useUndoStore = create<UndoStore>((set, get) => ({
  undoStack: [],
  redoStack: [],
  maxHistorySize: 50,

  pushUndo: (action: UndoAction) => {
    const dropped: UndoAction[] = [...get().redoStack]; // a new action invalidates redo

    set(state => {
      const newStack = [...state.undoStack, action];

      // Trim stack if it exceeds max size
      if (newStack.length > state.maxHistorySize) {
        dropped.push(...newStack.splice(0, newStack.length - state.maxHistorySize)); // oldest
      }

      return {
        undoStack: newStack,
        redoStack: [], // Clear redo stack when new action is added
      };
    });

    releaseSnapshots(dropped);
  },

  undo: () => {
    const { undoStack } = get();

    if (undoStack.length === 0) {
      return null;
    }

    const action = undoStack[undoStack.length - 1];

    set(state => ({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, action],
    }));

    return action;
  },

  redo: () => {
    const { redoStack } = get();

    if (redoStack.length === 0) {
      return null;
    }

    const action = redoStack[redoStack.length - 1];

    set(state => ({
      undoStack: [...state.undoStack, action],
      redoStack: state.redoStack.slice(0, -1),
    }));

    return action;
  },

  revertUndo: action => {
    set(state => {
      if (state.redoStack[state.redoStack.length - 1] !== action) return state;
      return {
        undoStack: [...state.undoStack, action],
        redoStack: state.redoStack.slice(0, -1),
      };
    });
  },

  revertRedo: action => {
    set(state => {
      if (state.undoStack[state.undoStack.length - 1] !== action) return state;
      return {
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, action],
      };
    });
  },

  dropAction: action => {
    set(state => ({
      undoStack: state.undoStack.filter(a => a !== action),
      redoStack: state.redoStack.filter(a => a !== action),
    }));
    releaseSnapshots([action]);
  },

  canUndo: () => {
    return get().undoStack.length > 0;
  },

  canRedo: () => {
    return get().redoStack.length > 0;
  },

  getUndoDescription: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return null;
    return undoStack[undoStack.length - 1].description;
  },

  getRedoDescription: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return null;
    return redoStack[redoStack.length - 1].description;
  },

  clearHistory: () => {
    const { undoStack, redoStack } = get();
    set({ undoStack: [], redoStack: [] });
    releaseSnapshots([...undoStack, ...redoStack]);
  },
}));
