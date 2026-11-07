/**
 * Test harness for undo tests: a synthetic JamMan SD card in a temp directory, and a fake
 * `window.electronAPI` wired to the real PatchRestore and BackupManager of the main process.
 * Only the thin delete/update handlers are re-implemented here (filesystem operations).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { vi } from 'vitest';
import { PatchRestore, toIpcResult } from '../../../main/src/PatchRestore';
import { BackupManager } from '../../../main/src/BackupManager';

export interface Sd {
  root: string;
  snapshotRoot: string;
  base: string;
  write: (rel: string, content: string | Buffer) => void;
  read: (rel: string) => Buffer;
  exists: (rel: string) => boolean;
  patchDirs: () => string[];
  /** Creates a patch with two phrases (xml + audio each) */
  makePatch: (dir: string, tag: string) => void;
  snapshotCount: () => number;
  cleanup: () => void;
}

export const createSd = (): Sd => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-sd-'));
  const base = path.join(root, 'sd');
  const snapshotRoot = path.join(root, 'snapshots');
  fs.mkdirSync(base);
  const write = (rel: string, content: string | Buffer) => {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  return {
    root,
    base,
    snapshotRoot,
    write,
    read: rel => fs.readFileSync(path.join(base, rel)),
    exists: rel => fs.existsSync(path.join(base, rel)),
    patchDirs: () =>
      fs
        .readdirSync(base)
        .filter(d => /^Patch\d{2}$/.test(d))
        .sort(),
    makePatch: (dir, tag) => {
      write(`${dir}/patch.xml`, `<patch>${tag}</patch>`);
      write(`${dir}/PhraseA/phrase.xml`, `<phrase>A-${tag}</phrase>`);
      write(`${dir}/PhraseA/phrase.wav`, Buffer.from(`wav-A-${tag}`));
      write(`${dir}/PhraseB/phrase.xml`, `<phrase>B-${tag}</phrase>`);
      write(`${dir}/PhraseB/phrase.wav`, Buffer.from(`wav-B-${tag}`));
    },
    snapshotCount: () =>
      fs.existsSync(snapshotRoot)
        ? fs
            .readdirSync(snapshotRoot)
            .filter(d => fs.existsSync(path.join(snapshotRoot, d, 'snapshot.json'))).length
        : 0,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

/** Payload for the fake `updatePatch`: rewrites patch.xml and PhraseA audio, drops PhraseB */
export interface FakeUpdate {
  basePath: string;
  directory: string;
  newName: string;
}

export const createFakeElectronApi = (sd: Sd) => {
  const restore = new PatchRestore({ snapshotRoot: sd.snapshotRoot });

  const api = {
    readPatches: vi.fn(async (folder: string) =>
      fs
        .readdirSync(folder)
        .filter(d => /^Patch\d{2}$/.test(d))
        .sort()
        .map(dir => ({ dir, data: {}, phrases: [] })),
    ),
    getFolderSize: vi.fn(async () => ({ sizeBytes: 0, sizeMB: 0, sizeGB: 0 })),

    deletePatch: vi.fn(async (basePath: string, directory: string) => {
      fs.rmSync(path.join(basePath, directory), { recursive: true });
    }),
    deletePatchBatch: vi.fn(async (basePath: string, directories: string[]) => {
      const deleted: string[] = [];
      for (const dir of directories) {
        const p = path.join(basePath, dir);
        if (!fs.existsSync(p)) continue;
        fs.rmSync(p, { recursive: true });
        deleted.push(dir);
      }
      return { success: true, deleted, failed: directories.length - deleted.length };
    }),
    updatePatch: vi.fn(async (data: FakeUpdate) => {
      const dir = path.join(data.basePath, data.directory);
      fs.writeFileSync(path.join(dir, 'patch.xml'), `<patch>${data.newName}</patch>`);
      fs.writeFileSync(
        path.join(dir, 'PhraseA', 'phrase.wav'),
        Buffer.from(`wav-new-${data.newName}`),
      );
      fs.rmSync(path.join(dir, 'PhraseB'), { recursive: true, force: true });
    }),
    restoreBackup: vi.fn(
      async (backupPath: string, targetPath: string, mode: 'replace' | 'merge') =>
        BackupManager.restoreBackup({ backupPath, targetPath, mode }),
    ),

    createUndoSnapshot: vi.fn(
      (basePath: string, scope: Parameters<PatchRestore['createSnapshot']>[1]) =>
        toIpcResult(async () => ({ snapshot: await restore.createSnapshot(basePath, scope) })),
    ),
    restoreUndoSnapshot: vi.fn(
      (id: string, basePath: string, mode: 'add' | 'replace', only?: string[]) =>
        toIpcResult(() => restore.restoreSnapshot(id, basePath, mode, only)),
    ),
    discardUndoSnapshot: vi.fn((id: string) => restore.discardSnapshot(id)),
  };
  return api;
};

/** Waits for fire-and-forget work (snapshot discards) to settle */
export const flush = () => new Promise(resolve => setTimeout(resolve, 30));
