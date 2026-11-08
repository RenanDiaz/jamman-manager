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
import { PedalCanceledError, PedalManager, PedalNotConnectedError } from './PedalManager.js';
import { BackupManager } from '../BackupManager.js';
import { PlaylistManager } from '../PlaylistManager.js';
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
    workRoot: path.join(cacheRoot, 'work'),
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

  it('frees parked audio when it disconnects', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    await manager.createSnapshot('internal', { kind: 'patches', patches: ['Patch01'] });
    await manager.deletePatches('internal', ['Patch01']);
    expect(fake.folderExists('/mnt/nandfs/.jamman-manager/undo/')).toBe(true);
    await manager.disconnect();
    expect(fake.folderExists('/mnt/nandfs/.jamman-manager/undo/')).toBe(false);
  });

  it('discards snapshots quietly when no pedal is connected', async () => {
    const { manager } = setup();
    await expect(manager.discardSnapshot('pedal-x')).resolves.toBeUndefined();
    await expect(manager.deletePatches('internal', ['Patch01'])).rejects.toBeInstanceOf(
      PedalNotConnectedError,
    );
  });
});

describe('PedalManager audio cache and backups', () => {
  const internalWav = `${FAKE_INTERNAL_ROOT}Patch01/PhraseA/phrase.wav`;
  const wavReads = (fake: FakePedal) => fake.reads.filter(p => p.endsWith('.wav')).length;

  it('reports what is cached and downloads the rest', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    // Patch02's phrase has a WAV but no phrase.xml: a backup keeps it, so it counts
    expect(await manager.audioStatus('internal')).toEqual({
      files: 2,
      totalBytes: 2 * WAV.length,
      cachedFiles: 0,
      cachedBytes: 0,
    });
    const progress: unknown[] = [];
    manager.on('progress', p => progress.push(p));
    await manager.downloadAudio('internal');
    expect(await manager.audioStatus('internal')).toMatchObject({
      cachedFiles: 2,
      cachedBytes: 2 * WAV.length,
    });
    expect(progress.at(-2)).toEqual({
      label: 'Downloading audio',
      done: 2 * WAV.length,
      total: 2 * WAV.length,
    });
    expect(progress.at(-1)).toBeNull();

    // Nothing left to download
    const reads = wavReads(fake);
    await manager.downloadAudio('internal');
    expect(wavReads(fake)).toBe(reads);
  });

  it('stops a download when canceled, keeping only complete files', async () => {
    const { manager, fake } = setup();
    fake.setFile(`${FAKE_INTERNAL_ROOT}Patch02/PhraseA/phrase.xml`, phraseXml(90));
    await manager.connect();
    manager.on('progress', p => {
      if (p && p.done > 0) manager.cancel(); // after the first block
    });
    await expect(manager.downloadAudio('internal')).rejects.toBeInstanceOf(PedalCanceledError);
    expect(fake.openFiles.size).toBe(0);
    const cached = fs.readdirSync(cacheRoot, { recursive: true }) as string[];
    expect(cached.filter(f => f.endsWith('.part'))).toEqual([]);

    manager.removeAllListeners('progress');
    const status = await manager.downloadAudio('internal');
    expect(status.cachedFiles).toBe(status.files);
  });

  it('forgets cached audio of a patch the app changes', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    await manager.readWav(REF);
    expect(wavReads(fake)).toBe(1);

    // Same size, same minute: only the app knows the content changed
    const sameSize = Buffer.from(WAV);
    sameSize[100] ^= 0xff;
    fake.setFile(internalWav, sameSize);
    await manager.reorderPatches('internal', ['Patch01', 'Patch02']); // touches nothing that moves
    await manager.updatePatch('internal', {
      basePath: 'jamman-pedal://internal',
      directory: 'Patch01',
      patchName: 'Rock',
      rhythmType: 'Silence',
      stopMode: 'StopInstantly',
      phrases: [
        {
          name: 'PhraseA',
          wavPath: WAV_PATH,
          beatsPerMinute: 120,
          beatsPerMeasure: 4,
          isLoop: true,
          isReversed: false,
        },
      ],
    });
    expect((await manager.readWav(REF)).equals(sameSize)).toBe(true);
  });

  it('backs a bank up to a ZIP and restores it onto another bank', async () => {
    const { manager, fake } = setup();
    fake.setFile(`${FAKE_INTERNAL_ROOT}.jamman-playlists.json`, '{"playlists":[]}');
    await manager.connect();

    const zip = path.join(cacheRoot, 'backup.zip');
    await manager.withLocalWorkDir(async dir => {
      const exported = await manager.exportBank('internal', undefined, true, dir);
      expect(exported).toEqual(['Patch01', 'Patch02']);
      expect(fs.readFileSync(path.join(dir, 'Patch01', 'PhraseA', 'phrase.wav')).equals(WAV)).toBe(
        true,
      );
      expect(fs.existsSync(path.join(dir, '.jamman-playlists.json'))).toBe(true);
      await BackupManager.createBackup({
        basePath: dir,
        outputPath: zip,
        patches: exported,
        includePlaylist: true,
      });
    });
    expect(fs.readdirSync(path.join(cacheRoot, 'work'))).toEqual([]); // the job folder is gone

    // Merge into the SD bank, which already has Patch10: the backup keeps its numbers
    await manager.withLocalWorkDir(async dir => {
      for (const used of await manager.listPatchDirs('sd')) fs.mkdirSync(path.join(dir, used));
      await BackupManager.restoreBackup({ backupPath: zip, targetPath: dir, mode: 'merge' });
      const restored = fs
        .readdirSync(dir)
        .filter(d => fs.existsSync(path.join(dir, d, 'patch.xml')));
      await manager.importPatches('sd', dir, restored, false);
    });
    expect(fake.files.get(`${FAKE_SD_ROOT}Patch01/PhraseA/phrase.wav`)?.equals(WAV)).toBe(true);
    expect(fake.files.has(`${FAKE_SD_ROOT}Patch10/patch.xml`)).toBe(true);
    expect(fake.files.get(`${FAKE_SD_ROOT}.jamman-playlists.json`)?.toString()).toBe(
      '{"playlists":[]}',
    );
  });
});

describe('PedalManager playlists', () => {
  const PLAYLISTS = `${FAKE_INTERNAL_ROOT}.jamman-playlists.json`;
  const patchXmlReads = (fake: FakePedal) => fake.reads.filter(p => p.endsWith('patch.xml')).length;

  it('keeps playlists in the bank folder, by patch ID, without re-reading patches', async () => {
    const { manager, fake } = setup();
    await manager.connect();
    await manager.readPatches('internal');
    const store = manager.playlistStore('internal');
    const reads = patchXmlReads(fake);

    const created = await PlaylistManager.createPlaylist(store, 'Gig', ['Patch02', 'Patch01']);
    expect(created.patches).toEqual(['Patch02', 'Patch01']);
    const saved = JSON.parse(fake.files.get(PLAYLISTS)!.toString());
    expect(saved.playlists[0]).toMatchObject({ name: 'Gig', patchIds: ['id-Blues', 'id-Rock'] });
    expect((await PlaylistManager.loadPlaylists(store)).playlists[0].patches).toEqual([
      'Patch02',
      'Patch01',
    ]);
    expect(patchXmlReads(fake)).toBe(reads); // the index from readPatches was enough

    // Patches move: the playlist follows them by ID
    await manager.reorderPatches('internal', ['Patch02', 'Patch01']);
    expect((await PlaylistManager.loadPlaylists(store)).playlists[0].patches).toEqual([
      'Patch01',
      'Patch02',
    ]);
    expect(await manager.patchName('internal', 'Patch01')).toBe('Blues');
  });

  it('reads the IDs from the pedal when the patches were not read yet', async () => {
    const { manager, fake } = setup();
    fake.setFile(
      PLAYLISTS,
      JSON.stringify({
        schemaVersion: 2,
        version: '2.0',
        playlists: [{ id: 'p', name: 'Set', patchIds: ['id-Rock'], createdAt: '', updatedAt: '' }],
      }),
    );
    await manager.connect();
    const data = await PlaylistManager.loadPlaylists(manager.playlistStore('internal'));
    expect(data.playlists[0].patches).toEqual(['Patch01']);
  });
});
