import { beforeEach, describe, expect, it } from 'vitest';
import type { PatchForm, PhraseForm } from '@app/preload/ipc-contract';
import {
  FAKE_INTERNAL_ROOT,
  FakePedal,
  patchXml,
  phraseXml,
  wavBytes,
} from '../test-utils/fakePedal.js';
import { PatchRestoreError } from '../PatchRestore.js';
import { SecureXMLParser } from '../SecureXMLParser.js';
import { GreenglassClient } from './GreenglassClient.js';
import { MessageID } from './greenglassCodec.js';
import { PedalEditor, type PedalProgress } from './PedalEditor.js';
import { createWriteGuard } from './PedalFiles.js';
import { wavPath } from './pedalPaths.js';

const ROOT = FAKE_INTERNAL_ROOT;
const UNDO = '/mnt/nandfs/.jamman-manager/undo/';
const silentLog = { info: () => {}, warn: () => {} };

/** WAVs "on the computer", as the dialog would pick them. */
const LOCAL: Record<string, Buffer> = {
  '/Users/me/new.wav': wavBytes(20_000),
  '/Users/me/other.wav': wavBytes(500),
};

let pedal: FakePedal;
let editor: PedalEditor;
let progress: PedalProgress[];

/** Each phrase WAV has its own bytes, so tests can tell which file is where. */
const wavOf = (dir: string, phrase: string) =>
  Buffer.concat([wavBytes(400), Buffer.from(`${dir}/${phrase}`)]);

function addPatch(dir: string, name: string, phrases = ['PhraseA']) {
  pedal.setFile(`${ROOT}${dir}/patch.xml`, patchXml(name));
  for (const phrase of phrases) {
    pedal.setFile(`${ROOT}${dir}/${phrase}/phrase.xml`, phraseXml(100));
    pedal.setFile(`${ROOT}${dir}/${phrase}/phrase.wav`, wavOf(dir, phrase));
  }
}

const nameOf = async (dir: string) =>
  (await SecureXMLParser.parsePatchXML(pedal.files.get(`${ROOT}${dir}/patch.xml`)!.toString()))
    .JamManPatch.PatchName[0];
const wavAt = (dir: string, phrase = 'PhraseA') =>
  pedal.files.get(`${ROOT}${dir}/${phrase}/phrase.wav`);
const pool = () => pedal.tree(UNDO).filter(p => p.endsWith('.wav'));

function phrase(dir: string, name = 'PhraseA', wav = wavPath('internal', dir, name)): PhraseForm {
  return {
    name,
    wavPath: wav,
    beatsPerMinute: 90,
    beatsPerMeasure: 3,
    isLoop: false,
    isReversed: true,
  };
}

function form(dir: string, overrides: Partial<PatchForm> = {}): PatchForm {
  return {
    basePath: 'jamman-pedal://internal',
    directory: dir,
    patchName: 'Renamed',
    rhythmType: 'Click',
    stopMode: 'FadeOut',
    settingsVersion: '3',
    patchID: `id-${dir}`,
    phrases: [phrase(dir)],
    ...overrides,
  };
}

beforeEach(() => {
  pedal = new FakePedal();
  pedal.folders.add('/mnt/nandfs/');
  pedal.folders.add(ROOT);
  addPatch('Patch01', 'One');
  addPatch('Patch02', 'Two');
  addPatch('Patch03', 'Three');
  progress = [];
  const client = new GreenglassClient(pedal.transport, { requestTimeoutMs: 500 });
  editor = new PedalEditor(client, () => ROOT, createWriteGuard([ROOT]), silentLog, {
    readLocalFile: async path => {
      if (!LOCAL[path]) throw new Error(`ENOENT: ${path}`);
      return LOCAL[path];
    },
    onProgress: p => progress.push(p),
  });
});

describe('edit', () => {
  it('rewrites the XML files and keeps the audio and IDs', async () => {
    const wavBefore = wavAt('Patch01');
    await editor.updatePatch('internal', form('Patch01'));

    const patch = await SecureXMLParser.parsePatchXML(
      pedal.files.get(`${ROOT}Patch01/patch.xml`)!.toString(),
    );
    expect(patch.JamManPatch).toMatchObject({
      PatchName: ['Renamed'],
      RhythmType: ['Click'],
      StopMode: ['FadeOut'],
      SettingsVersion: ['4'],
      ID: ['id-Patch01'],
    });
    const xml = await SecureXMLParser.parsePhraseXML(
      pedal.files.get(`${ROOT}Patch01/PhraseA/phrase.xml`)!.toString(),
    );
    expect(xml.JamManPhrase).toMatchObject({
      BeatsPerMinute: ['90'],
      BeatsPerMeasure: ['3'],
      IsLoop: ['0'],
      IsReversed: ['1'],
    });
    expect(wavAt('Patch01')).toEqual(wavBefore);
    expect(pedal.reads.filter(p => p.endsWith('.wav'))).toEqual([]);
    expect(progress).toEqual([]);
  });

  it('replaces a WAV with one from the computer, reporting progress', async () => {
    await editor.updatePatch(
      'internal',
      form('Patch01', { phrases: [phrase('Patch01', 'PhraseA', '/Users/me/new.wav')] }),
    );
    expect(wavAt('Patch01')).toEqual(LOCAL['/Users/me/new.wav']);
    expect(pedal.files.has(`${ROOT}Patch01/PhraseA/phrase.wav.tmp`)).toBe(false);
    // Nothing protected the old WAV, so it is gone rather than parked
    expect(pool()).toEqual([]);
    expect(progress.at(0)).toEqual({ label: 'Uploading PhraseA', done: 0, total: 20_044 });
    expect(progress.at(-1)).toEqual({ label: 'Uploading PhraseA', done: 20_044, total: 20_044 });
    expect(progress.length).toBe(4); // 0, then one per 8158-byte block
  });

  it('adds and removes phrases', async () => {
    addPatch('Patch04', 'Four', ['PhraseA', 'PhraseB']);
    await editor.updatePatch(
      'internal',
      form('Patch04', {
        phrases: [
          phrase('Patch04', 'PhraseA'),
          phrase('Patch04', 'PhraseC', '/Users/me/other.wav'),
        ],
      }),
    );
    expect(pedal.folderExists(`${ROOT}Patch04/PhraseB/`)).toBe(false);
    expect(wavAt('Patch04', 'PhraseC')).toEqual(LOCAL['/Users/me/other.wav']);
    expect(pedal.files.has(`${ROOT}Patch04/PhraseC/phrase.xml`)).toBe(true);
    expect(wavAt('Patch04', 'PhraseA')).toEqual(wavOf('Patch04', 'PhraseA'));
  });

  it('leaves the patch untouched when an upload fails', async () => {
    pedal.failures.set(MessageID.FileWriteRequest, 'disk full');
    await expect(
      editor.updatePatch(
        'internal',
        form('Patch01', { phrases: [phrase('Patch01', 'PhraseA', '/Users/me/new.wav')] }),
      ),
    ).rejects.toThrow('disk full');
    expect(wavAt('Patch01')).toEqual(wavOf('Patch01', 'PhraseA'));
    expect(await nameOf('Patch01')).toBe('One');
    expect(pedal.tree(`${ROOT}Patch01/`).some(p => p.endsWith('.tmp'))).toBe(false);
  });

  it('refuses a WAV taken from another patch on the pedal', async () => {
    await expect(
      editor.updatePatch(
        'internal',
        form('Patch01', {
          phrases: [phrase('Patch01', 'PhraseA', wavPath('internal', 'Patch02', 'PhraseA'))],
        }),
      ),
    ).rejects.toThrow(/WAV from the computer/);
    await expect(editor.updatePatch('internal', form('Patch01', { phrases: [] }))).rejects.toThrow(
      /at least one phrase/,
    );
  });

  it('fails for a patch that does not exist', async () => {
    await expect(editor.updatePatch('internal', form('Patch09'))).rejects.toThrow(/does not exist/);
  });
});

describe('create', () => {
  it('creates a patch in a free slot with the uploaded audio', async () => {
    await editor.createPatch(
      'internal',
      form('Patch10', {
        phrases: [
          phrase('Patch10', 'PhraseA', '/Users/me/new.wav'),
          phrase('Patch10', 'PhraseB', '/Users/me/other.wav'),
        ],
      }),
    );
    expect(await nameOf('Patch10')).toBe('Renamed');
    expect(wavAt('Patch10', 'PhraseA')).toEqual(LOCAL['/Users/me/new.wav']);
    expect(wavAt('Patch10', 'PhraseB')).toEqual(LOCAL['/Users/me/other.wav']);
    expect(progress.map(p => p.label)).toContain('Uploading PhraseB');
  });

  it('refuses a slot in use, and removes a half-created patch', async () => {
    await expect(
      editor.createPatch(
        'internal',
        form('Patch01', { phrases: [phrase('Patch01', 'PhraseA', '/Users/me/new.wav')] }),
      ),
    ).rejects.toThrow(/already exists/);
    expect(await nameOf('Patch01')).toBe('One');

    await expect(
      editor.createPatch(
        'internal',
        form('Patch10', { phrases: [phrase('Patch10', 'PhraseA', '/Users/me/missing.wav')] }),
      ),
    ).rejects.toThrow(/Failed to create patch: ENOENT/);
    expect(pedal.folderExists(`${ROOT}Patch10/`)).toBe(false);
  });
});

describe('delete and undo', () => {
  it('deletes for good when nothing protects the patch', async () => {
    expect(await editor.deletePatches('internal', ['Patch02', 'Patch07'])).toEqual({
      deleted: ['Patch02'],
      failed: 1,
    });
    expect(pedal.folderExists(`${ROOT}Patch02/`)).toBe(false);
    expect(pedal.folderExists(UNDO)).toBe(false);
  });

  it('parks the WAVs of a protected patch and brings it back, as many times as undo/redo asks', async () => {
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch02'],
    });
    expect(snapshot).toMatchObject({
      basePath: 'jamman-pedal://internal',
      scope: 'patches',
      patches: ['Patch02'],
    });

    for (let cycle = 0; cycle < 2; cycle++) {
      // Delete (the redo deletes again without a new snapshot)
      await editor.deletePatches('internal', ['Patch02']);
      expect(pedal.folderExists(`${ROOT}Patch02/`)).toBe(false);
      expect(pool().map(p => pedal.files.get(p))).toEqual([wavOf('Patch02', 'PhraseA')]);

      expect(await editor.restoreSnapshot(snapshot.id, 'internal', 'add')).toEqual({
        restored: ['Patch02'],
        removed: [],
      });
      expect(await nameOf('Patch02')).toBe('Two');
      expect(wavAt('Patch02')).toEqual(wavOf('Patch02', 'PhraseA'));
      expect(pedal.folderExists(UNDO)).toBe(false);
    }
    // No audio ever crossed the cable: only XML was read, and only XML written
    expect(pedal.reads.filter(p => p.endsWith('.wav'))).toEqual([]);
    expect(pedal.requests.filter(id => id === MessageID.FileWriteRequest)).toHaveLength(4);

    await editor.deletePatches('internal', ['Patch02']);
    await editor.discardSnapshot(snapshot.id);
    expect(pedal.folderExists(UNDO)).toBe(false);
    await expect(editor.restoreSnapshot(snapshot.id, 'internal', 'add')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('undoes and redoes a WAV replacement by swapping files on the pedal', async () => {
    // What the renderer does: snapshot, edit; undo = capture + restore before; redo = restore captured
    const before = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch01'],
    });
    await editor.updatePatch(
      'internal',
      form('Patch01', { phrases: [phrase('Patch01', 'PhraseA', '/Users/me/new.wav')] }),
    );
    expect(pool().map(p => pedal.files.get(p))).toEqual([wavOf('Patch01', 'PhraseA')]);

    for (let cycle = 0; cycle < 2; cycle++) {
      const after = await editor.createSnapshot('internal', {
        kind: 'patches',
        patches: ['Patch01'],
      });
      await editor.restoreSnapshot(before.id, 'internal', 'replace');
      expect(wavAt('Patch01')).toEqual(wavOf('Patch01', 'PhraseA'));
      expect(await nameOf('Patch01')).toBe('One');

      await editor.restoreSnapshot(after.id, 'internal', 'replace');
      expect(wavAt('Patch01')).toEqual(LOCAL['/Users/me/new.wav']);
      expect(await nameOf('Patch01')).toBe('Renamed');
      await editor.discardSnapshot(after.id);
    }
    expect(pool()).toHaveLength(1); // only the original, still needed by `before`
    await editor.discardSnapshot(before.id);
    expect(pedal.folderExists(UNDO)).toBe(false);
  });

  it('undoes an added phrase and redoes it', async () => {
    const before = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch01'],
    });
    await editor.updatePatch(
      'internal',
      form('Patch01', {
        phrases: [phrase('Patch01'), phrase('Patch01', 'PhraseB', '/Users/me/other.wav')],
      }),
    );

    const after = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch01'],
    });
    await editor.restoreSnapshot(before.id, 'internal', 'replace');
    expect(pedal.folderExists(`${ROOT}Patch01/PhraseB/`)).toBe(false);
    expect(wavAt('Patch01')).toEqual(wavOf('Patch01', 'PhraseA'));

    await editor.restoreSnapshot(after.id, 'internal', 'replace');
    expect(wavAt('Patch01', 'PhraseB')).toEqual(LOCAL['/Users/me/other.wav']);
    expect(pedal.files.has(`${ROOT}Patch01/PhraseB/phrase.xml`)).toBe(true);
  });

  it('follows a patch renamed by a reorder', async () => {
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch03'],
    });
    await editor.reorderPatches('internal', ['Patch03', 'Patch01', 'Patch02']);
    // The WAV the snapshot refers to now lives in Patch01; deleting it parks it.
    await editor.deletePatches('internal', ['Patch01']);
    expect(pool().map(p => pedal.files.get(p))).toEqual([wavOf('Patch03', 'PhraseA')]);
    await editor.discardSnapshot(snapshot.id);
    expect(pool()).toEqual([]);
  });

  it('refuses to restore over a patch that took the slot', async () => {
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch02'],
    });
    await editor.deletePatches('internal', ['Patch02']);
    addPatch('Patch02', 'Newcomer');
    await expect(editor.restoreSnapshot(snapshot.id, 'internal', 'add')).rejects.toMatchObject({
      code: 'SLOT_OCCUPIED',
    });
    expect(await nameOf('Patch02')).toBe('Newcomer');
  });

  it('restores only the patches asked for', async () => {
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch01', 'Patch02'],
    });
    await editor.deletePatches('internal', ['Patch01', 'Patch02']);
    await editor.restoreSnapshot(snapshot.id, 'internal', 'add', ['Patch02']);
    expect(pedal.folderExists(`${ROOT}Patch01/`)).toBe(false);
    expect(pedal.folderExists(`${ROOT}Patch02/`)).toBe(true);
    expect(pool().map(p => pedal.files.get(p))).toEqual([wavOf('Patch01', 'PhraseA')]);
    await expect(
      editor.restoreSnapshot(snapshot.id, 'internal', 'add', ['Patch09']),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects snapshots it cannot take or use', async () => {
    await expect(editor.createSnapshot('internal', { kind: 'all' })).rejects.toBeInstanceOf(
      PatchRestoreError,
    );
    await expect(
      editor.createSnapshot('internal', { kind: 'patches', patches: ['Patch09'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch01'],
    });
    await expect(editor.restoreSnapshot(snapshot.id, 'sd', 'add')).rejects.toMatchObject({
      code: 'WRONG_FOLDER',
    });
    // Never deleted, so there is nothing to add back
    await expect(editor.restoreSnapshot(snapshot.id, 'internal', 'add')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('purges undo data left by an earlier session', async () => {
    pedal.setFile(`${UNDO}old.wav`, 'x');
    await editor.purgeUndoData(['internal']);
    expect(pedal.folderExists(UNDO)).toBe(false);
    expect(pedal.folderExists('/mnt/nandfs/.jamman-manager/')).toBe(true);
  });
});

describe('reorder', () => {
  it('renames only the folders that change', async () => {
    await editor.reorderPatches('internal', ['Patch03', 'Patch02', 'Patch01']);
    expect([await nameOf('Patch01'), await nameOf('Patch02'), await nameOf('Patch03')]).toEqual([
      'Three',
      'Two',
      'One',
    ]);
    expect(pedal.folderExists('/mnt/nandfs/.jamman-manager/reorder/')).toBe(false);
    expect(pedal.requests).not.toContain(MessageID.FileReadRequest);
  });

  it('compacts the slots after a gap', async () => {
    addPatch('Patch07', 'Seven');
    await editor.reorderPatches('internal', ['Patch07', 'Patch01', 'Patch02', 'Patch03']);
    expect(await nameOf('Patch01')).toBe('Seven');
    expect(await nameOf('Patch04')).toBe('Three');
    expect(pedal.folderExists(`${ROOT}Patch07/`)).toBe(false);
  });

  const fileMoves = () =>
    pedal.requests.filter(id => id === MessageID.FileSystemEntryMoveRequest).length;

  it('breaks a cycle with a single parked folder', async () => {
    // Patch01→Patch02→Patch03→Patch01: 3 folders, 4 folder moves, 3 files each.
    await editor.reorderPatches('internal', ['Patch03', 'Patch01', 'Patch02']);
    expect([await nameOf('Patch01'), await nameOf('Patch02'), await nameOf('Patch03')]).toEqual([
      'Three',
      'One',
      'Two',
    ]);
    expect(fileMoves()).toBe(4 * 3);
  });

  it('moves straight into free slots without parking anything', async () => {
    addPatch('Patch07', 'Seven');
    await editor.reorderPatches('internal', ['Patch07', 'Patch01', 'Patch02', 'Patch03']);
    expect(fileMoves()).toBe(4 * 3);
    expect(pedal.folderExists('/mnt/nandfs/.jamman-manager/')).toBe(false);
  });

  it('puts every folder back when a move fails', async () => {
    let moves = 0;
    const realWrite = pedal.transport.write;
    pedal.transport.write = async data => {
      // Fail a file move in the second step of the cycle
      if (data.readUInt16LE(0) === MessageID.FileSystemEntryMoveRequest && ++moves === 5) {
        pedal.failures.set(MessageID.FileSystemEntryMoveRequest, 'disk error');
      }
      await realWrite(data);
      pedal.failures.delete(MessageID.FileSystemEntryMoveRequest);
    };
    await expect(
      editor.reorderPatches('internal', ['Patch03', 'Patch02', 'Patch01']),
    ).rejects.toThrow(/Failed to reorder patches/);
    pedal.transport.write = realWrite;
    expect([await nameOf('Patch01'), await nameOf('Patch02'), await nameOf('Patch03')]).toEqual([
      'One',
      'Two',
      'Three',
    ]);
  });

  it('refuses to start while patches from an interrupted reorder are waiting', async () => {
    pedal.setFile('/mnt/nandfs/.jamman-manager/reorder/Patch05/patch.xml', '<p/>');
    await expect(editor.reorderPatches('internal', ['Patch02', 'Patch01'])).rejects.toThrow(
      /interrupted/,
    );
    expect(await nameOf('Patch01')).toBe('One');
  });

  it('fails before moving anything when a patch is missing', async () => {
    await expect(editor.reorderPatches('internal', ['Patch09', 'Patch01'])).rejects.toThrow(
      /not found/,
    );
    expect(pedal.requests).not.toContain(MessageID.FileSystemEntryMoveRequest);
  });
});
