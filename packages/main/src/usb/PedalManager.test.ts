import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  FAKE_INTERNAL_ROOT,
  FAKE_SD_ROOT,
  FakePedal,
  patchXml,
  phraseXml,
  wavBytes,
} from '../test-utils/fakePedal.js';
import { MessageID, PropertyID } from './greenglassCodec.js';
import { PedalManager, PedalNotConnectedError } from './PedalManager.js';
import { parseWavPath } from './pedalPaths.js';

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };
const WAV = wavBytes(30_000);
const WAV_PATH = 'jamman-pedal://internal/Patch01/PhraseA/phrase.wav';
const REF = parseWavPath(WAV_PATH)!;

let cacheRoot: string;

function pedalFiles() {
  return {
    [`${FAKE_INTERNAL_ROOT}Patch01/patch.xml`]: patchXml('Rock'),
    [`${FAKE_INTERNAL_ROOT}Patch01/PhraseA/phrase.xml`]: phraseXml(120),
    [`${FAKE_INTERNAL_ROOT}Patch01/PhraseA/phrase.wav`]: WAV,
    [`${FAKE_INTERNAL_ROOT}Patch02/patch.xml`]: patchXml('Blues'),
    // A phrase without phrase.xml is skipped, the patch is kept
    [`${FAKE_INTERNAL_ROOT}Patch02/PhraseA/phrase.wav`]: WAV,
    // A folder without patch.xml is not a patch
    [`${FAKE_INTERNAL_ROOT}Patch03/notes.txt`]: 'x',
    // Not a patch folder name
    [`${FAKE_INTERNAL_ROOT}Backup/patch.xml`]: patchXml('Nope'),
    [`${FAKE_SD_ROOT}Patch10/patch.xml`]: patchXml('On SD'),
  };
}

function setup(options: { sdPresent?: boolean; ports?: string[] } = {}) {
  const fake = new FakePedal({ files: pedalFiles(), sdPresent: options.sdPresent });
  const openTransport = vi.fn(async () => fake.transport);
  const manager = new PedalManager({
    findPorts: async () => options.ports ?? ['/dev/cu.usbmodem101'],
    openTransport,
    cacheRoot,
    log: silentLog,
    clientOptions: { requestTimeoutMs: 500 },
  });
  return { fake, manager, openTransport };
}

async function collect(stream: ReadableStream<Uint8Array> | null): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of Readable.fromWeb(stream as unknown as NodeReadableStream)) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

async function openWhole(manager: PedalManager) {
  const opened = await manager.openWavStream(REF, () => null);
  if (opened.range === 'unsatisfiable') throw new Error('unexpected');
  return opened;
}

beforeEach(() => {
  cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pedal-cache-'));
});

afterEach(() => {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
});

describe('PedalManager connection', () => {
  it('reports the pedal and its banks', async () => {
    const { manager } = setup();
    const changes: unknown[] = [];
    manager.on('change', info => changes.push(info));

    const info = await manager.connect();
    expect(info).toMatchObject({ name: 'JamMan Stereo', firmwareVersion: '1.3.0.0' });
    expect(info.banks).toEqual([
      expect.objectContaining({ id: 'internal', path: 'jamman-pedal://internal', available: true }),
      expect.objectContaining({ id: 'sd', path: 'jamman-pedal://sd', available: true }),
    ]);
    expect(info.banks[0].capacityBytes).toBe(516608 * 1024);
    expect(manager.status()).toBe(info);
    expect(changes).toEqual([info]);
  });

  it('connects once even when asked twice at the same time', async () => {
    const { manager, openTransport } = setup();
    const [a, b] = await Promise.all([manager.connect(), manager.connect()]);
    expect(a).toBe(b);
    expect(openTransport).toHaveBeenCalledOnce();
    expect(await manager.connect()).toBe(a);
  });

  it('explains when no pedal is plugged in', async () => {
    const { manager } = setup({ ports: [] });
    await expect(manager.connect()).rejects.toThrow(/No JamMan found on USB/);
    expect(manager.status()).toBeNull();
  });

  it('follows the SD card being removed', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    const changed = new Promise(resolve => manager.once('change', resolve));
    fake.notifyProperty(PropertyID.RemovableMediaIsPresent, 0);
    await changed;
    expect(manager.status()?.banks[1].available).toBe(false);
    await expect(manager.readPatches('sd')).rejects.toThrow(/no SD card/);
  });

  it('reports a disconnect when the cable is pulled', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    const changed = new Promise(resolve => manager.once('change', resolve));
    fake.unplug();
    expect(await changed).toBeNull();
    expect(manager.status()).toBeNull();
    await expect(manager.readPatches('internal')).rejects.toBeInstanceOf(PedalNotConnectedError);
  });

  it('disconnects on request', async () => {
    const { manager } = setup();
    await manager.connect();
    await manager.disconnect();
    expect(manager.status()).toBeNull();
    await manager.disconnect(); // no-op
  });
});

describe('PedalManager.readPatches', () => {
  it('reads patches and phrases from the XML files, without audio', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    const patches = await manager.readPatches('internal');

    expect(patches.map(p => p.dir)).toEqual(['Patch01', 'Patch02']);
    expect(patches[0].data.JamManPatch.PatchName).toEqual(['Rock']);
    expect(patches[0].phrases).toEqual([
      expect.objectContaining({ dir: 'PhraseA', wavPath: WAV_PATH }),
    ]);
    expect(patches[0].phrases[0].data.JamManPhrase.BeatsPerMinute).toEqual(['120']);
    expect(patches[1].phrases).toEqual([]);
    // Only the head-sized requests: no FileReadRequest for a WAV.
    const reads = fake.requests.filter(id => id === MessageID.FileReadRequest).length;
    expect(reads).toBe(3); // 2 patch.xml + 1 phrase.xml
  });

  it('reads the SD bank from its own folder', async () => {
    const { manager } = setup();
    await manager.connect();
    const patches = await manager.readPatches('sd');
    expect(patches.map(p => p.data.JamManPatch.PatchName[0])).toEqual(['On SD']);
  });

  it('counts the bytes of the bank', async () => {
    const { manager } = setup();
    await manager.connect();
    const size = await manager.bankSize('internal');
    expect(size).toBe(
      Buffer.byteLength(patchXml('Rock')) +
        Buffer.byteLength(phraseXml(120)) +
        WAV.length +
        Buffer.byteLength(patchXml('Blues')),
    );
  });

  it('returns an empty bank when its folder does not exist', async () => {
    const fake = new FakePedal({ files: { '/elsewhere/x': 'x' } });
    const manager = new PedalManager({
      findPorts: async () => ['p'],
      openTransport: async () => fake.transport,
      cacheRoot,
      log: silentLog,
    });
    await manager.connect();
    expect(await manager.readPatches('internal')).toEqual([]);
  });

  it('skips a patch whose XML is malformed', async () => {
    const { manager, fake } = setup();
    fake.setFile(`${FAKE_INTERNAL_ROOT}Patch02/patch.xml`, '<not xml');
    await manager.connect();
    expect((await manager.readPatches('internal')).map(p => p.dir)).toEqual(['Patch01']);
  });
});

describe('PedalManager audio', () => {
  it('streams a WAV from the pedal and caches it', async () => {
    const { manager, fake } = setup();
    await manager.connect();

    const opened = await openWhole(manager);
    expect(opened.size).toBe(WAV.length);
    expect((await collect(opened.stream)).equals(WAV)).toBe(true);
    expect(fake.openFiles.size).toBe(0);

    // Second time: served from the cache, no file read on the pedal.
    const readsBefore = fake.requests.filter(id => id === MessageID.FileReadRequest).length;
    expect((await manager.readWav(REF)).equals(WAV)).toBe(true);
    expect(fake.requests.filter(id => id === MessageID.FileReadRequest).length).toBe(readsBefore);
  });

  it('downloads again when the pedal reports a different file', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    await collect((await openWhole(manager)).stream);

    const newer = wavBytes(1000);
    fake.setFile(
      `${FAKE_INTERNAL_ROOT}Patch01/PhraseA/phrase.wav`,
      newer,
      new Date(Date.UTC(2025, 5, 1)),
    );
    expect((await manager.readWav(REF)).equals(newer)).toBe(true);
  });

  it('serves a range straight from the pedal without caching it', async () => {
    const { manager } = setup();
    await manager.connect();
    const opened = await manager.openWavStream(REF, () => ({ start: 100, end: 199 }));
    if (opened.range === 'unsatisfiable') throw new Error('unexpected');
    expect((await collect(opened.stream)).equals(WAV.subarray(100, 200))).toBe(true);
    expect(fs.readdirSync(cacheRoot)).toEqual([]);
  });

  it('passes an unsatisfiable range through', async () => {
    const { manager } = setup();
    await manager.connect();
    const opened = await manager.openWavStream(REF, () => 'unsatisfiable');
    expect(opened).toEqual({ size: WAV.length, range: 'unsatisfiable' });
  });

  it('discards a partial download when playback is cancelled', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    const opened = await openWhole(manager);
    const reader = opened.stream!.getReader();
    await reader.read();
    await reader.cancel();

    expect(fake.openFiles.size).toBe(0);
    const cached = fs.readdirSync(cacheRoot, { recursive: true }) as string[];
    expect(cached.filter(f => f.endsWith('.wav') || f.endsWith('.part'))).toEqual([]);
  });

  it('reads the head of a WAV for validation', async () => {
    const { manager } = setup();
    await manager.connect();
    const { head, size } = await manager.readWavHead(REF, 64);
    expect(size).toBe(WAV.length);
    expect(head.equals(WAV.subarray(0, 64))).toBe(true);

    await collect((await openWhole(manager)).stream);
    const fromCache = await manager.readWavHead(REF, 64);
    expect(fromCache.head.equals(WAV.subarray(0, 64))).toBe(true);
  });

  it('fails for a phrase that does not exist on the pedal', async () => {
    const { manager } = setup();
    await manager.connect();
    await expect(
      manager.wavSize({ bank: 'internal', patch: 'Patch09', phrase: 'PhraseA' }),
    ).rejects.toThrow('No such file or directory');
  });
});

describe('PedalManager changes', () => {
  it('purges undo data from an earlier session when it connects', async () => {
    const { manager, fake } = setup();
    fake.setFile('/mnt/nandfs/.jamman-manager/undo/pedal-old/Patch04/patch.xml', '<p/>');
    fake.setFile('/mnt/sdfs/.jamman-manager/undo/pedal-old/Patch04/patch.xml', '<p/>');
    await manager.connect();
    expect(fake.folderExists('/mnt/nandfs/.jamman-manager/undo/')).toBe(false);
    expect(fake.folderExists('/mnt/sdfs/.jamman-manager/undo/')).toBe(false);
  });

  it('runs changes one after another and re-counts the bank afterwards', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    await manager.readPatches('internal');
    const before = await manager.bankSize('internal');

    const snapshot = await manager.createSnapshot('internal', {
      kind: 'patches',
      patches: ['Patch02'],
    });
    await Promise.all([
      manager.deletePatches('internal', ['Patch02']),
      manager.reorderPatches('internal', ['Patch01']),
    ]);
    expect(fake.folderExists(`${FAKE_INTERNAL_ROOT}Patch02/`)).toBe(false);
    expect(await manager.bankSize('internal')).toBeLessThan(before);

    await manager.restoreSnapshot(snapshot.id, 'internal', 'add');
    expect(fake.folderExists(`${FAKE_INTERNAL_ROOT}Patch02/`)).toBe(true);
  });

  it('discards snapshots quietly when no pedal is connected', async () => {
    const { manager } = setup();
    await expect(manager.discardSnapshot('pedal-x')).resolves.toBeUndefined();
    await expect(manager.deletePatches('internal', ['Patch01'])).rejects.toBeInstanceOf(
      PedalNotConnectedError,
    );
  });
});
