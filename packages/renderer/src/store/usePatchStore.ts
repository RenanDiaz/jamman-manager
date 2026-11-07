/**
 * Patch Store - Centralized State Management
 *
 * This module provides Zustand-based state management for JamMan patches.
 * It handles loading, creating, updating, deleting, and reordering patches,
 * as well as multi-select operations and folder persistence.
 *
 * Features:
 * - Automatic last folder persistence via localStorage
 * - Multi-select with click/shift-click/cmd-click support
 * - Optimistic updates with error rollback
 * - Toast notifications for all operations
 *
 * @module usePatchStore
 */

import { create } from 'zustand';
import { Patch } from '../types';
import { toast } from 'react-toastify';
import { performanceMonitor } from '../utils/performance';
import { useUndoStore } from './useUndoStore';
import { discardSnapshots, snapshotOrWarn } from '../utils/undoSnapshots';

/** LocalStorage key for persisting last folder */
const LAST_FOLDER_KEY = 'jamman-manager-last-folder';

/**
 * Saves the last opened folder to localStorage for auto-loading on next launch
 * @param folder - Folder path to save
 */
const saveLastFolder = (folder: string) => {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, folder);
  } catch (error) {
    console.warn('Failed to save last folder to localStorage:', error);
  }
};

/**
 * Retrieves the last opened folder from localStorage
 * @returns Last folder path, or null if none saved
 */
const getLastFolder = (): string | null => {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY);
  } catch (error) {
    console.warn('Failed to retrieve last folder from localStorage:', error);
    return null;
  }
};

/**
 * Patch store interface defining all state and actions
 */
interface PatchStore {
  // ==================== State ====================

  /** Currently opened JamMan folder path */
  currentFolder: string | null;

  /** Array of loaded patches with metadata */
  patches: Patch[];

  /** Loading state for async operations */
  loading: boolean;

  /** Total size of the current folder in bytes */
  folderSizeBytes: number | null;

  /** Currently selected patch for editing (single selection) */
  selectedPatch: Patch | undefined;

  /** Array of selected patch directories for multi-select operations */
  selectedPatchDirs: string[];

  // ==================== Simple Setters ====================

  /**
   * Sets the current folder path
   * @param folder - Folder path or null to clear
   */
  setCurrentFolder: (folder: string | null) => void;

  /**
   * Sets the patches array
   * @param patches - Array of patch objects
   */
  setPatches: (patches: Patch[]) => void;

  /**
   * Sets the loading state
   * @param loading - Whether operations are in progress
   */
  setLoading: (loading: boolean) => void;

  /**
   * Sets the selected patch for editing
   * @param patch - Patch object or undefined to clear
   */
  setSelectedPatch: (patch: Patch | undefined) => void;

  // ==================== Multi-Select Actions ====================

  /**
   * Toggles selection state for a single patch
   * @param dir - Patch directory name
   */
  toggleSelection: (dir: string) => void;

  /**
   * Selects a range of patches (for shift-click behavior)
   * @param startDir - Starting patch directory name
   * @param endDir - Ending patch directory name
   */
  selectRange: (startDir: string, endDir: string) => void;

  /**
   * Clears all multi-select selections
   */
  clearSelection: () => void;

  /**
   * Selects all patches in the current folder
   */
  selectAll: () => void;

  // ==================== Async Operations ====================

  /**
   * Loads patches from the specified folder
   * @param folder - JamMan folder path
   * @param update - If true, suppresses success toast (for refresh operations)
   */
  loadPatches: (folder: string, update?: boolean) => Promise<void>;

  /**
   * Creates a new patch with the specified data
   * @param data - Patch payload with metadata and phrases
   */
  createPatch: (data: unknown) => Promise<void>;

  /**
   * Updates an existing patch. The edit is undoable (the previous state is snapshotted first).
   * @param data - Patch payload with updated metadata
   */
  updatePatch: (data: unknown) => Promise<void>;

  /**
   * Deletes a single patch. The delete is undoable (the patch is snapshotted first).
   * @param directory - Patch directory name
   * @param skipUndo - If true, doesn't create undo entry (for redo)
   */
  deletePatch: (directory: string, skipUndo?: boolean) => Promise<void>;

  /**
   * Deletes multiple patches in a batch operation. The delete is undoable.
   * @param directories - Array of patch directory names
   * @param skipUndo - If true, doesn't create undo entry (for redo)
   */
  deletePatches: (directories: string[], skipUndo?: boolean) => Promise<void>;

  /**
   * Restores a backup into the current folder. The whole folder is snapshotted first so the
   * restore can be undone.
   * @param backupPath - Backup ZIP file
   * @param mode - 'replace' wipes the folder first, 'merge' adds with auto-renumbering
   * @returns Restore result from the main process
   */
  restoreBackup: (
    backupPath: string,
    mode: 'replace' | 'merge',
  ) => Promise<{ success: boolean; patchesRestored: number }>;

  /**
   * Reorders patches by renaming directories
   * Uses optimistic updates with rollback on error
   * @param newOrder - Array of patches in desired order
   * @param skipUndo - If true, doesn't create undo entry (for undo/redo operations)
   */
  reorderPatches: (newOrder: Patch[], skipUndo?: boolean) => Promise<void>;

  // ==================== Utility ====================

  /**
   * Clears all patches and folder state
   */
  clearPatches: () => void;

  /**
   * Gets the last opened folder from localStorage
   * @returns Last folder path or null
   */
  getLastFolder: () => string | null;

  /**
   * Attempts to automatically load the last opened folder on app launch
   * @returns Promise resolving to true if successful, false otherwise
   */
  tryLoadLastFolder: () => Promise<boolean>;
}

export const usePatchStore = create<PatchStore>((set, get) => ({
  // Initial state
  currentFolder: null,
  patches: [],
  loading: false,
  selectedPatch: undefined,
  selectedPatchDirs: [],
  folderSizeBytes: null,

  // Simple setters
  setCurrentFolder: folder => set({ currentFolder: folder }),
  setPatches: patches => set({ patches }),
  setLoading: loading => set({ loading }),
  setSelectedPatch: patch => set({ selectedPatch: patch }),

  // Multi-select actions
  toggleSelection: (dir: string) => {
    const { selectedPatchDirs } = get();
    const isSelected = selectedPatchDirs.includes(dir);

    if (isSelected) {
      set({ selectedPatchDirs: selectedPatchDirs.filter(d => d !== dir) });
    } else {
      set({ selectedPatchDirs: [...selectedPatchDirs, dir] });
    }
  },

  selectRange: (startDir: string, endDir: string) => {
    const { patches, selectedPatchDirs } = get();
    const startIndex = patches.findIndex(p => p.dir === startDir);
    const endIndex = patches.findIndex(p => p.dir === endDir);

    if (startIndex === -1 || endIndex === -1) return;

    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);

    const rangeSelection = patches.slice(minIndex, maxIndex + 1).map(p => p.dir);

    // Merge with existing selection
    const newSelection = Array.from(new Set([...selectedPatchDirs, ...rangeSelection]));
    set({ selectedPatchDirs: newSelection });
  },

  clearSelection: () => {
    set({ selectedPatchDirs: [] });
  },

  selectAll: () => {
    const { patches } = get();
    set({ selectedPatchDirs: patches.map(p => p.dir) });
  },

  // Async operations
  loadPatches: async (folder: string, update = false) => {
    // Undo entries refer to a specific folder; they make no sense once another one is opened
    const previousFolder = get().currentFolder;
    if (previousFolder && previousFolder !== folder) {
      useUndoStore.getState().clearHistory();
    }

    try {
      set({ loading: true });
      if (!update) set({ patches: [] });

      const result = await performanceMonitor.measure('loadPatches', () =>
        window.electronAPI.readPatches(folder),
      );
      console.log(result);

      set({ patches: result, currentFolder: folder });

      // Calculate folder size
      try {
        const folderSize = await window.electronAPI.getFolderSize(folder);
        set({ folderSizeBytes: folderSize.sizeBytes });
      } catch (error) {
        console.warn('Failed to calculate folder size:', error);
        set({ folderSizeBytes: null });
      }

      // Save to localStorage for auto-load on next launch
      saveLastFolder(folder);

      if (!update) {
        toast.success(`Successfully loaded ${result.length} patches`);
      }
    } catch (error) {
      console.error('Error loading patches:', error);
      toast.error('Failed to load patches. Please check the folder and try again.');
    } finally {
      set({ loading: false });
    }
  },

  createPatch: async (data: unknown) => {
    const { currentFolder, loadPatches } = get();
    if (!currentFolder) return;

    try {
      set({ loading: true });
      await window.electronAPI.createPatch(
        data as Parameters<typeof window.electronAPI.createPatch>[0],
      );
      toast.success('Patch created successfully');
      await loadPatches(currentFolder, true);
    } catch (error) {
      console.error('Error creating patch:', error);
      toast.error('Failed to create patch. Please try again.');
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  updatePatch: async (data: unknown) => {
    const { currentFolder, loadPatches } = get();
    if (!currentFolder) return;

    const directory = (data as { directory?: string }).directory;
    // Snapshot the patch as it is now (audio included) so the edit can be undone
    const snapshotId = directory
      ? await snapshotOrWarn(currentFolder, { kind: 'patches', patches: [directory] })
      : null;

    try {
      set({ loading: true });
      await window.electronAPI.updatePatch(
        data as Parameters<typeof window.electronAPI.updatePatch>[0],
      );
      if (snapshotId && directory) {
        useUndoStore.getState().pushUndo({
          type: 'UPDATE_PATCH',
          timestamp: Date.now(),
          description: `Edit ${directory}`,
          folder: currentFolder,
          directory,
          beforeSnapshotId: snapshotId,
        });
      }
      toast.success('Patch updated successfully');
      await loadPatches(currentFolder, true);
    } catch (error) {
      discardSnapshots([snapshotId]);
      console.error('Error updating patch:', error);
      toast.error('Failed to update patch. Please try again.');
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  deletePatch: async (directory: string, skipUndo = false) => {
    const { currentFolder, loadPatches, patches } = get();
    if (!currentFolder) return;

    // Snapshot first: it is the only copy of the patch's phrases and audio once it is deleted
    const snapshotId = skipUndo
      ? null
      : await snapshotOrWarn(currentFolder, { kind: 'patches', patches: [directory] });

    try {
      set({ loading: true });
      await window.electronAPI.deletePatch(currentFolder, directory);
      if (snapshotId) {
        useUndoStore.getState().pushUndo({
          type: 'DELETE_PATCH',
          timestamp: Date.now(),
          description: `Delete ${directory}`,
          folder: currentFolder,
          directory,
          patch: patches.find(p => p.dir === directory),
          snapshotId,
        });
      }
      toast.success(`Successfully deleted ${directory}`);
      await loadPatches(currentFolder, true);
    } catch (error) {
      discardSnapshots([snapshotId]);
      console.error('Error deleting patch:', error);
      toast.error('Failed to delete patch. Please try again.');
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  deletePatches: async (directories: string[], skipUndo = false) => {
    const { currentFolder, loadPatches, patches } = get();
    if (!currentFolder) return;

    // Only real patch folders that exist can be snapshotted (the list can also hold the
    // short-lived `__deleted_*` folders the main process leaves after a delete)
    const existing = directories.filter(
      dir => /^Patch\d{2}$/.test(dir) && patches.some(p => p.dir === dir),
    );
    const snapshotId =
      skipUndo || existing.length === 0
        ? null
        : await snapshotOrWarn(currentFolder, { kind: 'patches', patches: existing });

    try {
      set({ loading: true });
      const result = await window.electronAPI.deletePatchBatch(currentFolder, directories);

      if (result.success) {
        const deletedCount = result.deleted.length;
        const failedCount = result.failed;

        // The batch can partly fail: undo only what was really deleted
        if (snapshotId && deletedCount > 0) {
          useUndoStore.getState().pushUndo({
            type: 'DELETE_PATCHES',
            timestamp: Date.now(),
            description: `Delete ${deletedCount} patches`,
            folder: currentFolder,
            directories: result.deleted,
            patches: patches.filter(p => result.deleted.includes(p.dir)),
            snapshotId,
          });
        } else {
          discardSnapshots([snapshotId]);
        }

        if (failedCount > 0) {
          toast.warning(`Deleted ${deletedCount} patches successfully, but ${failedCount} failed.`);
        } else {
          toast.success(`Successfully deleted ${deletedCount} patches`);
        }

        await loadPatches(currentFolder, true);
        // Clear selection after successful delete
        set({ selectedPatchDirs: [] });
      } else {
        discardSnapshots([snapshotId]);
      }
    } catch (error) {
      discardSnapshots([snapshotId]);
      console.error('Error deleting patches:', error);
      toast.error('Failed to delete patches. Please try again.');
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  restoreBackup: async (backupPath: string, mode: 'replace' | 'merge') => {
    const { currentFolder, loadPatches } = get();
    if (!currentFolder) throw new Error('No folder loaded');

    // Snapshot the whole folder (patches and playlists): replace mode wipes it
    const snapshotId = await snapshotOrWarn(currentFolder, { kind: 'all' });

    const pushRestoreUndo = (description: string, patchesRestored: number) => {
      if (!snapshotId) return;
      useUndoStore.getState().pushUndo({
        type: 'RESTORE_BACKUP',
        timestamp: Date.now(),
        description,
        folder: currentFolder,
        beforeSnapshotId: snapshotId,
        patchesRestored,
      });
    };

    try {
      const result = await window.electronAPI.restoreBackup(backupPath, currentFolder, mode);
      if (result.success) {
        pushRestoreUndo(`Restore backup (${mode})`, result.patchesRestored);
      } else {
        discardSnapshots([snapshotId]);
      }
      await loadPatches(currentFolder, true);
      return result;
    } catch (error) {
      // A restore that fails half way can already have removed patches: keep the snapshot
      // reachable so the user can still get back to where they were.
      pushRestoreUndo(`Restore backup (${mode}, failed)`, 0);
      await loadPatches(currentFolder, true);
      throw error;
    }
  },

  reorderPatches: async (newOrder: Patch[], skipUndo = false) => {
    const { currentFolder, loadPatches, patches } = get();
    if (!currentFolder) return;

    // Store previous order for undo (before reordering)
    const previousOrder = [...patches];

    // Optimistic update
    set({ patches: newOrder });

    try {
      set({ loading: true });
      await performanceMonitor.measure('reorderPatches', () =>
        window.electronAPI.reorderPatches(
          currentFolder,
          newOrder.map(p => p.dir),
        ),
      );

      // Push undo action after successful reorder (unless we're executing an undo/redo)
      if (!skipUndo) {
        useUndoStore.getState().pushUndo({
          type: 'REORDER_PATCHES',
          timestamp: Date.now(),
          description: `Reorder ${newOrder.length} patches`,
          previousOrder,
          newOrder,
        });
      }

      toast.success('Successfully reordered patches');
      await loadPatches(currentFolder, true);
      // Clear selection after successful reorder
      set({ selectedPatchDirs: [] });
    } catch (error) {
      console.error('Error reordering patches:', error);
      toast.error('Failed to reorder patches. Please try again.');
      // Revert to original order on error
      await loadPatches(currentFolder, true);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  clearPatches: () => {
    set({ patches: [], currentFolder: null, selectedPatchDirs: [], folderSizeBytes: null });
  },

  // Get last folder from localStorage
  getLastFolder: () => {
    return getLastFolder();
  },

  // Try to auto-load the last folder
  tryLoadLastFolder: async () => {
    const lastFolder = getLastFolder();
    if (!lastFolder) {
      return false;
    }

    try {
      const { loadPatches } = get();
      await loadPatches(lastFolder);
      return true;
    } catch (error) {
      console.warn('Failed to auto-load last folder:', error);
      return false;
    }
  },
}));
