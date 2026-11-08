/**
 * Edit, delete, undo and reorder against a real JamMan, in a sandbox bank.
 *
 * Skipped unless `JAMMAN_USB=1`:
 *
 *   JAMMAN_USB=1 npx vitest run packages/main/src/usb/PedalEditor.hardware.test.ts
 *
 * Needs an SD card in the pedal. Nothing outside
 * `/mnt/sdfs/.jamman-manager/hwtest/` is touched, and that folder is deleted
 * at the end: the editor works on a bank folder created there, so the real
 * patches are never involved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PatchForm } from '@app/preload/ipc-contract';
import { patchXml, phraseXml, wavBytes } from '../test-utils/fakePedal.js';
import { SecureXMLParser } from '../SecureXMLParser.js';
import { GreenglassClient } from './GreenglassClient.js';
import { PedalEditor } from './PedalEditor.js';
import { createWriteGuard } from './PedalFiles.js';
import { wavPath } from './pedalPaths.js';
import { findJamManPorts, openSerialTransport } from './serialTransport.js';

const enabled = process.env.JAMMAN_USB === '1';
const SANDBOX = '/mnt/sdfs/.jamman-manager/hwtest/';
const ROOT = `${SANDBOX}JamManStereo/`;
const log = { info: () => {}, warn: console.warn };
/** WAVs "on the computer": distinct bytes so the tests can tell them apart. */
const LOCAL: Record<string, Buffer> = {
  '/local/new.wav': Buffer.concat([wavBytes(1_400_000), Buffer.from('new')]),
  '/local/extra.wav': Buffer.concat([wavBytes(100_000), Buffer.from('extra')]),
};
const phrase = (name: string, wav: string): PatchForm['phrases'][number] => ({
  name,
  wavPath: wav,
  beatsPerMinute: 100,
  beatsPerMeasure: 4,
  isLoop: true,
  isReversed: false,
});

describe.skipIf(!enabled)('PedalEditor on a real JamMan (sandbox bank)', () => {
  let client: GreenglassClient;
  let editor: PedalEditor;

  const nameOf = async (dir: string) =>
    (
      await SecureXMLParser.parsePatchXML(
        (await client.readFile(`${ROOT}${dir}/patch.xml`)).toString(),
      )
    ).JamManPatch.PatchName[0];
  const exists = async (path: string) => (await client.entryInfo(path, true)).exists;

  beforeAll(async () => {
    const [port] = await findJamManPorts();
    client = new GreenglassClient(await openSerialTransport(port), { requestTimeoutMs: 15_000 });
    await client.discardStaleInput();
    if (await exists(SANDBOX)) await client.delete(SANDBOX, true, true);

    // Sandbox layout: <sandbox>/JamManStereo/Patch01..03, each with one phrase.
    for (const folder of ['/mnt/sdfs/.jamman-manager/', SANDBOX, ROOT]) {
      if (!(await exists(folder))) await client.createFolder(folder);
    }
    for (const [dir, name] of [
      ['Patch01', 'One'],
      ['Patch02', 'Two'],
      ['Patch03', 'Three'],
    ]) {
      await client.createFolder(`${ROOT}${dir}/`);
      await client.createFolder(`${ROOT}${dir}/PhraseA/`);
      await client.writeFile(`${ROOT}${dir}/patch.xml`, Buffer.from(patchXml(name)));
      await client.writeFile(`${ROOT}${dir}/PhraseA/phrase.xml`, Buffer.from(phraseXml(100)));
      await client.writeFile(`${ROOT}${dir}/PhraseA/phrase.wav`, wavBytes(200_000));
    }
    editor = new PedalEditor(client, () => ROOT, createWriteGuard([ROOT]), log, {
      readLocalFile: async path => {
        const data = LOCAL[path];
        if (!data) throw new Error(`ENOENT: ${path}`);
        return data;
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (client?.isOpen) {
      await client
        .delete(SANDBOX, true, true)
        .catch(error => console.warn('cleanup failed', error));
      // The work folder too, but only if nothing else is in it (not recursive).
      await client.delete('/mnt/sdfs/.jamman-manager/', true, false).catch(() => undefined);
      await client.close();
    }
  });

  it('edits the XML and undoes it', async () => {
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch01'],
    });
    const form: PatchForm = {
      basePath: 'jamman-pedal://internal',
      directory: 'Patch01',
      patchName: 'Edited over USB',
      rhythmType: 'Click',
      stopMode: 'FadeOut',
      settingsVersion: '0',
      patchID: 'id-One',
      phrases: [
        {
          name: 'PhraseA',
          wavPath: wavPath('internal', 'Patch01', 'PhraseA'),
          beatsPerMinute: 95,
          beatsPerMeasure: 4,
          isLoop: true,
          isReversed: false,
        },
      ],
    };
    await editor.updatePatch('internal', form);
    expect(await nameOf('Patch01')).toBe('Edited over USB');

    await editor.restoreSnapshot(snapshot.id, 'internal', 'replace');
    expect(await nameOf('Patch01')).toBe('One');
    await editor.discardSnapshot(snapshot.id);
  }, 60_000);

  it('deletes into the undo pool and brings it back twice', async () => {
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch02'],
    });
    const pool = `${SANDBOX}.jamman-manager/undo/`;

    for (let cycle = 0; cycle < 2; cycle++) {
      await editor.deletePatches('internal', ['Patch02']);
      expect(await exists(`${ROOT}Patch02/`)).toBe(false);
      expect((await client.folderContents(pool)).files).toHaveLength(1);

      await editor.restoreSnapshot(snapshot.id, 'internal', 'add');
      expect(await nameOf('Patch02')).toBe('Two');
      expect((await client.entryInfo(`${ROOT}Patch02/PhraseA/phrase.wav`, false)).size).toBe(
        wavBytes(200_000).length,
      );
    }

    await editor.deletePatches('internal', ['Patch02']);
    await editor.discardSnapshot(snapshot.id);
    expect(await exists(pool)).toBe(false);
    expect(await exists(`${ROOT}Patch02/`)).toBe(false);
  }, 60_000);

  it('creates a patch uploading its audio', async () => {
    const started = Date.now();
    await editor.createPatch('internal', {
      basePath: 'jamman-pedal://internal',
      directory: 'Patch05',
      patchName: 'Uploaded',
      rhythmType: 'Silence',
      stopMode: 'StopInstantly',
      phrases: [phrase('PhraseA', '/local/new.wav')],
    });
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `created with a ${(LOCAL['/local/new.wav'].length / 1e6).toFixed(1)} MB WAV in ${seconds.toFixed(1)} s`,
    );
    expect(await nameOf('Patch05')).toBe('Uploaded');
    expect(
      (await client.readFile(`${ROOT}Patch05/PhraseA/phrase.wav`)).equals(LOCAL['/local/new.wav']),
    ).toBe(true);
  }, 120_000);

  it('replaces a WAV and adds a phrase, then swaps back and forth with undo/redo', async () => {
    const own = (p: string) => wavPath('internal', 'Patch05', p);
    const original = await client.readFile(`${ROOT}Patch05/PhraseA/phrase.wav`);
    const before = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch05'],
    });
    await editor.updatePatch('internal', {
      basePath: 'jamman-pedal://internal',
      directory: 'Patch05',
      patchName: 'Changed',
      rhythmType: 'Silence',
      stopMode: 'StopInstantly',
      phrases: [phrase('PhraseA', '/local/extra.wav'), phrase('PhraseB', '/local/extra.wav')],
    });
    expect(
      (await client.readFile(`${ROOT}Patch05/PhraseA/phrase.wav`)).equals(
        LOCAL['/local/extra.wav'],
      ),
    ).toBe(true);
    expect(own('PhraseB')).toContain('PhraseB');

    const after = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch05'],
    });
    const swapStarted = Date.now();
    await editor.restoreSnapshot(before.id, 'internal', 'replace');
    console.log(
      `undo of a WAV replacement took ${((Date.now() - swapStarted) / 1000).toFixed(1)} s`,
    );
    expect(await nameOf('Patch05')).toBe('Uploaded');
    expect(await exists(`${ROOT}Patch05/PhraseB/`)).toBe(false);
    expect((await client.readFile(`${ROOT}Patch05/PhraseA/phrase.wav`)).equals(original)).toBe(
      true,
    );

    await editor.restoreSnapshot(after.id, 'internal', 'replace');
    expect(await nameOf('Patch05')).toBe('Changed');
    expect(
      (await client.readFile(`${ROOT}Patch05/PhraseB/phrase.wav`)).equals(
        LOCAL['/local/extra.wav'],
      ),
    ).toBe(true);

    await editor.discardSnapshot(after.id);
    await editor.discardSnapshot(before.id);
    expect(await exists(`${SANDBOX}.jamman-manager/undo/`)).toBe(false);
  }, 120_000);

  it('reorders by moving files, then back', async () => {
    // Patch02 was deleted above: Patch01, Patch03 left.
    await editor.reorderPatches('internal', ['Patch03', 'Patch01']);
    expect([await nameOf('Patch01'), await nameOf('Patch02')]).toEqual(['Three', 'One']);
    expect(await exists(`${ROOT}Patch03/`)).toBe(false);
    expect((await client.entryInfo(`${ROOT}Patch01/PhraseA/phrase.wav`, false)).size).toBe(
      wavBytes(200_000).length,
    );

    await editor.reorderPatches('internal', ['Patch02', 'Patch01']);
    expect([await nameOf('Patch01'), await nameOf('Patch02')]).toEqual(['One', 'Three']);
  }, 60_000);
});
