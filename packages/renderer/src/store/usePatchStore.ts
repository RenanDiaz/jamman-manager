import { create } from 'zustand';
import { Patch } from '../types';
import { toast } from 'react-toastify';

// LocalStorage key for persisting last folder
const LAST_FOLDER_KEY = 'jamman-manager-last-folder';

// Helper functions for localStorage
const saveLastFolder = (folder: string) => {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, folder);
  } catch (error) {
    console.warn('Failed to save last folder to localStorage:', error);
  }
};

const getLastFolder = (): string | null => {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY);
  } catch (error) {
    console.warn('Failed to retrieve last folder from localStorage:', error);
    return null;
  }
};

interface PatchStore {
  // State
  currentFolder: string | null;
  patches: Patch[];
  loading: boolean;
  selectedPatch: Patch | undefined;
  selectedPatchDirs: string[];

  // Actions
  setCurrentFolder: (folder: string | null) => void;
  setPatches: (patches: Patch[]) => void;
  setLoading: (loading: boolean) => void;
  setSelectedPatch: (patch: Patch | undefined) => void;

  // Multi-select actions
  toggleSelection: (dir: string) => void;
  selectRange: (startDir: string, endDir: string) => void;
  clearSelection: () => void;
  selectAll: () => void;

  // Async operations
  loadPatches: (folder: string, update?: boolean) => Promise<void>;
  createPatch: (data: any) => Promise<void>;
  updatePatch: (data: any) => Promise<void>;
  deletePatch: (directory: string) => Promise<void>;
  deletePatches: (directories: string[]) => Promise<void>;
  reorderPatches: (newOrder: Patch[]) => Promise<void>;

  // Utility
  clearPatches: () => void;
  getLastFolder: () => string | null;
  tryLoadLastFolder: () => Promise<boolean>;
}

export const usePatchStore = create<PatchStore>((set, get) => ({
  // Initial state
  currentFolder: null,
  patches: [],
  loading: false,
  selectedPatch: undefined,
  selectedPatchDirs: [],

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
    try {
      set({ loading: true });
      if (!update) set({ patches: [] });

      const result = await window.electronAPI.readPatches(folder);
      console.log(result);

      set({ patches: result, currentFolder: folder });

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

  createPatch: async (data: any) => {
    const { currentFolder, loadPatches } = get();
    if (!currentFolder) return;

    try {
      set({ loading: true });
      await window.electronAPI.createPatch(data);
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

  updatePatch: async (data: any) => {
    const { currentFolder, loadPatches } = get();
    if (!currentFolder) return;

    try {
      set({ loading: true });
      await window.electronAPI.updatePatch(data);
      toast.success('Patch updated successfully');
      await loadPatches(currentFolder, true);
    } catch (error) {
      console.error('Error updating patch:', error);
      toast.error('Failed to update patch. Please try again.');
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  deletePatch: async (directory: string) => {
    const { currentFolder, loadPatches } = get();
    if (!currentFolder) return;

    try {
      set({ loading: true });
      await window.electronAPI.deletePatch(currentFolder, directory);
      toast.success(`Successfully deleted ${directory}`);
      await loadPatches(currentFolder, true);
    } catch (error) {
      console.error('Error deleting patch:', error);
      toast.error('Failed to delete patch. Please try again.');
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  deletePatches: async (directories: string[]) => {
    const { currentFolder, loadPatches } = get();
    if (!currentFolder) return;

    try {
      set({ loading: true });
      const result = await window.electronAPI.deletePatchBatch(currentFolder, directories);

      if (result.success) {
        const deletedCount = result.deleted.length;
        const failedCount = result.failed;

        if (failedCount > 0) {
          toast.warning(`Deleted ${deletedCount} patches successfully, but ${failedCount} failed.`);
        } else {
          toast.success(`Successfully deleted ${deletedCount} patches`);
        }

        await loadPatches(currentFolder, true);
        // Clear selection after successful delete
        set({ selectedPatchDirs: [] });
      }
    } catch (error) {
      console.error('Error deleting patches:', error);
      toast.error('Failed to delete patches. Please try again.');
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  reorderPatches: async (newOrder: Patch[]) => {
    const { currentFolder, loadPatches } = get();
    if (!currentFolder) return;

    // Optimistic update
    set({ patches: newOrder });

    try {
      set({ loading: true });
      await window.electronAPI.reorderPatches(
        currentFolder,
        newOrder.map(p => p.dir),
      );
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
    set({ patches: [], currentFolder: null, selectedPatchDirs: [] });
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
