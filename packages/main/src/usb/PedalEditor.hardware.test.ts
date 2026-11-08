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
    editor = new PedalEditor(client, () => ROOT, createWriteGuard([ROOT]), log);
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

  it('deletes into the undo slot and brings it back twice', async () => {
    const snapshot = await editor.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch02'],
    });
    const slot = `${SANDBOX}.jamman-manager/undo/${snapshot.id}/Patch02/PhraseA/phrase.wav`;

    for (let cycle = 0; cycle < 2; cycle++) {
      await editor.deletePatches('internal', ['Patch02']);
      expect(await exists(`${ROOT}Patch02/`)).toBe(false);
      expect((await client.entryInfo(slot, false)).size).toBe(wavBytes(200_000).length);

      await editor.restoreSnapshot(snapshot.id, 'internal', 'add');
      expect(await nameOf('Patch02')).toBe('Two');
    }

    await editor.deletePatches('internal', ['Patch02']);
    await editor.discardSnapshot(snapshot.id);
    expect(await exists(`${SANDBOX}.jamman-manager/undo/${snapshot.id}/`)).toBe(false);
    expect(await exists(`${ROOT}Patch02/`)).toBe(false);
  }, 60_000);

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
