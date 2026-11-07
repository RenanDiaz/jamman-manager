/**
 * The preload bridge: each `window.electronAPI` method must invoke its channel
 * of the IPC contract with the arguments it was given, unchanged.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from './ipc-contract.js';

const exposed = new Map<string, unknown>();
const invoke = vi.fn(async (...args: unknown[]) => args);

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, value: unknown) => exposed.set(key, value) },
  ipcRenderer: { invoke: (...args: unknown[]) => invoke(...args) },
}));

let api: ElectronAPI;

beforeAll(async () => {
  await import('./index.js');
  api = exposed.get('electronAPI') as ElectronAPI;
});

/** method → channel. Every ElectronAPI method must appear here. */
const CHANNEL_OF: Record<keyof ElectronAPI, string> = {
  selectFolder: 'dialog:selectFolder',
  selectFile: 'dialog:selectFile',
  readPatches: 'patches:read',
  createPatch: 'patches:create',
  updatePatch: 'patches:update',
  deletePatch: 'patches:delete',
  deletePatchBatch: 'patches:deleteBatch',
  reorderPatches: 'patches:reorder',
  exportPatchesTXT: 'patches:exportTXT',
  exportPatchesPDF: 'patches:exportPDF',
  getAudioURL: 'phrase:getAudioURL',
  validateWav: 'audio:validateWav',
  readAudioFile: 'audio:readFile',
  createBackup: 'backup:create',
  validateBackup: 'backup:validate',
  restoreBackup: 'backup:restore',
  selectBackupFile: 'backup:selectFile',
  createUndoSnapshot: 'undo:createSnapshot',
  restoreUndoSnapshot: 'undo:restoreSnapshot',
  discardUndoSnapshot: 'undo:discardSnapshot',
  getFolderSize: 'folder:getSize',
  loadPlaylists: 'playlists:load',
  createPlaylist: 'playlists:create',
  updatePlaylist: 'playlists:update',
  deletePlaylist: 'playlists:delete',
  addPatchesToPlaylist: 'playlists:addPatches',
  removePatchesFromPlaylist: 'playlists:removePatches',
  reorderPlaylistPatches: 'playlists:reorderPatches',
  exportPlaylist: 'playlists:export',
};

describe('window.electronAPI', () => {
  it('exposes exactly the methods of the contract', () => {
    expect(Object.keys(api).sort()).toEqual(Object.keys(CHANNEL_OF).sort());
  });

  it.each(Object.entries(CHANNEL_OF))(
    '%s invokes %s with its arguments',
    async (method, channel) => {
      const fn = api[method as keyof ElectronAPI] as (...args: unknown[]) => Promise<unknown>;
      const args = Array.from({ length: fn.length }, (_, i) => `arg${i}`);
      invoke.mockClear();
      await fn(...args);
      expect(invoke).toHaveBeenCalledWith(channel, ...args);
    },
  );
});
