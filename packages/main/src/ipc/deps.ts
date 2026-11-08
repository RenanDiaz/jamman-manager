/**
 * Dependencies of the IPC handlers.
 *
 * Handlers never import Electron, the file system or the singletons directly:
 * `index.ts` passes the real ones to `registerIpcHandlers`, and tests pass the
 * same real modules (or wrappers that inject failures) without Electron.
 *
 * @module ipc/deps
 */
import type * as nodeFs from 'node:fs';
import type fsExtra from 'fs-extra';
import type { Dialog } from 'electron';
import type { BackupManager } from '../BackupManager.js';
import type { FolderAccess } from '../security/folderAccess.js';
import type { LockManager } from '../LockManager.js';
import type { OperationQueue } from '../OperationQueue.js';
import type { PatchRestore } from '../PatchRestore.js';
import type { PlaylistManager } from '../PlaylistManager.js';
import type { PatchCache } from './patches.js';
import type { PedalManager } from '../usb/PedalManager.js';

export type IpcLogger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

export type FileSystem = typeof nodeFs;
export type FileSystemExtra = typeof fsExtra;

export type DialogApi = Pick<Dialog, 'showOpenDialog' | 'showSaveDialog'>;

/** The parts of Electron's `app` the handlers use. */
export type AppInfo = {
  getPath(name: 'documents'): string;
  getVersion(): string;
};

export type Queue = Pick<OperationQueue, 'enqueue' | 'getStatus' | 'getStatistics'>;
export type Locks = Pick<LockManager, 'withLock'>;

export type Backups = Pick<
  typeof BackupManager,
  'createBackup' | 'validateBackup' | 'restoreBackup'
>;

export type Playlists = Pick<
  typeof PlaylistManager,
  | 'loadPlaylists'
  | 'createPlaylist'
  | 'updatePlaylist'
  | 'deletePlaylist'
  | 'addPatchesToPlaylist'
  | 'removePatchesFromPlaylist'
  | 'reorderPlaylistPatches'
>;

export type Snapshots = Pick<
  PatchRestore,
  'createSnapshot' | 'restoreSnapshot' | 'discardSnapshot'
>;

/** The pedal connected over USB. */
export type Pedal = Pick<
  PedalManager,
  | 'connect'
  | 'disconnect'
  | 'status'
  | 'readPatches'
  | 'bankSize'
  | 'readWavHead'
  | 'readWav'
  | 'updatePatch'
  | 'deletePatches'
  | 'reorderPatches'
  | 'createSnapshot'
  | 'restoreSnapshot'
  | 'discardSnapshot'
>;

/** Everything `registerIpcHandlers` needs. Each domain module takes the subset it uses. */
export interface IpcDeps {
  fs: FileSystem;
  fse: FileSystemExtra;
  log: IpcLogger;
  dialog: DialogApi;
  app: AppInfo;
  folderAccess: FolderAccess;
  operationQueue: Queue;
  lockManager: Locks;
  patchCache: PatchCache;
  backupManager: Backups;
  playlistManager: Playlists;
  patchRestore: Snapshots;
  pedal: Pedal;
}
