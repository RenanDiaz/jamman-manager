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
 * - Channels, arguments and results are declared in `ipc-contract.ts`
 *
 * @module preload
 */

import { sha256sum } from './sha256.js';
import { versions } from './versions.js';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  ElectronAPI,
  IpcArgs,
  IpcChannel,
  IpcEventChannel,
  IpcEvents,
  IpcReturn,
} from './ipc-contract.js';

/**
 * Invokes an IPC channel with the arguments and result the contract declares.
 */
function send<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcReturn<C>> {
  return ipcRenderer.invoke(channel, ...args);
}

/**
 * Subscribes to a main → renderer event. Only the payload crosses the bridge,
 * never the Electron event. Returns the unsubscribe function.
 */
function subscribe<E extends IpcEventChannel>(
  channel: E,
  listener: (payload: IpcEvents[E]) => void,
): () => void {
  const handler = (_event: unknown, payload: IpcEvents[E]) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

/**
 * The API exposed as `window.electronAPI`: each method invokes one channel of
 * the contract with the same arguments. Documentation of each method is in
 * `ElectronAPI` (ipc-contract.ts).
 */
const electronAPI: ElectronAPI = {
  // Dialogs
  selectFolder: () => send('dialog:selectFolder'),
  selectFile: () => send('dialog:selectFile'),

  // Patches
  readPatches: folderPath => send('patches:read', folderPath),
  createPatch: form => send('patches:create', form),
  updatePatch: form => send('patches:update', form),
  deletePatch: (basePath, directory) => send('patches:delete', basePath, directory),
  deletePatchBatch: (basePath, directories) => send('patches:deleteBatch', basePath, directories),
  reorderPatches: (basePath, newOrder) => send('patches:reorder', basePath, newOrder),
  exportPatchesTXT: (patches, basePath) => send('patches:exportTXT', patches, basePath),
  exportPatchesPDF: (patches, basePath) => send('patches:exportPDF', patches, basePath),

  // Audio
  getAudioURL: filePath => send('phrase:getAudioURL', filePath),
  validateWav: filePath => send('audio:validateWav', filePath),
  readAudioFile: filePath => send('audio:readFile', filePath),

  // Backups
  createBackup: (basePath, patches, includePlaylist) =>
    send('backup:create', basePath, patches, includePlaylist),
  validateBackup: backupPath => send('backup:validate', backupPath),
  restoreBackup: (backupPath, targetPath, mode, patches) =>
    send('backup:restore', backupPath, targetPath, mode, patches),
  selectBackupFile: () => send('backup:selectFile'),

  // Undo snapshots
  createUndoSnapshot: (basePath, scope) => send('undo:createSnapshot', basePath, scope),
  restoreUndoSnapshot: (snapshotId, basePath, mode, only) =>
    send('undo:restoreSnapshot', snapshotId, basePath, mode, only),
  discardUndoSnapshot: snapshotId => send('undo:discardSnapshot', snapshotId),

  // Utility
  getFolderSize: folderPath => send('folder:getSize', folderPath),

  // Playlists
  loadPlaylists: basePath => send('playlists:load', basePath),
  createPlaylist: (basePath, name, patches) => send('playlists:create', basePath, name, patches),
  updatePlaylist: (basePath, playlistId, updates) =>
    send('playlists:update', basePath, playlistId, updates),
  deletePlaylist: (basePath, playlistId) => send('playlists:delete', basePath, playlistId),
  addPatchesToPlaylist: (basePath, playlistId, patchDirs) =>
    send('playlists:addPatches', basePath, playlistId, patchDirs),
  removePatchesFromPlaylist: (basePath, playlistId, patchDirs) =>
    send('playlists:removePatches', basePath, playlistId, patchDirs),
  reorderPlaylistPatches: (basePath, playlistId, newOrder) =>
    send('playlists:reorderPatches', basePath, playlistId, newOrder),
  exportPlaylist: (basePath, playlistId) => send('playlists:export', basePath, playlistId),

  // Pedal over USB
  connectPedal: () => send('pedal:connect'),
  disconnectPedal: () => send('pedal:disconnect'),
  getPedalStatus: () => send('pedal:status'),
  getPedalAudioStatus: (bankPath, patches) => send('pedal:audioStatus', bankPath, patches),
  downloadPedalAudio: bankPath => send('pedal:downloadAudio', bankPath),
  cancelPedalOperation: () => send('pedal:cancel'),
  onPedalChanged: listener => subscribe('pedal:changed', listener),
  onPedalProgress: listener => subscribe('pedal:progress', listener),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export { sha256sum, versions, send };
