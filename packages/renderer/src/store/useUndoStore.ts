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

/**
 * Undo action types
 */
export type UndoActionType =
  | 'DELETE_PATCH'
  | 'DELETE_PATCHES'
  | 'REORDER_PATCHES'
  | 'UPDATE_PATCH'
  | 'RESTORE_BACKUP';

/**
 * Base interface for undo actions
 */
interface BaseUndoAction {
  type: UndoActionType;
  timestamp: number;
  description: string;
}

/**
 * Delete single patch action
 */
interface DeletePatchAction extends BaseUndoAction {
  type: 'DELETE_PATCH';
  patch: Patch;
  directory: string;
}

/**
 * Delete multiple patches action
 */
interface DeletePatchesAction extends BaseUndoAction {
  type: 'DELETE_PATCHES';
  patches: Patch[];
  directories: string[];
}

/**
 * Reorder patches action
 */
interface ReorderPatchesAction extends BaseUndoAction {
  type: 'REORDER_PATCHES';
  previousOrder: Patch[];
  newOrder: Patch[];
}

/**
 * Update patch action
 */
interface UpdatePatchAction extends BaseUndoAction {
  type: 'UPDATE_PATCH';
  previousPatch: Patch;
  newPatch: Patch;
}

/**
 * Restore backup action
 */
interface RestoreBackupAction extends BaseUndoAction {
  type: 'RESTORE_BACKUP';
  previousPatches: Patch[];
  newPatches: Patch[];
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
    set(state => {
      const newStack = [...state.undoStack, action];

      // Trim stack if it exceeds max size
      if (newStack.length > state.maxHistorySize) {
        newStack.shift(); // Remove oldest action
      }

      return {
        undoStack: newStack,
        redoStack: [], // Clear redo stack when new action is added
      };
    });
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
    set({ undoStack: [], redoStack: [] });
  },
}));
