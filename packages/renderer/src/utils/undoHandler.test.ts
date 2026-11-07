import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';

vi.mock('react-toastify', () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

import { toast } from 'react-toastify';
import { BackupManager } from '../../../main/src/BackupManager';
import { useUndoStore } from '../store/useUndoStore';
import { usePatchStore } from '../store/usePatchStore';
import { executeUndo, executeRedo } from './undoHandler';
import { createFakeElectronApi, createSd, flush, type Sd } from './undoTestHarness';

let sd: Sd;
let api: ReturnType<typeof createFakeElectronApi>;

const undoStack = () => useUndoStore.getState().undoStack;
const redoStack = () => useUndoStore.getState().redoStack;
const patchStore = () => usePatchStore.getState();

beforeEach(async () => {
  sd = createSd();
  sd.makePatch('Patch01', 'one');
  sd.makePatch('Patch02', 'two');
  sd.makePatch('Patch03', 'three');
  api = createFakeElectronApi(sd);
  vi.stubGlobal('window', { electronAPI: api });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
  useUndoStore.setState({ undoStack: [], redoStack: [], maxHistorySize: 50 });
  usePatchStore.setState({ currentFolder: null, patches: [], selectedPatchDirs: [] });
  await patchStore().loadPatches(sd.base);
});

afterEach(async () => {
  await flush();
  sd.cleanup();
  vi.unstubAllGlobals();
});

/** Content tag of every patch folder, in folder order: what the user sees as the order */
const tags = () => sd.patchDirs().map(d => sd.read(`${d}/patch.xml`).toString());
const patchesByDir = () => patchStore().patches;
/** The `Patch` objects of the store, reordered by the tag of their content (as the UI would) */
const reorderTo = async (order: string[]) => {
  const byTag = new Map(
    patchesByDir().map(p => [sd.read(`${p.dir}/patch.xml`).toString(), p] as const),
  );
  await patchStore().reorderPatches(order.map(tag => byTag.get(`<patch>${tag}</patch>`)!));
};

describe('undo of REORDER_PATCHES', () => {
  it('puts every patch back in its old folder with its phrases and audio, and redo reorders again', async () => {
    const audio = (dir: string) => sd.read(`${dir}/PhraseA/phrase.wav`).toString();
    await reorderTo(['three', 'one', 'two']);
    expect(tags()).toEqual(['<patch>three</patch>', '<patch>one</patch>', '<patch>two</patch>']);
    expect(audio('Patch01')).toBe('wav-A-three');
    expect(undoStack()).toHaveLength(1);

    expect(await executeUndo()).toBe(true);
    expect(tags()).toEqual(['<patch>one</patch>', '<patch>two</patch>', '<patch>three</patch>']);
    expect(audio('Patch01')).toBe('wav-A-one');
    expect(audio('Patch02')).toBe('wav-A-two');
    expect(audio('Patch03')).toBe('wav-A-three');
    expect(sd.read('Patch02/PhraseB/phrase.xml').toString()).toBe('<phrase>B-two</phrase>');
    expect(patchStore().patches.map(p => p.dir)).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(redoStack()).toHaveLength(1);
    expect(undoStack()).toHaveLength(0);

    expect(await executeRedo()).toBe(true);
    expect(tags()).toEqual(['<patch>three</patch>', '<patch>one</patch>', '<patch>two</patch>']);
    expect(audio('Patch01')).toBe('wav-A-three');
    expect(undoStack()).toHaveLength(1);
    expect(redoStack()).toHaveLength(0);

    // and it can go back again
    expect(await executeUndo()).toBe(true);
    expect(tags()).toEqual(['<patch>one</patch>', '<patch>two</patch>', '<patch>three</patch>']);
  });

  it('undoes a swap of two patches (a permutation that is its own inverse)', async () => {
    await reorderTo(['two', 'one', 'three']);
    expect(await executeUndo()).toBe(true);
    expect(tags()).toEqual(['<patch>one</patch>', '<patch>two</patch>', '<patch>three</patch>']);
  });

  it('undoes a rotation, which is not its own inverse', async () => {
    // Re-sending the order the patches had before would leave them where they are
    await reorderTo(['two', 'three', 'one']);
    expect(await executeUndo()).toBe(true);
    expect(tags()).toEqual(['<patch>one</patch>', '<patch>two</patch>', '<patch>three</patch>']);
    expect(await executeRedo()).toBe(true);
    expect(tags()).toEqual(['<patch>two</patch>', '<patch>three</patch>', '<patch>one</patch>']);
  });

  it('undoes two consecutive reorders one at a time, in reverse order', async () => {
    await reorderTo(['two', 'three', 'one']);
    await reorderTo(['one', 'three', 'two']);
    expect(await executeUndo()).toBe(true);
    expect(tags()).toEqual(['<patch>two</patch>', '<patch>three</patch>', '<patch>one</patch>']);
    expect(await executeUndo()).toBe(true);
    expect(tags()).toEqual(['<patch>one</patch>', '<patch>two</patch>', '<patch>three</patch>']);
    expect(await executeRedo()).toBe(true);
    expect(await executeRedo()).toBe(true);
    expect(tags()).toEqual(['<patch>one</patch>', '<patch>three</patch>', '<patch>two</patch>']);
  });

  it('sends the folders the patches occupy now, not the ones they had before', async () => {
    await reorderTo(['three', 'one', 'two']);
    api.reorderPatches.mockClear();
    await executeUndo();
    // one lives in Patch02, two in Patch03, three in Patch01 after the reorder
    expect(api.reorderPatches).toHaveBeenCalledWith(sd.base, ['Patch02', 'Patch03', 'Patch01']);
    api.reorderPatches.mockClear();
    await executeRedo();
    expect(api.reorderPatches).toHaveBeenCalledWith(sd.base, ['Patch03', 'Patch01', 'Patch02']);
  });

  it('does not push a new history entry while undoing or redoing', async () => {
    await reorderTo(['three', 'one', 'two']);
    await executeUndo();
    expect(undoStack()).toHaveLength(0);
    await executeRedo();
    expect(undoStack()).toHaveLength(1);
    expect(redoStack()).toHaveLength(0);
  });

  it('refuses (and drops the entry) when the folders changed after the reorder', async () => {
    await reorderTo(['three', 'one', 'two']);
    await api.deletePatch(sd.base, 'Patch02');
    await patchStore().loadPatches(sd.base, true);
    api.reorderPatches.mockClear();

    expect(await executeUndo()).toBe(false);
    expect(api.reorderPatches).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('changed after the reorder'));
    expect(undoStack()).toHaveLength(0);
  });

  it('refuses when another folder is open', async () => {
    await reorderTo(['three', 'one', 'two']);
    usePatchStore.setState({ currentFolder: '/somewhere/else' });
    api.reorderPatches.mockClear();
    expect(await executeUndo()).toBe(false);
    expect(api.reorderPatches).not.toHaveBeenCalled();
  });
});

describe('undo of DELETE_PATCH', () => {
  it('restores the deleted patch with its phrases and audio, and redo deletes it again', async () => {
    const audioA = sd.read('Patch02/PhraseA/phrase.wav');
    const audioB = sd.read('Patch02/PhraseB/phrase.wav');

    await patchStore().deletePatch('Patch02');
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch03']);
    expect(undoStack()).toHaveLength(1);

    expect(await executeUndo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>two</patch>');
    expect(sd.read('Patch02/PhraseA/phrase.wav').equals(audioA)).toBe(true);
    expect(sd.read('Patch02/PhraseB/phrase.wav').equals(audioB)).toBe(true);
    expect(patchStore().patches.map(p => p.dir)).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(redoStack()).toHaveLength(1);

    expect(await executeRedo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch03']);
    expect(patchStore().patches.map(p => p.dir)).toEqual(['Patch01', 'Patch03']);
    // redo must not create a new history entry, and the snapshot must survive for another undo
    expect(undoStack()).toHaveLength(1);
    expect(redoStack()).toHaveLength(0);

    expect(await executeUndo()).toBe(true);
    expect(sd.read('Patch02/PhraseA/phrase.wav').equals(audioA)).toBe(true);
  });

  it('keeps the entry when the slot was taken, and works after the user frees it', async () => {
    await patchStore().deletePatch('Patch02');
    sd.makePatch('Patch02', 'someone-else');

    expect(await executeUndo()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Patch02'));
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>someone-else</patch>');
    expect(undoStack()).toHaveLength(1);
    expect(redoStack()).toHaveLength(0);

    await api.deletePatch(sd.base, 'Patch02');
    expect(await executeUndo()).toBe(true);
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>two</patch>');
  });

  it('drops the entry when its snapshot no longer exists, so older actions are not blocked', async () => {
    await patchStore().deletePatch('Patch01');
    await patchStore().deletePatch('Patch02');
    const [, last] = undoStack();
    if (last.type !== 'DELETE_PATCH') throw new Error('unexpected action');
    await api.discardUndoSnapshot(last.snapshotId);

    expect(await executeUndo()).toBe(false);
    expect(undoStack()).toHaveLength(1);
    expect(redoStack()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Can't undo"));

    expect(await executeUndo()).toBe(true); // the older delete is still undoable
    expect(sd.exists('Patch01/PhraseA/phrase.wav')).toBe(true);
  });

  it('still deletes but warns (and records no undo) when the snapshot cannot be taken', async () => {
    api.createUndoSnapshot.mockResolvedValueOnce({
      ok: false,
      code: 'TOO_LARGE',
      message: 'too big',
    });

    await patchStore().deletePatch('Patch02');

    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch03']);
    expect(undoStack()).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith("This action can't be undone: too big");
  });

  it('does not leave a snapshot behind when the delete itself fails', async () => {
    api.deletePatch.mockRejectedValueOnce(new Error('disk error'));
    await expect(patchStore().deletePatch('Patch02')).rejects.toThrow('disk error');
    await flush();
    expect(undoStack()).toHaveLength(0);
    expect(sd.snapshotCount()).toBe(0);
  });
});

describe('undo of DELETE_PATCHES', () => {
  it('restores every patch of a batch delete with audio, then redo deletes them again', async () => {
    const audio1 = sd.read('Patch01/PhraseA/phrase.wav');
    const audio3 = sd.read('Patch03/PhraseB/phrase.wav');

    await patchStore().deletePatches(['Patch01', 'Patch03']);
    expect(sd.patchDirs()).toEqual(['Patch02']);

    expect(await executeUndo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(sd.read('Patch01/PhraseA/phrase.wav').equals(audio1)).toBe(true);
    expect(sd.read('Patch03/PhraseB/phrase.wav').equals(audio3)).toBe(true);

    expect(await executeRedo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch02']);
    expect(await executeUndo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch02', 'Patch03']);
  });

  it('only restores what a partially failed batch really deleted', async () => {
    api.deletePatchBatch.mockImplementationOnce(async (base: string, dirs: string[]) => {
      // Pretend Patch02 could not be deleted
      const deleted: string[] = [];
      for (const dir of dirs.filter(d => d !== 'Patch02')) {
        await api.deletePatch(base, dir);
        deleted.push(dir);
      }
      return { success: true, deleted, failed: 1 };
    });

    await patchStore().deletePatches(['Patch01', 'Patch02', 'Patch03']);
    expect(sd.patchDirs()).toEqual(['Patch02']);

    expect(await executeUndo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch02', 'Patch03']);
  });

  it('records nothing when no patch was deleted', async () => {
    api.deletePatchBatch.mockResolvedValueOnce({ success: true, deleted: [], failed: 1 });
    await patchStore().deletePatches(['Patch01']);
    await flush();
    expect(undoStack()).toHaveLength(0);
    expect(sd.snapshotCount()).toBe(0);
  });
});

describe('undo of UPDATE_PATCH', () => {
  const edit = (newName: string) =>
    patchStore().updatePatch({ basePath: sd.base, directory: 'Patch02', newName });

  it('reverts the edit including overwritten audio and removed phrases, and redo re-applies it', async () => {
    const originalAudio = sd.read('Patch02/PhraseA/phrase.wav');

    await edit('edited');
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>edited</patch>');
    expect(sd.exists('Patch02/PhraseB')).toBe(false);

    expect(await executeUndo()).toBe(true);
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>two</patch>');
    expect(sd.read('Patch02/PhraseA/phrase.wav').equals(originalAudio)).toBe(true);
    expect(sd.read('Patch02/PhraseB/phrase.wav').toString()).toBe('wav-B-two');

    expect(await executeRedo()).toBe(true);
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>edited</patch>');
    expect(sd.read('Patch02/PhraseA/phrase.wav').toString()).toBe('wav-new-edited');
    expect(sd.exists('Patch02/PhraseB')).toBe(false);

    // undo again after a redo goes back to the original once more
    expect(await executeUndo()).toBe(true);
    expect(sd.read('Patch02/PhraseA/phrase.wav').equals(originalAudio)).toBe(true);
  });

  it('undoes two consecutive edits in order', async () => {
    await edit('first');
    await edit('second');

    await executeUndo();
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>first</patch>');
    await executeUndo();
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>two</patch>');
    await executeRedo();
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>first</patch>');
  });

  it('leaves other patches alone', async () => {
    await edit('edited');
    sd.write('Patch01/patch.xml', '<patch>touched-later</patch>');
    await executeUndo();
    expect(sd.read('Patch01/patch.xml').toString()).toBe('<patch>touched-later</patch>');
  });

  it('allows undo but not redo when the edited state cannot be captured, and says so', async () => {
    await edit('edited');
    api.createUndoSnapshot.mockResolvedValueOnce({
      ok: false,
      code: 'FAILED',
      message: 'disk full',
    });

    expect(await executeUndo()).toBe(true);
    expect(sd.read('Patch02/patch.xml').toString()).toBe('<patch>two</patch>');
    expect(redoStack()).toHaveLength(0); // not offered as redoable
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("can't be redone"));
  });

  it('discards the snapshot when the edit fails', async () => {
    api.updatePatch.mockRejectedValueOnce(new Error('bad wav'));
    await expect(edit('x')).rejects.toThrow('bad wav');
    await flush();
    expect(undoStack()).toHaveLength(0);
    expect(sd.snapshotCount()).toBe(0);
  });
});

describe('undo of RESTORE_BACKUP', () => {
  let backupPath: string;

  beforeEach(async () => {
    // A backup with different content: Patch01 (changed) and Patch05
    const other = createSd();
    other.makePatch('Patch01', 'from-backup');
    other.makePatch('Patch05', 'from-backup-5');
    other.write('.jamman-playlists.json', '{"playlists":["from-backup"]}');
    backupPath = path.join(other.root, 'backup.zip');
    await BackupManager.createBackup({
      basePath: other.base,
      outputPath: backupPath,
      includePlaylist: true,
    });
    sd.write('.jamman-playlists.json', '{"playlists":["mine"]}');
    // keep `other` alive until the test ends
    afterEachCleanup.push(other.cleanup);
  });

  const afterEachCleanup: Array<() => void> = [];
  afterEach(() => afterEachCleanup.splice(0).forEach(fn => fn()));

  it('reverts a replace-mode restore (patches, audio and playlists) and redo re-applies it', async () => {
    const audio3 = sd.read('Patch03/PhraseA/phrase.wav');

    await patchStore().restoreBackup(backupPath, 'replace');
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch05']);
    expect(sd.read('.jamman-playlists.json').toString()).toContain('from-backup');

    expect(await executeUndo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(sd.read('Patch01/patch.xml').toString()).toBe('<patch>one</patch>');
    expect(sd.read('Patch03/PhraseA/phrase.wav').equals(audio3)).toBe(true);
    expect(sd.read('.jamman-playlists.json').toString()).toBe('{"playlists":["mine"]}');
    expect(patchStore().patches.map(p => p.dir)).toEqual(['Patch01', 'Patch02', 'Patch03']);

    expect(await executeRedo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch05']);
    expect(sd.read('Patch01/patch.xml').toString()).toBe('<patch>from-backup</patch>');
    expect(sd.read('.jamman-playlists.json').toString()).toContain('from-backup');
  });

  it('reverts a merge-mode restore by removing only what it added', async () => {
    await patchStore().restoreBackup(backupPath, 'merge');
    expect(sd.patchDirs().length).toBeGreaterThan(3);

    expect(await executeUndo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(sd.read('Patch01/patch.xml').toString()).toBe('<patch>one</patch>');
    expect(sd.read('.jamman-playlists.json').toString()).toBe('{"playlists":["mine"]}');
  });

  it('keeps the way back when a restore fails half way', async () => {
    api.restoreBackup.mockImplementationOnce(async (_b: string, target: string) => {
      await api.deletePatch(target, 'Patch01'); // partial damage, then failure
      throw new Error('zip is corrupt');
    });

    await expect(patchStore().restoreBackup(backupPath, 'replace')).rejects.toThrow('corrupt');
    expect(sd.patchDirs()).toEqual(['Patch02', 'Patch03']);

    expect(await executeUndo()).toBe(true);
    expect(sd.patchDirs()).toEqual(['Patch01', 'Patch02', 'Patch03']);
  });

  it('warns and records no undo when the folder is too big to snapshot', async () => {
    api.createUndoSnapshot.mockResolvedValueOnce({
      ok: false,
      code: 'TOO_LARGE',
      message: 'too big',
    });
    await patchStore().restoreBackup(backupPath, 'replace');
    expect(undoStack()).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith("This action can't be undone: too big");
  });
});

describe('history and snapshots lifecycle', () => {
  it('frees the snapshot of an action trimmed off the history', async () => {
    useUndoStore.setState({ maxHistorySize: 2 });
    await patchStore().deletePatch('Patch01');
    await patchStore().deletePatch('Patch02');
    await patchStore().deletePatch('Patch03');
    await flush();
    expect(undoStack()).toHaveLength(2);
    expect(sd.snapshotCount()).toBe(2);
  });

  it('frees the snapshots of redo entries when a new action supersedes them', async () => {
    await patchStore().deletePatch('Patch01');
    await executeUndo();
    expect(redoStack()).toHaveLength(1);
    await patchStore().deletePatch('Patch02');
    await flush();
    expect(redoStack()).toHaveLength(0);
    expect(sd.snapshotCount()).toBe(1);
  });

  it('frees every snapshot when the history is cleared', async () => {
    await patchStore().deletePatch('Patch01');
    await patchStore().deletePatches(['Patch02', 'Patch03']);
    expect(sd.snapshotCount()).toBe(2);
    useUndoStore.getState().clearHistory();
    await flush();
    expect(sd.snapshotCount()).toBe(0);
  });

  it('clears the history when another folder is opened', async () => {
    await patchStore().deletePatch('Patch01');
    const other = createSd();
    other.makePatch('Patch01', 'x');
    try {
      await patchStore().loadPatches(other.base);
      await flush();
      expect(undoStack()).toHaveLength(0);
      expect(sd.snapshotCount()).toBe(0);
    } finally {
      other.cleanup();
    }
  });

  it('refuses to undo an action of a folder that is no longer open', async () => {
    await patchStore().deletePatch('Patch01');
    usePatchStore.setState({ currentFolder: path.join(sd.root, 'elsewhere') });
    expect(await executeUndo()).toBe(false);
    expect(sd.exists('Patch01')).toBe(false);
    expect(undoStack()).toHaveLength(0); // dropped: it can never apply here
  });

  it('a failed undo does not leave the action in both stacks', async () => {
    await patchStore().deletePatch('Patch02');
    sd.makePatch('Patch02', 'occupant');
    await executeUndo();
    expect(undoStack()).toHaveLength(1);
    expect(redoStack()).toHaveLength(0);
  });
});
