/**
 * The preload bridge: each `window.electronAPI` method must invoke its channel
 * of the IPC contract with the arguments it was given, unchanged.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from './ipc-contract.js';

const exposed = new Map<string, unknown>();
const invoke = vi.fn(async (...args: unknown[]) => args);
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, value: unknown) => exposed.set(key, value) },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
      listeners.get(channel)?.delete(listener);
    },
  },
}));

/** Methods that subscribe to a main → renderer event instead of invoking a channel. */
const EVENT_METHODS = ['onPedalChanged', 'onPedalProgress'] as const;

let api: ElectronAPI;

beforeAll(async () => {
  await import('./index.js');
  api = exposed.get('electronAPI') as ElectronAPI;
});

/** method → channel. Every ElectronAPI method that invokes a channel must appear here. */
const CHANNEL_OF: Record<Exclude<keyof ElectronAPI, (typeof EVENT_METHODS)[number]>, string> = {
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
  connectPedal: 'pedal:connect',
  disconnectPedal: 'pedal:disconnect',
  getPedalStatus: 'pedal:status',
  getPedalAudioStatus: 'pedal:audioStatus',
  downloadPedalAudio: 'pedal:downloadAudio',
  cancelPedalOperation: 'pedal:cancel',
  setPedalButton: 'pedal:setButton',
};

describe('window.electronAPI', () => {
  it('exposes exactly the methods of the contract', () => {
    expect(Object.keys(api).sort()).toEqual([...Object.keys(CHANNEL_OF), ...EVENT_METHODS].sort());
  });

  it('onPedalChanged passes only the payload and unsubscribes', () => {
    const received: unknown[] = [];
    const unsubscribe = api.onPedalChanged(info => received.push(info));
    const [handler] = listeners.get('pedal:changed') ?? [];

    handler({ sender: 'electron event' }, null);
    expect(received).toEqual([null]);

    unsubscribe();
    expect(listeners.get('pedal:changed')?.size).toBe(0);
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
