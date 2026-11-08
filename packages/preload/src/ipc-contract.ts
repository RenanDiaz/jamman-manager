/**
 * IPC contract between the main process, the preload bridge and the renderer.
 *
 * This file is the single source of truth for every IPC channel: its name,
 * the arguments the renderer sends and the value the main process answers.
 *
 * - main: `packages/main/src/ipc/*` handlers are typed with `IpcHandler<C>`.
 * - preload: the object exposed as `window.electronAPI` must satisfy `ElectronAPI`.
 * - renderer: `window.electronAPI` is declared as `ElectronAPI`.
 *
 * Types only, so every package imports it with `import type` and nothing
 * from it ends up in a bundle. Arguments are what a
 * well-behaved renderer sends; at runtime the main process still treats them
 * as untrusted and validates them (folder access, `typeof`, name patterns).
 *
 * @module ipc-contract
 */

// ==================== Patch and phrase data (as parsed from the SD) ====================

/** XML attributes of an element, as xml2js returns them under `$`. */
export type XmlAttributes = Record<string, string>;

/**
 * `patch.xml` parsed by xml2js with `explicitArray: true`: every child element
 * is an array of its text values.
 */
export interface JamManPatchXml {
  $?: XmlAttributes;
  PatchName: string[];
  RhythmType?: string[];
  StopMode?: string[];
  SettingsVersion?: string[];
  ID?: string[];
  OriginID?: string[];
  Metadata?: unknown[];
}

export interface PatchXmlData {
  JamManPatch: JamManPatchXml;
}

/** `phrase.xml` parsed by xml2js with `explicitArray: true`. */
export interface JamManPhraseXml {
  $?: XmlAttributes;
  BeatsPerMinute: string[];
  BeatsPerMeasure: string[];
  BpmValidated?: string[];
  IsLoop?: string[];
  IsReversed?: string[];
  SettingsVersion?: string[];
  AudioVersion?: string[];
  ID?: string[];
  OriginID?: string[];
  Metadata?: unknown[];
}

export interface PhraseXmlData {
  JamManPhrase: JamManPhraseXml;
}

/** One `PhraseX/` folder of a patch. */
export interface PhraseRecord {
  /** Folder name, e.g. `PhraseA`. */
  dir: string;
  data: PhraseXmlData;
  /** Absolute path of `phrase.wav`. */
  wavPath: string;
}

/** One `PatchNN/` folder of the SD, as returned by `patches:read`. */
export interface PatchRecord {
  /** Folder name, e.g. `Patch01`. */
  dir: string;
  data: PatchXmlData;
  phrases: PhraseRecord[];
}

/**
 * The part of a patch that the export handlers read. A full `PatchRecord`
 * satisfies it.
 */
export interface ExportPatch {
  dir: string;
  data?: { JamManPatch?: { PatchName?: string[] } };
}

// ==================== Patch forms (renderer → main) ====================

export interface PhraseForm {
  /** Phrase folder name, e.g. `PhraseA`. */
  name: string;
  /** Absolute path of the source WAV (inside the SD folder or picked in the file dialog). */
  wavPath: string;
  beatsPerMinute: number;
  beatsPerMeasure: number;
  isLoop: boolean;
  isReversed: boolean;
}

export interface PatchForm {
  /** The approved JamMan folder. */
  basePath: string;
  /** Patch folder name, e.g. `Patch04` (`/^Patch\d{2}$/`). */
  directory: string;
  patchName: string;
  rhythmType: string;
  stopMode: string;
  /** Current `SettingsVersion` (updates write it + 1). */
  settingsVersion?: string;
  /** Existing `<ID>`, kept on update. */
  patchID?: string;
  /** Existing `<OriginID>`, kept on update. */
  patchOriginID?: string;
  phrases: PhraseForm[];
}

// ==================== Results ====================

/** Result of a handler that asks the user where to save a file. */
export type SaveFileResult =
  | { success: true; filePath: string; canceled?: undefined }
  | { success: false; canceled: true; filePath?: undefined };

export interface FolderSize {
  sizeBytes: number;
  sizeMB: number;
  sizeGB: number;
}

export interface AudioValidationResult {
  /** Whether the WAV has the format the pedal expects (44.1 kHz, 16-bit, mono/stereo). */
  valid: boolean;
  sampleRate?: number;
  bitsPerSample?: number;
  numberOfChannels?: number;
  /** Seconds. */
  duration?: number;
  fileSizeBytes?: number;
  /** Why the file is not valid, or null when it is. */
  error?: string | null;
  /** Set when the format could not be read but playback may still work. */
  warning?: string;
  /** Whether the renderer may still try to play the file. */
  canAttemptPlayback: boolean;
}

export interface DeleteBatchResult {
  success: boolean;
  /** Patch folders that were deleted. */
  deleted: string[];
  /** How many requested folders were not found. */
  failed: number;
}

// ==================== Backups ====================

export interface BackupManifest {
  schemaVersion: number;
  version: string;
  appVersion: string;
  patchCount: number;
  createdAt: string;
  patches: string[];
  playlists?: unknown;
}

export interface BackupInfo {
  valid: boolean;
  manifest?: BackupManifest;
  error?: string;
}

export type BackupRestoreMode = 'replace' | 'merge';

export interface BackupRestoreResult {
  success: boolean;
  patchesRestored: number;
}

// ==================== Undo snapshots ====================

export type SnapshotScope = { kind: 'patches'; patches: string[] } | { kind: 'all' };

/** `add` brings back missing patches; `replace` makes the folder match the snapshot. */
export type SnapshotRestoreMode = 'add' | 'replace';

export interface UndoSnapshotInfo {
  id: string;
  basePath: string;
  scope: 'patches' | 'all';
  patches: string[];
  hasPlaylists: boolean;
  sizeBytes: number;
  createdAt: number;
}

export type UndoErrorCode =
  'INVALID_ARGUMENT' | 'NOT_FOUND' | 'TOO_LARGE' | 'SLOT_OCCUPIED' | 'WRONG_FOLDER' | 'FAILED';

/** Expected failures carry a code instead of throwing. */
export type UndoResult<T> =
  ({ ok: true } & T) | { ok: false; code: UndoErrorCode; message: string };

export interface SnapshotRestoreResult {
  restored: string[];
  removed: string[];
}

// ==================== Playlists ====================

/** A playlist as the main process returns it: patch IDs resolved to current folders. */
export interface Playlist {
  id: string;
  name: string;
  /** Patch folders, in playlist order. */
  patches: string[];
  /** Patch `<ID>`s, as stored on the SD. */
  patchIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistData {
  version: string;
  playlists: Playlist[];
  /** Deprecated, always empty. */
  patches?: unknown[];
}

export interface PlaylistUpdate {
  name?: string;
  patches?: string[];
}

// ==================== Pedal over USB ====================

/** `internal` is the pedal's own memory, `sd` the card in its slot. */
export type PedalBankId = 'internal' | 'sd';

export interface PedalBankInfo {
  id: PedalBankId;
  /**
   * The folder path the renderer uses for this bank (`jamman-pedal://<id>`).
   * Every handler that takes a folder path accepts it and works on the pedal.
   */
  path: string;
  /** False for the SD bank when no card is inserted. */
  available: boolean;
  capacityBytes: number;
  freeBytes: number;
}

/** How much of a pedal bank's audio is already on this computer (in the cache). */
export interface PedalAudioStatus {
  files: number;
  totalBytes: number;
  cachedFiles: number;
  cachedBytes: number;
}

/** Progress of a long step on the pedal, e.g. uploading a WAV. */
export interface PedalProgress {
  label: string;
  /** Bytes done and in total. */
  done: number;
  total: number;
}

/** A JamMan connected over USB. */
export interface PedalInfo {
  /** As the pedal reports it, e.g. "JamMan Stereo". */
  name: string;
  firmwareVersion: string;
  guid: string;
  banks: PedalBankInfo[];
}

// ==================== Operation queue ====================

export interface QueuedOperationInfo {
  id: string;
  type: string;
  description: string;
  priority: number;
  status: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface OperationQueueStatus {
  queued: QueuedOperationInfo[];
  running: QueuedOperationInfo[];
  completed: QueuedOperationInfo[];
  stats: {
    queuedCount: number;
    runningCount: number;
    completedCount: number;
    maxConcurrent: number;
  };
}

export interface OperationQueueStatistics {
  totalCompleted: number;
  successful: number;
  failed: number;
  /** Percentage (0-100). */
  successRate: number;
  /** Milliseconds. */
  averageDuration: number;
  currentlyQueued: number;
  currentlyRunning: number;
}

// ==================== Channels ====================

/**
 * Every IPC channel: the arguments the renderer sends and what the main
 * process resolves with. Channel names are part of the app's API: renaming
 * one breaks the renderer.
 */
export interface IpcChannels {
  // Dialogs
  'dialog:selectFolder': { args: []; result: string | undefined };
  'dialog:selectFile': { args: []; result: string | null };
  'backup:selectFile': { args: []; result: string | null };

  // Patches
  'folder:getSize': { args: [folderPath: string]; result: FolderSize };
  'patches:read': { args: [folderPath: string]; result: PatchRecord[] };
  'patches:create': { args: [form: PatchForm]; result: true };
  'patches:update': { args: [form: PatchForm]; result: true };
  'patches:delete': { args: [basePath: string, directory: string]; result: true };
  'patches:deleteBatch': {
    args: [basePath: string, directories: string[]];
    result: DeleteBatchResult;
  };
  'patches:reorder': { args: [basePath: string, newOrder: string[]]; result: true };

  // Export
  'patches:exportTXT': { args: [patches: ExportPatch[], basePath: string]; result: SaveFileResult };
  'patches:exportPDF': { args: [patches: ExportPatch[], basePath: string]; result: SaveFileResult };

  // Audio
  'phrase:getAudioURL': { args: [filePath: string]; result: string | null };
  'audio:validateWav': { args: [filePath: string]; result: AudioValidationResult };
  'audio:readFile': { args: [filePath: string]; result: Uint8Array };

  // Backups
  'backup:create': {
    args: [basePath: string, patches?: string[], includePlaylist?: boolean];
    result: SaveFileResult;
  };
  'backup:validate': { args: [backupPath: string]; result: BackupInfo };
  'backup:restore': {
    args: [backupPath: string, targetPath: string, mode: BackupRestoreMode, patches?: string[]];
    result: BackupRestoreResult;
  };

  // Undo snapshots
  'undo:createSnapshot': {
    args: [basePath: string, scope: SnapshotScope];
    result: UndoResult<{ snapshot: UndoSnapshotInfo }>;
  };
  'undo:restoreSnapshot': {
    args: [snapshotId: string, basePath: string, mode: SnapshotRestoreMode, only?: string[]];
    result: UndoResult<SnapshotRestoreResult>;
  };
  'undo:discardSnapshot': { args: [snapshotId: string]; result: void };

  // Playlists
  'playlists:load': { args: [basePath: string]; result: PlaylistData };
  'playlists:create': {
    args: [basePath: string, name: string, patches?: string[]];
    result: Playlist;
  };
  'playlists:update': {
    args: [basePath: string, playlistId: string, updates: PlaylistUpdate];
    result: Playlist;
  };
  'playlists:delete': { args: [basePath: string, playlistId: string]; result: { success: true } };
  'playlists:addPatches': {
    args: [basePath: string, playlistId: string, patchDirs: string[]];
    result: Playlist;
  };
  'playlists:removePatches': {
    args: [basePath: string, playlistId: string, patchDirs: string[]];
    result: Playlist;
  };
  'playlists:reorderPatches': {
    args: [basePath: string, playlistId: string, newOrder: string[]];
    result: Playlist;
  };
  'playlists:export': { args: [basePath: string, playlistId: string]; result: SaveFileResult };

  // Pedal over USB
  /** Finds a JamMan on USB and connects to it (or returns the current connection). */
  'pedal:connect': { args: []; result: PedalInfo };
  'pedal:disconnect': { args: []; result: void };
  'pedal:status': { args: []; result: PedalInfo | null };
  /** How much of a bank's audio (or some of its patches') is already cached. Reads no audio. */
  'pedal:audioStatus': {
    args: [bankPath: string, patches?: string[]];
    result: PedalAudioStatus;
  };
  /** Downloads a bank's audio into the cache (resumes where an earlier download stopped). */
  'pedal:downloadAudio': { args: [bankPath: string]; result: PedalAudioStatus };
  /** Stops the download or upload running on the pedal; it fails with "Canceled". */
  'pedal:cancel': { args: []; result: void };

  // Operation queue
  'operation-queue:status': { args: []; result: OperationQueueStatus };
  'operation-queue:statistics': { args: []; result: OperationQueueStatistics };
}

export type IpcChannel = keyof IpcChannels;
export type IpcArgs<C extends IpcChannel> = IpcChannels[C]['args'];
export type IpcReturn<C extends IpcChannel> = IpcChannels[C]['result'];

/** A main-process handler for channel `C` (without the Electron event). */
export type IpcHandler<C extends IpcChannel> = (
  ...args: IpcArgs<C>
) => Promise<IpcReturn<C>> | IpcReturn<C>;

/** Handlers for a set of channels, keyed by channel name. */
export type IpcHandlers<C extends IpcChannel> = { [K in C]: IpcHandler<K> };

/** What the renderer calls for channel `C`. */
export type IpcInvoker<C extends IpcChannel> = (...args: IpcArgs<C>) => Promise<IpcReturn<C>>;

// ==================== Events (main → renderer) ====================

/** Events the main process pushes to the renderer, with their payload. */
export interface IpcEvents {
  /** The pedal connected, disconnected or changed (e.g. SD card inserted or removed). */
  'pedal:changed': PedalInfo | null;
  /** Progress of a long change on the pedal (an upload); null when it is over. */
  'pedal:progress': PedalProgress | null;
}

export type IpcEventChannel = keyof IpcEvents;

// ==================== window.electronAPI ====================

/**
 * The API the preload exposes as `window.electronAPI`. Each method invokes one
 * channel (see `ELECTRON_API_CHANNELS` in the preload) with the same arguments.
 */
export interface ElectronAPI {
  /** Opens the folder dialog; the folder picked becomes the only one the app may use. */
  selectFolder: IpcInvoker<'dialog:selectFolder'>;
  /** Opens the WAV file dialog; the file picked may be read and imported this session. */
  selectFile: IpcInvoker<'dialog:selectFile'>;

  /** Reads every patch (and its phrases) in the approved folder. */
  readPatches: IpcInvoker<'patches:read'>;
  createPatch: IpcInvoker<'patches:create'>;
  updatePatch: IpcInvoker<'patches:update'>;
  /** Deletes one patch (kept aside for 5 seconds before it is removed for good). */
  deletePatch: IpcInvoker<'patches:delete'>;
  deletePatchBatch: IpcInvoker<'patches:deleteBatch'>;
  /** Renames the patch folders so they follow `newOrder` (Patch01, Patch02…). */
  reorderPatches: IpcInvoker<'patches:reorder'>;
  exportPatchesTXT: IpcInvoker<'patches:exportTXT'>;
  exportPatchesPDF: IpcInvoker<'patches:exportPDF'>;

  /** `jamman://` URL to play a WAV of the approved folder, or null. */
  getAudioURL: IpcInvoker<'phrase:getAudioURL'>;
  validateWav: IpcInvoker<'audio:validateWav'>;
  readAudioFile: IpcInvoker<'audio:readFile'>;

  createBackup: IpcInvoker<'backup:create'>;
  validateBackup: IpcInvoker<'backup:validate'>;
  restoreBackup: IpcInvoker<'backup:restore'>;
  /** Opens the backup file dialog; the file picked may be validated and restored. */
  selectBackupFile: IpcInvoker<'backup:selectFile'>;

  createUndoSnapshot: IpcInvoker<'undo:createSnapshot'>;
  restoreUndoSnapshot: IpcInvoker<'undo:restoreSnapshot'>;
  discardUndoSnapshot: IpcInvoker<'undo:discardSnapshot'>;

  getFolderSize: IpcInvoker<'folder:getSize'>;

  loadPlaylists: IpcInvoker<'playlists:load'>;
  createPlaylist: IpcInvoker<'playlists:create'>;
  updatePlaylist: IpcInvoker<'playlists:update'>;
  deletePlaylist: IpcInvoker<'playlists:delete'>;
  addPatchesToPlaylist: IpcInvoker<'playlists:addPatches'>;
  removePatchesFromPlaylist: IpcInvoker<'playlists:removePatches'>;
  reorderPlaylistPatches: IpcInvoker<'playlists:reorderPatches'>;
  exportPlaylist: IpcInvoker<'playlists:export'>;

  connectPedal: IpcInvoker<'pedal:connect'>;
  disconnectPedal: IpcInvoker<'pedal:disconnect'>;
  getPedalStatus: IpcInvoker<'pedal:status'>;
  getPedalAudioStatus: IpcInvoker<'pedal:audioStatus'>;
  downloadPedalAudio: IpcInvoker<'pedal:downloadAudio'>;
  cancelPedalOperation: IpcInvoker<'pedal:cancel'>;
  /** Calls `listener` whenever the pedal connects, disconnects or changes. Returns an unsubscribe function. */
  onPedalChanged: (listener: (info: IpcEvents['pedal:changed']) => void) => () => void;
  /** Calls `listener` with the progress of uploads to the pedal. Returns an unsubscribe function. */
  onPedalProgress: (listener: (progress: IpcEvents['pedal:progress']) => void) => () => void;
}
