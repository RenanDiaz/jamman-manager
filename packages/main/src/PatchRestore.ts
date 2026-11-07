/**
 * Patch snapshots for undo/redo
 *
 * Before a destructive operation (delete, edit, restore a backup) the renderer asks for a
 * snapshot of the affected patch directories. A snapshot is a verbatim copy (phrase XMLs and
 * WAV audio included) kept outside the JamMan folder. Undo/redo later restores it.
 *
 * Snapshots live only as long as the undo history they belong to: they are discarded when the
 * history drops the entry and purged on every app start (the undo stack is in memory only).
 *
 * This module is pure: every dependency (snapshot folder, lock, logger, size limit) is injected,
 * so it can be tested against a temporary directory without Electron.
 *
 * @module PatchRestore
 */

import * as fse from 'fs-extra';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Name of the playlist metadata file stored next to the patches */
const PLAYLISTS_FILE = '.jamman-playlists.json';

/** Default cap for one snapshot (SD cards can hold several GB of audio) */
export const DEFAULT_MAX_SNAPSHOT_BYTES = 1024 * 1024 * 1024; // 1 GiB

const PATCH_DIR_RE = /^Patch\d{2}$/;
const SNAPSHOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type PatchRestoreErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'TOO_LARGE'
  | 'SLOT_OCCUPIED'
  | 'WRONG_FOLDER'
  | 'FAILED';

/** Error with a stable code so callers can tell "can't undo" apart from real failures */
export class PatchRestoreError extends Error {
  constructor(
    public readonly code: PatchRestoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PatchRestoreError';
  }
}

/** What a snapshot covers */
export type SnapshotScope =
  /** Only these patch directories (e.g. `["Patch03"]`) */
  | { kind: 'patches'; patches: string[] }
  /** Every patch directory in the folder, plus the playlists file */
  | { kind: 'all' };

export interface SnapshotInfo {
  id: string;
  basePath: string;
  scope: 'patches' | 'all';
  /** Patch directories stored in the snapshot */
  patches: string[];
  /** Whether the playlists file existed (and is stored) when the snapshot was taken */
  hasPlaylists: boolean;
  sizeBytes: number;
  createdAt: number;
}

/**
 * - `add`: bring back patches that are gone. Fails (touching nothing) if any slot is occupied.
 * - `replace`: make the folder match the snapshot. Listed patches are replaced; for an `all`
 *   snapshot, patches not in the snapshot are removed and the playlists file is restored too.
 */
export type RestoreMode = 'add' | 'replace';

export interface RestoreResult {
  restored: string[];
  removed: string[];
}

export interface PatchRestoreDeps {
  /** Folder where snapshots are stored (e.g. `<userData>/undo-snapshots`). Never inside a JamMan folder. */
  snapshotRoot: string;
  /** Serializes work on a key. Defaults to running the function directly. */
  withLock?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  /** Snapshots bigger than this are refused with `TOO_LARGE` */
  maxSnapshotBytes?: number;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}

const MANIFEST = 'snapshot.json';
const DATA_DIR = 'data';

export class PatchRestore {
  private readonly root: string;
  private readonly withLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  private readonly maxBytes: number;
  private readonly log: NonNullable<PatchRestoreDeps['logger']>;

  constructor(deps: PatchRestoreDeps) {
    this.root = path.resolve(deps.snapshotRoot);
    this.withLock = deps.withLock ?? ((_key, fn) => fn());
    this.maxBytes = deps.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES;
    this.log = deps.logger ?? { info: () => undefined, warn: () => undefined };
  }

  /** Copies the scoped patches (and playlists, for `all`) into a new snapshot */
  async createSnapshot(basePath: string, scope: SnapshotScope): Promise<SnapshotInfo> {
    const base = await this.requireFolder(basePath);

    let patches: string[];
    if (scope.kind === 'all') {
      patches = await this.listPatchDirs(base);
    } else {
      if (!Array.isArray(scope.patches) || scope.patches.length === 0) {
        throw new PatchRestoreError('INVALID_ARGUMENT', 'No patches to snapshot');
      }
      patches = [...new Set(scope.patches)];
      for (const dir of patches) this.assertPatchDir(dir);
      for (const dir of patches) {
        if (!(await fse.pathExists(path.join(base, dir)))) {
          throw new PatchRestoreError('NOT_FOUND', `Patch not found: ${dir}`);
        }
      }
    }

    const playlistsPath = path.join(base, PLAYLISTS_FILE);
    const hasPlaylists = scope.kind === 'all' && (await fse.pathExists(playlistsPath));

    let sizeBytes = 0;
    for (const dir of patches) sizeBytes += await this.sizeOf(path.join(base, dir));
    if (hasPlaylists) sizeBytes += await this.sizeOf(playlistsPath);
    if (sizeBytes > this.maxBytes) {
      throw new PatchRestoreError(
        'TOO_LARGE',
        `Snapshot would take ${Math.round(sizeBytes / (1024 * 1024))} MB, over the ${Math.round(
          this.maxBytes / (1024 * 1024),
        )} MB limit`,
      );
    }

    const id = randomUUID();
    const snapDir = this.snapshotDir(id);
    const dataDir = path.join(snapDir, DATA_DIR);
    const info: SnapshotInfo = {
      id,
      basePath: base,
      scope: scope.kind,
      patches,
      hasPlaylists,
      sizeBytes,
      createdAt: Date.now(),
    };

    try {
      await fse.ensureDir(dataDir);
      for (const dir of patches) {
        await fse.copy(path.join(base, dir), path.join(dataDir, dir), {
          preserveTimestamps: true,
        });
      }
      if (hasPlaylists) await fse.copy(playlistsPath, path.join(dataDir, PLAYLISTS_FILE));
      // The manifest is written last: a snapshot without it is incomplete and ignored.
      await fse.writeJson(path.join(snapDir, MANIFEST), info);
    } catch (error) {
      await fse.remove(snapDir).catch(() => undefined);
      throw new PatchRestoreError('FAILED', `Could not create snapshot: ${describe(error)}`);
    }

    this.log.info(`Created snapshot ${id}: ${patches.length} patches, ${sizeBytes} bytes`);
    return info;
  }

  /** Restores a snapshot into the folder it was taken from */
  async restoreSnapshot(id: string, basePath: string, mode: RestoreMode): Promise<RestoreResult> {
    const base = await this.requireFolder(basePath);
    const info = await this.readInfo(id);
    if (path.resolve(info.basePath) !== base) {
      throw new PatchRestoreError(
        'WRONG_FOLDER',
        'This undo state belongs to a different JamMan folder',
      );
    }
    if (mode !== 'add' && mode !== 'replace') {
      throw new PatchRestoreError('INVALID_ARGUMENT', `Unknown restore mode: ${String(mode)}`);
    }

    return this.withLock(base, async () => {
      const dataDir = path.join(this.snapshotDir(id), DATA_DIR);

      if (mode === 'add') {
        // Check every slot first so a conflict leaves the folder untouched.
        const occupied: string[] = [];
        for (const dir of info.patches) {
          if (await fse.pathExists(path.join(base, dir))) occupied.push(dir);
        }
        if (occupied.length > 0) {
          throw new PatchRestoreError(
            'SLOT_OCCUPIED',
            `Cannot restore: ${occupied.join(', ')} ${
              occupied.length === 1 ? 'is' : 'are'
            } now in use`,
          );
        }
      }

      const removed: string[] = [];
      const trash: string[] = [];
      const placed: string[] = [];
      const stamp = Date.now();

      try {
        // Stage copies next to their destination first, so the swap below is just renames.
        const staged = new Map<string, string>();
        for (const dir of info.patches) {
          const staging = path.join(base, `__undo_new_${dir}_${stamp}`);
          await fse.copy(path.join(dataDir, dir), staging, { preserveTimestamps: true });
          staged.set(dir, staging);
        }

        if (mode === 'replace' && info.scope === 'all') {
          for (const dir of await this.listPatchDirs(base)) {
            if (!info.patches.includes(dir)) {
              const old = path.join(base, `__undo_old_${dir}_${stamp}`);
              await fse.move(path.join(base, dir), old);
              trash.push(old);
              removed.push(dir);
            }
          }
        }

        for (const dir of info.patches) {
          const target = path.join(base, dir);
          if (mode === 'replace' && (await fse.pathExists(target))) {
            const old = path.join(base, `__undo_old_${dir}_${stamp}`);
            await fse.move(target, old);
            trash.push(old);
          }
          await fse.move(staged.get(dir)!, target);
          placed.push(dir);
        }

        if (mode === 'replace' && info.scope === 'all') {
          const playlistsPath = path.join(base, PLAYLISTS_FILE);
          if (info.hasPlaylists) {
            await fse.copy(path.join(dataDir, PLAYLISTS_FILE), playlistsPath, { overwrite: true });
          } else {
            await fse.remove(playlistsPath);
          }
        }
      } catch (error) {
        await this.rollback(base, placed, removed, trash, stamp);
        throw new PatchRestoreError('FAILED', `Could not restore snapshot: ${describe(error)}`);
      }

      await Promise.all(trash.map(p => fse.remove(p).catch(() => undefined)));
      await this.removeStaging(base, stamp);

      this.log.info(`Restored snapshot ${id} (${mode}): ${info.patches.length} patches`);
      return { restored: [...info.patches], removed };
    });
  }

  /** Deletes a snapshot. Unknown ids are ignored. */
  async discardSnapshot(id: string): Promise<void> {
    this.assertId(id);
    await fse.remove(this.snapshotDir(id));
  }

  /** Deletes every snapshot (the undo history does not survive a restart) */
  async purgeAll(): Promise<void> {
    await fse.emptyDir(this.root);
  }

  // ---------------------------------------------------------------------------

  /** Undoes a partially applied restore: put previous contents back where they were */
  private async rollback(
    base: string,
    placed: string[],
    removed: string[],
    trash: string[],
    stamp: number,
  ): Promise<void> {
    try {
      for (const dir of placed) await fse.remove(path.join(base, dir));
      for (const old of trash) {
        const dir = path
          .basename(old)
          .replace(/^__undo_old_/, '')
          .replace(`_${stamp}`, '');
        if (!(await fse.pathExists(path.join(base, dir))))
          await fse.move(old, path.join(base, dir));
      }
      this.log.warn(`Rolled back partial restore (${removed.length} removals)`);
    } catch (error) {
      this.log.warn(`Rollback of partial restore failed: ${describe(error)}`);
    }
    await this.removeStaging(base, stamp);
  }

  private async removeStaging(base: string, stamp: number): Promise<void> {
    try {
      for (const entry of await fse.readdir(base)) {
        if (entry.startsWith('__undo_new_') && entry.endsWith(`_${stamp}`)) {
          await fse.remove(path.join(base, entry));
        }
      }
    } catch {
      /* best effort */
    }
  }

  private snapshotDir(id: string): string {
    this.assertId(id);
    return path.join(this.root, id);
  }

  private async readInfo(id: string): Promise<SnapshotInfo> {
    const manifest = path.join(this.snapshotDir(id), MANIFEST);
    if (!(await fse.pathExists(manifest))) {
      throw new PatchRestoreError('NOT_FOUND', 'Undo data no longer exists');
    }
    const info = (await fse.readJson(manifest)) as SnapshotInfo;
    // Never trust the manifest for path building
    for (const dir of info.patches) this.assertPatchDir(dir);
    return info;
  }

  private assertId(id: string): void {
    if (typeof id !== 'string' || !SNAPSHOT_ID_RE.test(id)) {
      throw new PatchRestoreError('INVALID_ARGUMENT', 'Invalid snapshot id');
    }
  }

  private assertPatchDir(dir: string): void {
    if (typeof dir !== 'string' || !PATCH_DIR_RE.test(dir)) {
      throw new PatchRestoreError('INVALID_ARGUMENT', `Invalid patch directory name: ${dir}`);
    }
  }

  private async requireFolder(basePath: string): Promise<string> {
    if (typeof basePath !== 'string' || !path.isAbsolute(basePath)) {
      throw new PatchRestoreError('INVALID_ARGUMENT', 'Invalid base path');
    }
    const base = path.resolve(basePath);
    const stat = await fse.stat(base).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new PatchRestoreError('NOT_FOUND', 'Folder does not exist');
    }
    return base;
  }

  private async listPatchDirs(base: string): Promise<string[]> {
    const entries = await fse.readdir(base, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && PATCH_DIR_RE.test(e.name))
      .map(e => e.name)
      .sort();
  }

  private async sizeOf(target: string): Promise<number> {
    const stat = await fse.lstat(target);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of await fse.readdir(target)) {
      total += await this.sizeOf(path.join(target, entry));
    }
    return total;
  }
}

/** Result shape returned over IPC: expected failures carry a code instead of throwing */
export type IpcResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: PatchRestoreErrorCode; message: string };

/** Runs `fn` and converts any failure into an `{ ok: false, code, message }` result */
export async function toIpcResult<T extends object>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (error) {
    if (error instanceof PatchRestoreError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return { ok: false, code: 'FAILED', message: describe(error) };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
