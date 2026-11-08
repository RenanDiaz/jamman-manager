import { beforeEach, describe, expect, it } from 'vitest';
import type { PatchForm } from '@app/preload/ipc-contract';
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
import { PedalEditor } from './PedalEditor.js';
import { createWriteGuard } from './PedalFiles.js';
import { wavPath } from './pedalPaths.js';

const ROOT = FAKE_INTERNAL_ROOT;
const UNDO = '/mnt/nandfs/.jamman-manager/undo/';
const silentLog = { info: () => {}, warn: () => {} };

let pedal: FakePedal;
let editor: PedalEditor;

function addPatch(dir: string, name: string, phrases = ['PhraseA']) {
  pedal.setFile(`${ROOT}${dir}/patch.xml`, patchXml(name));
  for (const phrase of phrases) {
    pedal.setFile(`${ROOT}${dir}/${phrase}/phrase.xml`, phraseXml(100));
    pedal.setFile(`${ROOT}${dir}/${phrase}/phrase.wav`, wavBytes(400));
  }
}

const nameOf = async (dir: string) =>
  (await SecureXMLParser.parsePatchXML(pedal.files.get(`${ROOT}${dir}/patch.xml`)!.toString()))
    .JamManPatch.PatchName[0];

function form(dir: string, overrides: Partial<PatchForm> = {}): PatchForm {
  return {
    basePath: 'jamman-pedal://internal',
    directory: dir,
    patchName: 'Renamed',
    rhythmType: 'Click',
    stopMode: 'FadeOut',
    settingsVersion: '3',
    patchID: `id-${dir}`,
    phrases: [
      {
        name: 'PhraseA',
        wavPath: wavPath('internal', dir, 'PhraseA'),
        beatsPerMinute: 90,
        beatsPerMeasure: 3,
        isLoop: false,
        isReversed: true,
      },
    ],
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
  const client = new GreenglassClient(pedal.transport, { requestTimeoutMs: 500 });
  editor = new PedalEditor(client, () => ROOT, createWriteGuard([ROOT]), silentLog);
});

describe('edit', () => {
  it('rewrites the XML files and keeps the audio and IDs', async () => {
    const wavBefore = pedal.files.get(`${ROOT}Patch01/PhraseA/phrase.wav`);
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
    const phrase = await SecureXMLParser.parsePhraseXML(
      pedal.files.get(`${ROOT}Patch01/PhraseA/phrase.xml`)!.toString(),
    );
    expect(phrase.JamManPhrase).toMatchObject({
      BeatsPerMinute: ['90'],
      BeatsPerMeasure: ['3'],
      IsLoop: ['0'],
      IsReversed: ['1'],
    });
    expect(pedal.files.get(`${ROOT}Patch01/PhraseA/phrase.wav`)).toBe(wavBefore);
    expect(pedal.requests).not.toContain(MessageID.FileSystemEntryDeleteRequest);
  });

  it('refuses to add, remove or replace phrases', async () => {
    const extra = { ...form('Patch01').phrases[0], name: 'PhraseB', wavPath: '/Users/me/new.wav' };
    await expect(
      editor.updatePatch(
        'internal',
        form('Patch01', { phrases: [...form('Patch01').phrases, extra] }),
      ),
    ).rejects.toThrow(/not available for a pedal/);
    await expect(editor.updatePatch('internal', form('Patch01', { phrases: [] }))).rejects.toThrow(
      /not available for a pedal/,
    );
    const replaced = [{ ...form('Patch01').phrases[0], wavPath: '/Users/me/new.wav' }];
    await expect(
      editor.updatePatch('internal', form('Patch01', { phrases: replaced })),
    ).rejects.toThrow(/not available for a pedal/);
    expect(await nameOf('Patch01')).toBe('One');
  });

  it('fails for a patch that does not exist', async () => {
    await expect(editor.updatePatch('internal', form('Patch09'))).rejects.toThrow(/does not exist/);
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

  it('parks a protected patch and brings it back, as many times as undo/redo asks', async () => {
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch02'],
    });
    expect(snapshot).toMatchObject({
      basePath: 'jamman-pedal://internal',
      scope: 'patches',
      patches: ['Patch02'],
    });

    await editor.deletePatches('internal', ['Patch02']);
    expect(pedal.folderExists(`${ROOT}Patch02/`)).toBe(false);
    expect(pedal.files.has(`${UNDO}${snapshot.id}/Patch02/PhraseA/phrase.wav`)).toBe(true);

    for (let cycle = 0; cycle < 2; cycle++) {
      expect(await editor.restoreSnapshot(snapshot.id, 'internal', 'add')).toEqual({
        restored: ['Patch02'],
        removed: [],
      });
      expect(await nameOf('Patch02')).toBe('Two');
      // Redo: the renderer deletes again without a new snapshot
      await editor.deletePatches('internal', ['Patch02']);
      expect(pedal.folderExists(`${ROOT}Patch02/`)).toBe(false);
    }

    await editor.discardSnapshot(snapshot.id);
    expect(pedal.folderExists(`${UNDO}${snapshot.id}/`)).toBe(false);
    await expect(editor.restoreSnapshot(snapshot.id, 'internal', 'add')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('tidies empty undo folders without touching other parked patches', async () => {
    const first = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch01'],
    });
    const second = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch02'],
    });
    await editor.deletePatches('internal', ['Patch01']);
    await editor.deletePatches('internal', ['Patch02']);

    await editor.restoreSnapshot(second.id, 'internal', 'add');
    expect(pedal.folderExists(`${UNDO}${second.id}/`)).toBe(false);
    // The other snapshot still parks Patch01
    expect(pedal.files.has(`${UNDO}${first.id}/Patch01/PhraseA/phrase.wav`)).toBe(true);

    await editor.restoreSnapshot(first.id, 'internal', 'add');
    expect(pedal.folderExists(UNDO)).toBe(false);
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
    await expect(
      editor.restoreSnapshot(snapshot.id, 'internal', 'add', ['Patch09']),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('undoes an edit by writing the saved XML back', async () => {
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch01'],
    });
    await editor.updatePatch('internal', form('Patch01'));
    expect(await nameOf('Patch01')).toBe('Renamed');

    await editor.restoreSnapshot(snapshot.id, 'internal', 'replace');
    expect(await nameOf('Patch01')).toBe('One');
    expect(pedal.files.get(`${ROOT}Patch01/PhraseA/phrase.xml`)?.toString()).toBe(phraseXml(100));
  });

  it('rejects snapshots it cannot take or use', async () => {
    await expect(editor.createSnapshot('internal', { kind: 'all' })).rejects.toBeInstanceOf(
      PatchRestoreError,
    );
    await expect(
      editor.createSnapshot('internal', { kind: 'patches', patches: ['Patch09'] }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
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
    pedal.setFile(`${UNDO}pedal-old/Patch05/patch.xml`, '<p/>');
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
