/**
 * Preload Script - Security Bridge
 *
 * This module exposes a safe, limited API from the main process to the renderer process
 * via Electron's contextBridge. All file operations must go through this layer to prevent
 * arbitrary code execution in the renderer.
 *
 * Security Model:
 * - Renderer cannot directly access Node.js APIs
 * - All main process communication goes through IPC with validated channels
 * - Only explicitly exposed functions are available to renderer
 *
 * @module preload
 */

import { sha256sum } from './nodeCrypto.js';
import { versions } from './versions.js';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * Internal helper to invoke IPC channels
 * @param channel - IPC channel name
 * @param message - Message to send
 * @returns Promise with result from main process
 */
function send(channel: string, message: string) {
  return ipcRenderer.invoke(channel, message);
}

/**
 * Phrase data structure for creating/updating patches
 */
export type PhrasePayload = {
  /** Phrase name (e.g., "PhraseA", "PhraseB") */
  name: string;
  /** Absolute path to the source WAV file */
  wavPath: string;
  /** Beats per minute */
  tempo: number;
  /** Time signature (e.g., "4/4") */
  timeSignature: string;
  /** Loop type setting */
  loopType: string;
};

/**
 * Patch data structure for creating/updating patches
 */
export type PatchPayload = {
  /** Base path to the JamMan folder */
  basePath: string;
  /** User-visible patch name */
  patchName: string;
  /** Directory name (e.g., "Patch01") */
  directory: string;
  /** Rhythm type setting */
  rhythmType: string;
  /** Stop mode setting */
  stopMode: string;
  /** Optional settings version for updates */
  settingsVersion?: string;
  /** Array of phrases in this patch */
  phrases: PhrasePayload[];
};

/**
 * Audio validation result from the main process
 */
type AudioValidationResult = {
  /** Whether the WAV file is valid for JamMan */
  valid: boolean;
  /** Sample rate in Hz (should be 44100) */
  sampleRate?: number;
  /** Bits per sample (should be 16) */
  bitsPerSample?: number;
  /** Number of channels (1=mono, 2=stereo) */
  numberOfChannels?: number;
  /** Duration in seconds */
  duration?: number;
  /** File size in bytes */
  fileSizeBytes?: number;
  /** Error message if validation failed */
  error?: string;
  /** Warning message if format is unexpected but playable */
  warning?: string;
  /** Whether browser can attempt to play the file */
  canAttemptPlayback?: boolean;
};

/**
 * Electron API exposed to the renderer process
 *
 * This API is available as `window.electronAPI` in the renderer.
 * All methods return Promises and communicate with the main process via IPC.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ==================== Dialog Operations ====================

  /**
   * Opens a native folder selection dialog
   * @returns Promise resolving to the selected folder path, or undefined if canceled
   */
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  /**
   * Opens a native file selection dialog for WAV files
   * @returns Promise resolving to the selected file path, or null if canceled
   */
  selectFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectFile', {
      filters: [{ name: 'Audio', extensions: ['wav'] }],
      properties: ['openFile'],
    }),

  // ==================== Patch Operations ====================

  /**
   * Reads all patches from the specified JamMan folder
   * @param folderPath - Absolute path to the JamMan folder
   * @returns Promise resolving to an array of patch objects with metadata
   */
  readPatches: (folderPath: string) => ipcRenderer.invoke('patches:read', folderPath),

  /**
   * Creates a new patch with the specified data
   * @param data - Patch payload with metadata and phrases
   * @returns Promise resolving when patch is created
   */
  createPatch: (data: PatchPayload): Promise<void> => ipcRenderer.invoke('patches:create', data),

  /**
   * Updates an existing patch with new data
   * @param data - Patch payload with updated metadata and phrases
   * @returns Promise resolving when patch is updated
   */
  updatePatch: (data: PatchPayload): Promise<void> => ipcRenderer.invoke('patches:update', data),

  /**
   * Deletes a single patch with automatic backup
   * @param basePath - Base path to the JamMan folder
   * @param directory - Patch directory name (e.g., "Patch01")
   * @returns Promise resolving when patch is deleted
   */
  deletePatch: (basePath: string, directory: string): Promise<void> =>
    ipcRenderer.invoke('patches:delete', basePath, directory),

  /**
   * Deletes multiple patches in a batch operation
   * @param basePath - Base path to the JamMan folder
   * @param directories - Array of patch directory names to delete
   * @returns Promise resolving with deletion results
   */
  deletePatchBatch: (
    basePath: string,
    directories: string[],
  ): Promise<{ success: boolean; deleted: string[]; failed: number }> =>
    ipcRenderer.invoke('patches:deleteBatch', basePath, directories),

  /**
   * Reorders patches by renaming directories (Patch01, Patch02, etc.)
   * @param basePath - Base path to the JamMan folder
   * @param patches - Array of patch directory names in desired order
   * @returns Promise resolving when reorder is complete
   */
  reorderPatches: (basePath: string, patches: string[]): Promise<void> =>
    ipcRenderer.invoke('patches:reorder', basePath, patches),

  /**
   * Exports patch list to a text file
   * @param patches - Array of patch objects to export
   * @param basePath - Base path to the JamMan folder
   * @returns Promise resolving with export results
   */
  exportPatchesTXT: (
    patches: unknown[],
    basePath: string,
  ): Promise<{ success: boolean; filePath?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('patches:exportTXT', patches, basePath),

  /**
   * Exports patch list to a PDF file
   * @param patches - Array of patch objects to export
   * @param basePath - Base path to the JamMan folder
   * @returns Promise resolving with export results
   */
  exportPatchesPDF: (
    patches: unknown[],
    basePath: string,
  ): Promise<{ success: boolean; filePath?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('patches:exportPDF', patches, basePath),

  // ==================== Audio Operations ====================

  /**
   * Gets a secure URL for audio playback using custom protocol
   * @param wavPath - Absolute path to the WAV file
   * @returns Promise resolving to jamman:// protocol URL for audio element
   */
  getAudioURL: (wavPath: string) => ipcRenderer.invoke('phrase:getAudioURL', wavPath),

  /**
   * Validates a WAV file's format for JamMan compatibility
   * @param wavPath - Absolute path to the WAV file
   * @returns Promise resolving with validation results
   */
  validateWav: (wavPath: string): Promise<AudioValidationResult> =>
    ipcRenderer.invoke('audio:validateWav', wavPath),

  /**
   * Reads an audio file as an ArrayBuffer for direct playback
   * @param wavPath - Absolute path to the WAV file
   * @returns Promise resolving to ArrayBuffer containing audio data
   */
  readAudioFile: (wavPath: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('audio:readFile', wavPath),

  // ==================== Backup/Restore Operations ====================

  /**
   * Creates a ZIP backup of patches and/or playlists
   * @param basePath - Base path to the JamMan folder
   * @param patches - Optional array of patch IDs to back up (all if omitted)
   * @param includePlaylist - Whether to include playlist metadata
   * @returns Promise resolving with backup creation results
   */
  createBackup: (
    basePath: string,
    patches?: string[],
    includePlaylist?: boolean,
  ): Promise<{ success: boolean; filePath?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('backup:create', basePath, patches, includePlaylist),

  /**
   * Validates a backup file and reads its manifest
   * @param backupPath - Absolute path to the backup ZIP file
   * @returns Promise resolving with validation results and manifest
   */
  validateBackup: (
    backupPath: string,
  ): Promise<{ valid: boolean; manifest?: any; error?: string }> =>
    ipcRenderer.invoke('backup:validate', backupPath),

  /**
   * Restores patches from a backup file
   * @param backupPath - Absolute path to the backup ZIP file
   * @param targetPath - Target JamMan folder path
   * @param mode - 'replace' wipes folder first, 'merge' adds with auto-renumbering
   * @param patches - Optional array of patch IDs to restore (all if omitted)
   * @returns Promise resolving with restore results
   */
  restoreBackup: (
    backupPath: string,
    targetPath: string,
    mode: 'replace' | 'merge',
    patches?: string[],
  ): Promise<{ success: boolean; patchesRestored: number }> =>
    ipcRenderer.invoke('backup:restore', backupPath, targetPath, mode, patches),

  /**
   * Opens a native file selection dialog for backup files
   * @returns Promise resolving to selected backup file path, or null if canceled
   */
  selectBackupFile: (): Promise<string | null> => ipcRenderer.invoke('backup:selectFile'),

  // ==================== Utility Operations ====================

  /**
   * Calculates the total size of a folder
   * @param folderPath - Absolute path to the folder
   * @returns Promise resolving with size information
   */
  getFolderSize: (
    folderPath: string,
  ): Promise<{ sizeBytes: number; sizeMB: number; sizeGB: number }> =>
    ipcRenderer.invoke('folder:getSize', folderPath),

  // ==================== Playlist Operations ====================

  /**
   * Loads all playlists from the JamMan folder metadata
   * @param basePath - Base path to the JamMan folder
   * @returns Promise resolving to playlists data structure
   */
  loadPlaylists: (basePath: string): Promise<any> => ipcRenderer.invoke('playlists:load', basePath),

  /**
   * Creates a new playlist
   * @param basePath - Base path to the JamMan folder
   * @param name - Playlist name
   * @param patches - Optional initial array of patch directory names
   * @returns Promise resolving to created playlist object
   */
  createPlaylist: (basePath: string, name: string, patches?: string[]): Promise<any> =>
    ipcRenderer.invoke('playlists:create', basePath, name, patches),

  /**
   * Updates a playlist's name and/or patches
   * @param basePath - Base path to the JamMan folder
   * @param playlistId - Unique playlist ID
   * @param updates - Object with optional name and/or patches array
   * @returns Promise resolving to updated playlist object
   */
  updatePlaylist: (
    basePath: string,
    playlistId: string,
    updates: { name?: string; patches?: string[] },
  ): Promise<any> => ipcRenderer.invoke('playlists:update', basePath, playlistId, updates),

  /**
   * Deletes a playlist (does not affect patches)
   * @param basePath - Base path to the JamMan folder
   * @param playlistId - Unique playlist ID
   * @returns Promise resolving with success status
   */
  deletePlaylist: (basePath: string, playlistId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('playlists:delete', basePath, playlistId),

  /**
   * Adds patches to an existing playlist
   * @param basePath - Base path to the JamMan folder
   * @param playlistId - Unique playlist ID
   * @param patchDirs - Array of patch directory names to add
   * @returns Promise resolving to updated playlist object
   */
  addPatchesToPlaylist: (basePath: string, playlistId: string, patchDirs: string[]): Promise<any> =>
    ipcRenderer.invoke('playlists:addPatches', basePath, playlistId, patchDirs),

  /**
   * Removes patches from a playlist
   * @param basePath - Base path to the JamMan folder
   * @param playlistId - Unique playlist ID
   * @param patchDirs - Array of patch directory names to remove
   * @returns Promise resolving to updated playlist object
   */
  removePatchesFromPlaylist: (
    basePath: string,
    playlistId: string,
    patchDirs: string[],
  ): Promise<any> => ipcRenderer.invoke('playlists:removePatches', basePath, playlistId, patchDirs),

  /**
   * Reorders patches within a playlist (virtual ordering, doesn't affect SD card)
   * @param basePath - Base path to the JamMan folder
   * @param playlistId - Unique playlist ID
   * @param newOrder - Array of patch directory names in desired order
   * @returns Promise resolving to updated playlist object
   */
  reorderPlaylistPatches: (
    basePath: string,
    playlistId: string,
    newOrder: string[],
  ): Promise<any> => ipcRenderer.invoke('playlists:reorderPatches', basePath, playlistId, newOrder),

  /**
   * Exports a playlist as a text setlist file for printing/reference
   * @param basePath - Base path to the JamMan folder
   * @param playlistId - Unique playlist ID
   * @returns Promise resolving with export results
   */
  exportPlaylist: (
    basePath: string,
    playlistId: string,
  ): Promise<{ success: boolean; filePath?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('playlists:export', basePath, playlistId),
});

export { sha256sum, versions, send };
