/**
 * Undo/Redo Handler
 *
 * Coordinates undo/redo actions between the undo store and patch store.
 * Handles execution of undo/redo operations by calling appropriate store methods.
 *
 * @module undoHandler
 */

import { useUndoStore, UndoAction } from '../store/useUndoStore';
import { usePatchStore } from '../store/usePatchStore';
import { toast } from 'react-toastify';

/**
 * Executes an undo operation
 * @returns True if undo was successful, false if nothing to undo
 */
export const executeUndo = async (): Promise<boolean> => {
  const undoStore = useUndoStore.getState();
  const patchStore = usePatchStore.getState();

  if (!undoStore.canUndo()) {
    return false;
  }

  const action = undoStore.undo();
  if (!action) {
    return false;
  }

  try {
    await executeAction(action, 'undo');
    toast.info(`Undone: ${action.description}`);
    return true;
  } catch (error) {
    console.error('Error executing undo:', error);
    toast.error('Failed to undo action');
    // Push action back to undo stack if it failed
    undoStore.pushUndo(action);
    return false;
  }
};

/**
 * Executes a redo operation
 * @returns True if redo was successful, false if nothing to redo
 */
export const executeRedo = async (): Promise<boolean> => {
  const undoStore = useUndoStore.getState();
  const patchStore = usePatchStore.getState();

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
    toast.error('Failed to redo action');
    return false;
  }
};

/**
 * Executes an undo/redo action by calling appropriate store methods
 * @param action - Action to execute
 * @param direction - Whether this is an undo or redo operation
 */
const executeAction = async (action: UndoAction, direction: 'undo' | 'redo'): Promise<void> => {
  const patchStore = usePatchStore.getState();

  switch (action.type) {
    case 'REORDER_PATCHES': {
      // For undo, restore previous order; for redo, restore new order
      const targetOrder = direction === 'undo' ? action.previousOrder : action.newOrder;
      await patchStore.reorderPatches(targetOrder, true); // skipUndo = true
      break;
    }

    case 'DELETE_PATCH': {
      // TODO: Implement patch restoration from backup
      throw new Error('Undo for delete operations not yet implemented');
    }

    case 'DELETE_PATCHES': {
      // TODO: Implement batch patch restoration from backup
      throw new Error('Undo for batch delete operations not yet implemented');
    }

    case 'UPDATE_PATCH': {
      // TODO: Implement patch update undo
      throw new Error('Undo for update operations not yet implemented');
    }

    case 'RESTORE_BACKUP': {
      // TODO: Implement backup restore undo
      throw new Error('Undo for backup restore not yet implemented');
    }

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
