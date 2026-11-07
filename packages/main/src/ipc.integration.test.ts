/**
 * IPC handler tests against the real main process.
 *
 * `initApp` runs for real and registers its handlers; only Electron itself
 * (`electron`, `electron-log`, `electron-updater`) is replaced by test doubles.
 * Every handler works on a copy of the synthetic SD in `tests/fixtures/`, with
 * the real file system.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * `node:fs` is a frozen ESM namespace, so a failure cannot be injected with
 * `vi.spyOn`. Instead `renameSync` runs `renameHook.fn` first (which may throw)
 * and then the real rename. Without a hook it is a pure pass-through.
 */
const renameHook = vi.hoisted(() => ({
  fn: undefined as undefined | ((from: string, to: string) => void),
}));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const renameSync: typeof actual.renameSync = (from, to) => {
    renameHook.fn?.(String(from), String(to));
    return actual.renameSync(from, to);
  };
  return { ...actual, renameSync, default: { ...actual, renameSync } };
});

vi.mock('electron', () => import('./test-utils/electronMock.js'));
vi.mock('electron-log', () => import('./test-utils/logMock.js'));
vi.mock('electron-updater', () => import('./test-utils/updaterMock.js'));

import { startApp, type AppHarness } from './test-utils/appHarness.js';
import {
  createTempDir,
  createTempSd,
  SD_FIXTURE_PATCHES,
  type TempSd,
} from '../../../tests/fixtures/index.js';
import { lockManager } from './LockManager.js';
import { operationQueue, OperationPriority } from './OperationQueue.js';

type ReadPatch = {
  dir: string;
  data: { JamManPatch: { PatchName: string[]; SettingsVersion: string[]; ID: string[] } };
  phrases: {
    dir: string;
    wavPath: string;
    data: { JamManPhrase: { ID: string[]; BeatsPerMinute: string[] } };
  }[];
};

let app: AppHarness;
let sd: TempSd;
let outside: TempSd;

beforeEach(async () => {
  app = await startApp();
  sd = createTempSd();
  outside = createTempDir('jamman-outside-');
});

afterEach(() => {
  renameHook.fn = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  app.cleanup();
  sd.cleanup();
  outside.cleanup();
});

const names = (patches: ReadPatch[]) =>
  Object.fromEntries(patches.map(p => [p.dir, p.data.JamManPatch.PatchName[0]]));

const patchXml = (dir: string) => fs.readFileSync(path.join(sd.path, dir, 'patch.xml'), 'utf-8');

/** A WAV outside the SD, as the user would import it. */
function outsideWav(name = 'import.wav'): string {
  const file = path.join(outside.path, name);
  fs.copyFileSync(path.join(sd.path, 'Patch01', 'PhraseA', 'phrase.wav'), file);
  return file;
}

const phraseForm = (name: string, wavPath: string) => ({
  name,
  wavPath,
  beatsPerMinute: 100,
  beatsPerMeasure: 4,
  isLoop: true,
  isReversed: false,
});

describe('folder access', () => {
  it('rejects every folder-scoped handler before a folder is selected', async () => {
    await expect(app.invoke('patches:read', sd.path)).rejects.toThrow(
      'Failed to read patches from folder: Access denied: no JamMan folder has been selected',
    );
    await expect(app.invoke('playlists:load', sd.path)).rejects.toThrow('Access denied');
    await expect(app.invoke('backup:create', sd.path)).rejects.toThrow('Access denied');
    await expect(app.invoke('patches:reorder', sd.path, ['Patch01'])).rejects.toThrow(
      'Access denied',
    );
  });

  it('accepts only the folder picked in the dialog', async () => {
    expect(await app.selectFolder(sd.path)).toBe(sd.path);
    await expect(app.invoke('patches:read', sd.path)).resolves.toHaveLength(3);

    await expect(app.invoke('patches:read', outside.path)).rejects.toThrow(
      'Access denied: folder is not the selected JamMan folder',
    );
    await expect(app.invoke('patches:delete', outside.path, 'Patch01')).rejects.toThrow(
      'Access denied',
    );
    await expect(app.invoke('folder:getSize', outside.path)).rejects.toThrow(
      'Failed to calculate folder size: Access denied',
    );
    await expect(
      app.invoke('playlists:create', path.join(sd.path, 'Patch01'), 'x'),
    ).rejects.toThrow('Access denied');
  });

  it('keeps the approved folder across restarts', async () => {
    await app.selectFolder(sd.path);
    const restarted = await startApp({ userData: app.userData });
    try {
      await expect(restarted.invoke('patches:read', sd.path)).resolves.toHaveLength(3);
      await expect(restarted.invoke('patches:read', outside.path)).rejects.toThrow('Access denied');
    } finally {
      restarted.cleanup();
    }
  });

  it('returns undefined and approves nothing when the folder dialog is canceled', async () => {
    await expect(app.invoke('dialog:selectFolder')).resolves.toBeUndefined();
    await expect(app.invoke('patches:read', sd.path)).rejects.toThrow('no JamMan folder');
  });

  it('rejects calls from a frame that is not the app page', async () => {
    await app.selectFolder(sd.path);
    await expect(
      app.invokeFrom('https://evil.example/', 'patches:delete', sd.path, 'Patch01'),
    ).rejects.toThrow('Blocked IPC call from untrusted sender');
    expect(fs.existsSync(path.join(sd.path, 'Patch01'))).toBe(true);
  });

  it('rejects WAVs outside the folder unless picked in the file dialog', async () => {
    await app.selectFolder(sd.path);
    const wav = outsideWav();

    await expect(app.invoke('audio:readFile', wav)).rejects.toThrow(
      'Access denied: file is outside the selected JamMan folder',
    );
    await expect(app.invoke('audio:validateWav', wav)).resolves.toEqual({
      valid: false,
      error: 'Access denied',
      canAttemptPlayback: false,
    });
    await expect(
      app.invoke('patches:create', {
        basePath: sd.path,
        directory: 'Patch04',
        patchName: 'x',
        rhythmType: 'Silence',
        stopMode: 'StopInstantly',
        phrases: [phraseForm('PhraseA', wav)],
      }),
    ).rejects.toThrow('Access denied');

    expect(await app.selectFile(wav)).toBe(wav);
    await expect(app.invoke('audio:readFile', wav)).resolves.toBeInstanceOf(Buffer);
  });

  it('never plays audio from outside the folder, even a picked file', async () => {
    await app.selectFolder(sd.path);
    const wav = outsideWav();
    await app.selectFile(wav);
    await expect(app.invoke('phrase:getAudioURL', wav)).resolves.toBeNull();
  });
});

describe('dialogs', () => {
  it('dialog:selectFile returns null when canceled', async () => {
    await expect(app.invoke('dialog:selectFile')).resolves.toBeNull();
  });

  it('backup:selectFile returns the picked file and grants it', async () => {
    const { dialog } = await import('./test-utils/electronMock.js');
    const zip = path.join(outside.path, 'b.zip');
    fs.writeFileSync(zip, 'not a zip');
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [zip] });
    await expect(app.invoke('backup:selectFile')).resolves.toBe(zip);
    expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Select Backup File', defaultPath: app.documents }),
    );
    // Granted: validation runs (and fails on content) instead of being denied.
    await expect(app.invoke('backup:validate', zip)).resolves.toMatchObject({ valid: false });
    await expect(app.invoke('backup:selectFile')).resolves.toBeNull();
  });
});

describe('patches:read', () => {
  beforeEach(() => app.selectFolder(sd.path));

  it('parses every patch and its phrases', async () => {
    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(names(patches)).toEqual(
      Object.fromEntries(SD_FIXTURE_PATCHES.map(p => [p.dir, p.name])),
    );
    const patch02 = patches.find(p => p.dir === 'Patch02')!;
    expect(patch02.data.JamManPatch.ID[0]).toBe(SD_FIXTURE_PATCHES[1].id);
    expect(patch02.phrases.map(p => p.dir)).toEqual(['PhraseA', 'PhraseB']);
    expect(patch02.phrases[1]).toMatchObject({
      wavPath: path.join(sd.path, 'Patch02', 'PhraseB', 'phrase.wav'),
      data: { JamManPhrase: { BeatsPerMinute: ['90'] } },
    });
  });

  it('serves the cache until a patch or phrase XML changes', async () => {
    const first = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(await app.invoke('patches:read', sd.path)).toBe(first);

    const file = path.join(sd.path, 'Patch01', 'patch.xml');
    fs.writeFileSync(file, patchXml('Patch01').replace('Rock Groove', 'Changed'));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);

    const second = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(second).not.toBe(first);
    expect(names(second).Patch01).toBe('Changed');
  });

  it('skips internal folders, folders without patch.xml and unreadable patches', async () => {
    fs.mkdirSync(path.join(sd.path, 'Notes'));
    fs.mkdirSync(path.join(sd.path, 'Patch09'));
    fs.writeFileSync(path.join(sd.path, 'Patch09', 'patch.xml'), 'garbage');
    // Folders parked by delete/update/reorder hold a valid patch.xml but are not patches.
    for (const parked of ['__deleted_Patch01_1', '__backup_Patch01_1', '__tmp_Patch01']) {
      fs.cpSync(path.join(sd.path, 'Patch01'), path.join(sd.path, parked), { recursive: true });
    }
    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(patches.map(p => p.dir).sort()).toEqual(['Patch01', 'Patch02', 'Patch03']);
  });

  it('rejects a missing folder and invalid arguments', async () => {
    await expect(app.invoke('patches:read', '')).rejects.toThrow(
      'Failed to read patches from folder: Invalid folder path',
    );
    fs.rmSync(sd.path, { recursive: true });
    await expect(app.invoke('patches:read', sd.path)).rejects.toThrow(
      'Folder does not exist or is not a directory',
    );
  });
});

describe('folder:getSize', () => {
  it('adds up every file under the folder', async () => {
    await app.selectFolder(sd.path);
    let expected = 0;
    for (const entry of fs.readdirSync(sd.path, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) expected += fs.statSync(path.join(entry.parentPath, entry.name)).size;
    }
    const size = await app.invoke<{ sizeBytes: number; sizeMB: number; sizeGB: number }>(
      'folder:getSize',
      sd.path,
    );
    expect(size).toEqual({
      sizeBytes: expected,
      sizeMB: expected / 1024 / 1024,
      sizeGB: expected / 1024 / 1024 / 1024,
    });
  });
});

describe('audio', () => {
  const wavIn = () => path.join(sd.path, 'Patch01', 'PhraseA', 'phrase.wav');
  beforeEach(() => app.selectFolder(sd.path));

  it('phrase:getAudioURL returns a jamman:// URL only for existing WAVs in the folder', async () => {
    const url = await app.invoke<string>('phrase:getAudioURL', wavIn());
    expect(url).toMatch(/^jamman:\/\//);
    expect(decodeURIComponent(url)).toContain(path.join('Patch01', 'PhraseA', 'phrase.wav'));

    await expect(app.invoke('phrase:getAudioURL', '')).resolves.toBeNull();
    await expect(
      app.invoke('phrase:getAudioURL', path.join(sd.path, 'Patch01', 'patch.xml')),
    ).resolves.toBeNull();
    await expect(
      app.invoke('phrase:getAudioURL', path.join(sd.path, 'Patch01', 'missing.wav')),
    ).resolves.toBeNull();
    await expect(app.invoke('phrase:getAudioURL', outsideWav())).resolves.toBeNull();
  });

  it('audio:validateWav reads the format of a real WAV', async () => {
    const result = await app.invoke<Record<string, unknown>>('audio:validateWav', wavIn());
    expect(result).toMatchObject({
      valid: true,
      sampleRate: 44100,
      bitsPerSample: 16,
      numberOfChannels: 2,
      fileSizeBytes: fs.statSync(wavIn()).size,
      error: null,
      canAttemptPlayback: true,
    });
  });

  it('audio:validateWav reports unreadable or invalid input without throwing', async () => {
    await expect(app.invoke('audio:validateWav', 42)).resolves.toEqual({
      valid: false,
      error: 'Invalid file path',
      canAttemptPlayback: false,
    });
    await expect(app.invoke('audio:validateWav', path.join(sd.path, 'a.mp3'))).resolves.toEqual({
      valid: false,
      error: 'Invalid file extension',
      canAttemptPlayback: false,
    });
    await expect(
      app.invoke('audio:validateWav', path.join(sd.path, 'missing.wav')),
    ).resolves.toEqual({ valid: false, error: 'File not found', canAttemptPlayback: false });

    const broken = path.join(sd.path, 'broken.wav');
    fs.writeFileSync(broken, 'not audio');
    // music-metadata reads it without throwing, so it is reported as an unsupported format.
    await expect(app.invoke('audio:validateWav', broken)).resolves.toMatchObject({
      valid: false,
      error: 'Unsupported WAV format. Expected 44.1kHz, 16-bit, mono/stereo.',
      fileSizeBytes: 9,
      canAttemptPlayback: true,
    });
  });

  it('audio:readFile returns the bytes of the WAV', async () => {
    const buffer = await app.invoke<Buffer>('audio:readFile', wavIn());
    expect(Buffer.compare(buffer, fs.readFileSync(wavIn()))).toBe(0);
    await expect(app.invoke('audio:readFile', '')).rejects.toThrow('Invalid file path');
    await expect(app.invoke('audio:readFile', path.join(sd.path, 'x.txt'))).rejects.toThrow(
      'Invalid file extension',
    );
    await expect(app.invoke('audio:readFile', path.join(sd.path, 'missing.wav'))).rejects.toThrow(
      'File not found',
    );
  });
});

describe('patches:create', () => {
  beforeEach(() => app.selectFolder(sd.path));

  const form = (over: Record<string, unknown> = {}) => ({
    basePath: sd.path,
    directory: 'Patch04',
    patchName: 'New One',
    rhythmType: 'Silence',
    stopMode: 'StopInstantly',
    phrases: [] as ReturnType<typeof phraseForm>[],
    ...over,
  });

  it('writes patch.xml, phrase.xml and copies the WAV', async () => {
    const wav = outsideWav();
    await app.selectFile(wav);
    await expect(
      app.invoke('patches:create', form({ phrases: [phraseForm('PhraseA', wav)] })),
    ).resolves.toBe(true);

    expect(patchXml('Patch04')).toContain('<PatchName>New One</PatchName>');
    const phrase = fs.readFileSync(path.join(sd.path, 'Patch04', 'PhraseA', 'phrase.xml'), 'utf-8');
    expect(phrase).toContain('<BeatsPerMinute>100</BeatsPerMinute>');
    expect(phrase).toContain('<IsLoop>1</IsLoop>');
    expect(fs.readFileSync(path.join(sd.path, 'Patch04', 'PhraseA', 'phrase.wav'))).toEqual(
      fs.readFileSync(wav),
    );

    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(names(patches).Patch04).toBe('New One');
  });

  it('escapes user text in patch.xml so it reads back unchanged', async () => {
    const patchName = `Tom & Jerry <Live> "Q" 'x' &amp; 🎸`;
    const rhythmType = 'Rock & <Roll>';
    const stopMode = 'Stop > Now & Then';
    await expect(
      app.invoke('patches:create', form({ patchName, rhythmType, stopMode })),
    ).resolves.toBe(true);

    const [created] = (await app.invoke<ReadPatch[]>('patches:read', sd.path)).filter(
      p => p.dir === 'Patch04',
    );
    expect(created, 'the new patch must stay readable').toBeDefined();
    const read = created.data.JamManPatch as unknown as Record<string, string[]>;
    expect(read.PatchName[0]).toBe(patchName);
    expect(read.RhythmType[0]).toBe(rhythmType);
    expect(read.StopMode[0]).toBe(stopMode);
  });

  it('lists a patch whose text contains the words SYSTEM and PUBLIC', async () => {
    await expect(
      app.invoke('patches:create', form({ patchName: 'SYSTEM of a Down', rhythmType: 'PUBLIC' })),
    ).resolves.toBe(true);
    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(names(patches).Patch04).toBe('SYSTEM of a Down');
  });

  it('rolls back the new folder when a source WAV is missing', async () => {
    const wav = outsideWav();
    await app.selectFile(wav);
    fs.rmSync(wav);
    await expect(
      app.invoke('patches:create', form({ phrases: [phraseForm('PhraseA', wav)] })),
    ).rejects.toThrow('Failed to create patch: Source WAV file not found');
    expect(fs.existsSync(path.join(sd.path, 'Patch04'))).toBe(false);
  });

  it('rejects invalid directory names and base paths', async () => {
    await expect(app.invoke('patches:create', form({ directory: '../evil' }))).rejects.toThrow(
      'Invalid patch directory name: ../evil',
    );
    await expect(app.invoke('patches:create', form({ basePath: '' }))).rejects.toThrow(
      'Invalid base path',
    );
  });

  it('refuses to create over an existing patch and leaves it intact', async () => {
    const before = patchXml('Patch01');
    await expect(app.invoke('patches:create', form({ directory: 'Patch01' }))).rejects.toThrow(
      'Failed to create patch: Patch directory Patch01 already exists',
    );
    expect(patchXml('Patch01')).toBe(before);
    expect(fs.existsSync(path.join(sd.path, 'Patch01', 'PhraseA', 'phrase.wav'))).toBe(true);
  });
});

describe('patches:update', () => {
  beforeEach(() => app.selectFolder(sd.path));

  const existingPhrase = (dir: string, phrase: string) =>
    phraseForm(phrase, path.join(sd.path, dir, phrase, 'phrase.wav'));

  it('rewrites the XML, bumps SettingsVersion, keeps IDs and drops removed phrases', async () => {
    await expect(
      app.invoke('patches:update', {
        basePath: sd.path,
        directory: 'Patch02',
        patchName: 'Renamed',
        rhythmType: 'Silence',
        stopMode: 'StopInstantly',
        settingsVersion: '1',
        patchID: SD_FIXTURE_PATCHES[1].id,
        patchOriginID: 'origin-1',
        phrases: [existingPhrase('Patch02', 'PhraseA')],
      }),
    ).resolves.toBe(true);

    const xml = patchXml('Patch02');
    expect(xml).toContain('<PatchName>Renamed</PatchName>');
    expect(xml).toContain('<SettingsVersion>2</SettingsVersion>');
    expect(xml).toContain(`<ID>${SD_FIXTURE_PATCHES[1].id}</ID>`);
    expect(xml).toContain('<OriginID>origin-1</OriginID>');
    expect(fs.existsSync(path.join(sd.path, 'Patch02', 'PhraseB'))).toBe(false);
    const phrase = fs.readFileSync(path.join(sd.path, 'Patch02', 'PhraseA', 'phrase.xml'), 'utf-8');
    expect(phrase).toContain('<ID>000000b0-0000-4000-8000-000000000021</ID>');
    expect(fs.readdirSync(sd.path).filter(d => d.startsWith('__backup_'))).toEqual([]);
  });

  it('escapes user text in patch.xml so it reads back unchanged', async () => {
    const patchName = 'Fish & Chips <2>';
    await expect(
      app.invoke('patches:update', {
        basePath: sd.path,
        directory: 'Patch02',
        patchName,
        rhythmType: 'A & B',
        stopMode: '<Stop>',
        settingsVersion: '1',
        patchID: SD_FIXTURE_PATCHES[1].id,
        patchOriginID: 'origin & 1',
        phrases: [existingPhrase('Patch02', 'PhraseA')],
      }),
    ).resolves.toBe(true);

    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    const updated = patches.find(p => p.dir === 'Patch02');
    expect(updated, 'the updated patch must stay readable').toBeDefined();
    const read = updated!.data.JamManPatch as unknown as Record<string, string[]>;
    expect(read.PatchName[0]).toBe(patchName);
    expect(read.RhythmType[0]).toBe('A & B');
    expect(read.StopMode[0]).toBe('<Stop>');
    expect(read.OriginID[0]).toBe('origin & 1');
  });

  it('restores the original patch when the update fails half-way', async () => {
    const wav = outsideWav();
    await app.selectFile(wav);
    fs.rmSync(wav);
    const before = patchXml('Patch02');

    await expect(
      app.invoke('patches:update', {
        basePath: sd.path,
        directory: 'Patch02',
        patchName: 'Broken',
        rhythmType: 'Silence',
        stopMode: 'StopInstantly',
        phrases: [phraseForm('PhraseA', wav)],
      }),
    ).rejects.toThrow('Failed to update patch: Source WAV file not found');

    expect(patchXml('Patch02')).toBe(before);
    expect(fs.existsSync(path.join(sd.path, 'Patch02', 'PhraseB', 'phrase.wav'))).toBe(true);
    expect(fs.readdirSync(sd.path).filter(d => d.startsWith('__backup_'))).toEqual([]);
  });

  it('fails for a patch that does not exist', async () => {
    await expect(
      app.invoke('patches:update', {
        basePath: sd.path,
        directory: 'Patch09',
        patchName: 'x',
        rhythmType: 'Silence',
        stopMode: 'StopInstantly',
        phrases: [],
      }),
    ).rejects.toThrow('Failed to update patch: Patch directory Patch09 does not exist');
  });
});

describe('patches:delete and patches:deleteBatch', () => {
  beforeEach(() => app.selectFolder(sd.path));

  const deletedDirs = () => fs.readdirSync(sd.path).filter(d => d.startsWith('__deleted_'));

  it('moves the patch aside and removes it for good after 5 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await expect(app.invoke('patches:delete', sd.path, 'Patch02')).resolves.toBe(true);
    expect(fs.existsSync(path.join(sd.path, 'Patch02'))).toBe(false);
    expect(deletedDirs()).toHaveLength(1);

    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(patches.map(p => p.dir).sort()).toEqual(['Patch01', 'Patch03']);

    vi.advanceTimersByTime(5000);
    expect(deletedDirs()).toEqual([]);
  });

  it('reports a missing patch', async () => {
    await expect(app.invoke('patches:delete', sd.path, 'Patch09')).rejects.toThrow(
      'Failed to delete patch: Patch not found: Patch09',
    );
    await expect(app.invoke('patches:delete', sd.path, 'Patch1')).rejects.toThrow(
      'Invalid patch directory name: Patch1',
    );
    await expect(app.invoke('patches:delete', sd.path, '')).rejects.toThrow(
      'Invalid directory name',
    );
  });

  it('deletes what it can in a batch and counts the rest as failed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await expect(
      app.invoke('patches:deleteBatch', sd.path, ['Patch01', 'Patch09', 'Patch03']),
    ).resolves.toEqual({ success: true, deleted: ['Patch01', 'Patch03'], failed: 1 });

    expect(fs.readdirSync(sd.path).filter(d => d.startsWith('Patch'))).toEqual(['Patch02']);
    expect(deletedDirs()).toHaveLength(2);
    vi.advanceTimersByTime(5000);
    expect(deletedDirs()).toEqual([]);
  });

  it('rolls back a batch when moving one patch fails', async () => {
    // Patch02 cannot be moved: its "__deleted_" target is an existing non-empty folder.
    const realMove = (await import('fs-extra')).default.moveSync;
    const fse = (await import('fs-extra')).default;
    vi.spyOn(fse, 'moveSync').mockImplementation((src, dest, opts) => {
      if (String(src).endsWith('Patch02')) throw new Error('disk error');
      return realMove(src, dest, opts);
    });

    await expect(
      app.invoke('patches:deleteBatch', sd.path, ['Patch01', 'Patch02', 'Patch03']),
    ).rejects.toThrow('Failed to delete patches: disk error');

    expect(
      fs
        .readdirSync(sd.path)
        .filter(d => d.startsWith('Patch'))
        .sort(),
    ).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(deletedDirs()).toEqual([]);
  });

  it('rejects invalid directory names in a batch', async () => {
    await expect(app.invoke('patches:deleteBatch', sd.path, ['Patch01', '../x'])).rejects.toThrow(
      'Invalid patch directory names',
    );
    await expect(app.invoke('patches:deleteBatch', sd.path, 'Patch01')).rejects.toThrow(
      'Invalid patch directory names',
    );
  });
});

describe('patches:reorder', () => {
  beforeEach(() => app.selectFolder(sd.path));

  it('renames the folders to follow the new order', async () => {
    await expect(
      app.invoke('patches:reorder', sd.path, ['Patch03', 'Patch01', 'Patch02']),
    ).resolves.toBe(true);
    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(names(patches)).toEqual({
      Patch01: 'Slow Blues',
      Patch02: 'Rock Groove',
      Patch03: 'Waltz Pair',
    });
  });

  it('restores the original names when a rename fails half-way', async () => {
    // Moving Patch02 to its temporary name fails: that name is taken by a non-empty folder.
    fs.mkdirSync(path.join(sd.path, '__tmp_Patch02', 'x'), { recursive: true });

    await expect(
      app.invoke('patches:reorder', sd.path, ['Patch03', 'Patch01', 'Patch02']),
    ).rejects.toThrow('Failed to reorder patches:');

    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(names(patches)).toMatchObject({
      Patch01: 'Rock Groove',
      Patch02: 'Waltz Pair',
      Patch03: 'Slow Blues',
    });
    expect(fs.existsSync(path.join(sd.path, '__tmp_Patch03'))).toBe(false);
    expect(fs.existsSync(path.join(sd.path, '__tmp_Patch01'))).toBe(false);
  });

  it.each([1, 2, 3])(
    'puts every folder back when rename %i of the second step fails',
    async failAt => {
      const before = names(await app.invoke<ReadPatch[]>('patches:read', sd.path));
      let finalRenames = 0;
      let failed = false;
      renameHook.fn = from => {
        // Step 2 moves "__tmp_*" to "PatchNN": fail the failAt-th one. The
        // rollback's own renames (also from "__tmp_*") must not be counted or failed.
        if (!failed && path.basename(from).startsWith('__tmp_') && ++finalRenames === failAt) {
          failed = true;
          throw new Error('disk error');
        }
      };

      await expect(
        app.invoke('patches:reorder', sd.path, ['Patch03', 'Patch01', 'Patch02']),
      ).rejects.toThrow('Failed to reorder patches: disk error');

      expect(finalRenames).toBe(failAt);
      expect(fs.readdirSync(sd.path).sort()).toEqual(['Patch01', 'Patch02', 'Patch03']);
      expect(names(await app.invoke<ReadPatch[]>('patches:read', sd.path))).toEqual(before);
    },
  );

  it('fails before touching anything when a patch is missing', async () => {
    await expect(app.invoke('patches:reorder', sd.path, ['Patch03', 'Patch09'])).rejects.toThrow(
      'Failed to reorder patches: Patch folder not found: Patch09',
    );
    expect(fs.readdirSync(sd.path).sort()).toEqual(['Patch01', 'Patch02', 'Patch03']);
  });
});

describe('export', () => {
  beforeEach(() => app.selectFolder(sd.path));

  it('exports the patch list as TXT', async () => {
    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    const target = path.join(outside.path, 'list.txt');
    app.nextSavePath(target);

    await expect(app.invoke('patches:exportTXT', patches, sd.path)).resolves.toEqual({
      success: true,
      filePath: target,
    });
    const lines = fs.readFileSync(target, 'utf-8').split('\n');
    expect(lines[0]).toBe('JamMan Patches Export');
    expect(lines[1]).toMatch(/^Generated: /);
    expect(lines[2]).toBe('='.repeat(80));
    expect(lines.slice(4, 7)).toEqual(
      patches.map((p, i) => `${i + 1}. ${p.data.JamManPatch.PatchName[0]}`),
    );

    const { dialog } = await import('./test-utils/electronMock.js');
    expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: path.join(sd.path, 'jamman-patches.txt') }),
    );
  });

  it('exports the patch list as PDF', async () => {
    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    const target = path.join(outside.path, 'list.pdf');
    app.nextSavePath(target);

    await expect(app.invoke('patches:exportPDF', patches, sd.path)).resolves.toEqual({
      success: true,
      filePath: target,
    });
    const pdf = fs.readFileSync(target);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('uses "Unknown" for patches without a name', async () => {
    const target = path.join(outside.path, 'list.txt');
    app.nextSavePath(target);
    await app.invoke('patches:exportTXT', [{ dir: 'Patch01' }], sd.path);
    expect(fs.readFileSync(target, 'utf-8')).toContain('1. Unknown');
  });

  it('reports a canceled save dialog', async () => {
    app.nextSavePath(undefined);
    await expect(app.invoke('patches:exportTXT', [], sd.path)).resolves.toEqual({
      success: false,
      canceled: true,
    });
    app.nextSavePath(undefined);
    await expect(app.invoke('patches:exportPDF', [], sd.path)).resolves.toEqual({
      success: false,
      canceled: true,
    });
  });

  it('wraps write errors', async () => {
    app.nextSavePath(path.join(outside.path, 'missing-dir', 'list.txt'));
    await expect(app.invoke('patches:exportTXT', [], sd.path)).rejects.toThrow(
      'Failed to export patches: ',
    );
  });
});

describe('backup', () => {
  beforeEach(() => app.selectFolder(sd.path));

  it('creates a backup stamped with the app version and validates it', async () => {
    const target = path.join(outside.path, 'b.jamman-backup.zip');
    app.nextSavePath(target);

    await expect(
      app.invoke('backup:create', sd.path, ['Patch01', 'Patch02'], true),
    ).resolves.toEqual({
      success: true,
      filePath: target,
    });
    const { dialog } = await import('./test-utils/electronMock.js');
    const [saveOptions] = dialog.showSaveDialog.mock.lastCall as [
      { title: string; defaultPath: string },
    ];
    expect(saveOptions.title).toBe('Save Backup');
    // Compare directory and file name separately: on Windows the separator is `\`.
    expect(path.resolve(path.dirname(saveOptions.defaultPath))).toBe(path.resolve(app.documents));
    expect(path.basename(saveOptions.defaultPath)).toMatch(
      /^jamman-backup-\d{4}-\d{2}-\d{2}\.jamman-backup\.zip$/,
    );

    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [target] });
    await app.invoke('backup:selectFile');

    const info = await app.invoke<{ valid: boolean; manifest: Record<string, unknown> }>(
      'backup:validate',
      target,
    );
    expect(info.valid).toBe(true);
    expect(info.manifest).toMatchObject({
      appVersion: '9.9.9-test',
      patchCount: 2,
      patches: ['Patch01', 'Patch02'],
    });
  });

  it('reports a canceled save dialog', async () => {
    app.nextSavePath(undefined);
    await expect(app.invoke('backup:create', sd.path)).resolves.toEqual({
      success: false,
      canceled: true,
    });
  });

  it('refuses to validate or restore a backup the user did not pick', async () => {
    const zip = path.join(outside.path, 'x.zip');
    fs.writeFileSync(zip, 'zip');
    await expect(app.invoke('backup:validate', zip)).rejects.toThrow('Access denied');
    await expect(app.invoke('backup:restore', zip, sd.path, 'merge')).rejects.toThrow(
      'Access denied',
    );
  });

  it('restores a picked backup into the folder and refreshes the patch list', async () => {
    const zip = path.join(outside.path, 'b.zip');
    app.nextSavePath(zip);
    await app.invoke('backup:create', sd.path, ['Patch01']);
    const { dialog } = await import('./test-utils/electronMock.js');
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [zip] });
    await app.invoke('backup:selectFile');

    await app.invoke('patches:read', sd.path); // fill the cache
    const result = await app.invoke<{ success: boolean; patchesRestored: number }>(
      'backup:restore',
      zip,
      sd.path,
      'merge',
    );
    expect(result).toMatchObject({ success: true, patchesRestored: 1 });

    const patches = await app.invoke<ReadPatch[]>('patches:read', sd.path);
    expect(patches).toHaveLength(4);
    expect(names(patches).Patch04).toBe('Rock Groove');
  });

  it('wraps restore failures', async () => {
    const zip = path.join(sd.path, 'bad.zip');
    fs.writeFileSync(zip, 'not a zip');
    await expect(app.invoke('backup:restore', zip, sd.path, 'replace')).rejects.toThrow(
      'Failed to restore backup: ',
    );
    await expect(app.invoke('backup:validate', zip)).resolves.toMatchObject({ valid: false });
  });
});

describe('undo snapshots', () => {
  beforeEach(() => app.selectFolder(sd.path));

  it('snapshots a patch, restores it after a delete and discards the snapshot', async () => {
    const created = await app.invoke<{ ok: true; snapshot: { id: string; patches: string[] } }>(
      'undo:createSnapshot',
      sd.path,
      { kind: 'patches', patches: ['Patch02'] },
    );
    expect(created).toMatchObject({ ok: true, snapshot: { patches: ['Patch02'] } });
    expect(fs.existsSync(path.join(app.userData, 'undo-snapshots', created.snapshot.id))).toBe(
      true,
    );

    await app.invoke('patches:read', sd.path); // fill the cache
    fs.rmSync(path.join(sd.path, 'Patch02'), { recursive: true });

    await expect(
      app.invoke('undo:restoreSnapshot', created.snapshot.id, sd.path, 'add'),
    ).resolves.toEqual({ ok: true, restored: ['Patch02'], removed: [] });
    expect(names(await app.invoke<ReadPatch[]>('patches:read', sd.path)).Patch02).toBe(
      'Waltz Pair',
    );

    await app.invoke('undo:discardSnapshot', created.snapshot.id);
    expect(fs.existsSync(path.join(app.userData, 'undo-snapshots', created.snapshot.id))).toBe(
      false,
    );
  });

  it('answers expected failures with a code instead of throwing', async () => {
    await expect(
      app.invoke('undo:createSnapshot', outside.path, { kind: 'all' }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'FAILED',
      message: expect.stringContaining('Access denied'),
    });
    await expect(
      app.invoke('undo:restoreSnapshot', '00000000-0000-4000-8000-000000000000', sd.path, 'add'),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('playlists', () => {
  beforeEach(() => app.selectFolder(sd.path));

  type PlaylistOut = { id: string; name: string; patches: string[] };

  it('creates, edits, reorders and deletes a playlist', async () => {
    await expect(app.invoke('playlists:load', sd.path)).resolves.toEqual({
      version: '2.0',
      playlists: [],
      patches: [],
    });

    const created = await app.invoke<PlaylistOut>('playlists:create', sd.path, 'Gig', ['Patch01']);
    expect(created).toMatchObject({ name: 'Gig', patches: ['Patch01'] });

    const added = await app.invoke<PlaylistOut>('playlists:addPatches', sd.path, created.id, [
      'Patch03',
      'Patch02',
    ]);
    expect(added.patches).toEqual(['Patch01', 'Patch03', 'Patch02']);

    const reordered = await app.invoke<PlaylistOut>(
      'playlists:reorderPatches',
      sd.path,
      created.id,
      ['Patch02', 'Patch01', 'Patch03'],
    );
    expect(reordered.patches).toEqual(['Patch02', 'Patch01', 'Patch03']);

    const removed = await app.invoke<PlaylistOut>('playlists:removePatches', sd.path, created.id, [
      'Patch01',
    ]);
    expect(removed.patches).toEqual(['Patch02', 'Patch03']);

    const renamed = await app.invoke<PlaylistOut>('playlists:update', sd.path, created.id, {
      name: 'Tour',
    });
    expect(renamed).toMatchObject({ name: 'Tour', patches: ['Patch02', 'Patch03'] });

    const loaded = await app.invoke<{ playlists: PlaylistOut[] }>('playlists:load', sd.path);
    expect(loaded.playlists).toEqual([expect.objectContaining({ id: created.id, name: 'Tour' })]);

    await expect(app.invoke('playlists:delete', sd.path, created.id)).resolves.toEqual({
      success: true,
    });
    await expect(app.invoke('playlists:load', sd.path)).resolves.toMatchObject({ playlists: [] });
  });

  it('wraps manager errors with the handler prefix', async () => {
    await app.invoke('playlists:create', sd.path, 'Gig');
    await expect(app.invoke('playlists:create', sd.path, 'Gig')).rejects.toThrow(
      'Failed to create playlist: Playlist "Gig" already exists',
    );
    await expect(app.invoke('playlists:update', sd.path, 'nope', {})).rejects.toThrow(
      'Failed to update playlist: Playlist not found: nope',
    );
    await expect(app.invoke('playlists:addPatches', sd.path, 'nope', [])).rejects.toThrow(
      'Failed to add patches to playlist:',
    );
    await expect(app.invoke('playlists:removePatches', sd.path, 'nope', [])).rejects.toThrow(
      'Failed to remove patches from playlist:',
    );
    await expect(app.invoke('playlists:reorderPatches', sd.path, 'nope', [])).rejects.toThrow(
      'Failed to reorder playlist patches:',
    );
    await expect(app.invoke('playlists:export', sd.path, 'nope')).rejects.toThrow(
      'Failed to export playlist: Playlist not found: nope',
    );
  });

  it('exports a playlist as a setlist', async () => {
    const created = await app.invoke<PlaylistOut>('playlists:create', sd.path, 'Gig', [
      'Patch03',
      'Patch01',
    ]);
    const target = path.join(outside.path, 'setlist.txt');
    app.nextSavePath(target);

    await expect(app.invoke('playlists:export', sd.path, created.id)).resolves.toEqual({
      success: true,
      filePath: target,
    });
    const text = fs.readFileSync(target, 'utf-8');
    expect(text.startsWith('Gig\n===\n\nCreated: ')).toBe(true);
    expect(text).toContain(
      'Patches: 2\n\nSetlist:\n--------\n\n01. Patch03 - Slow Blues\n02. Patch01 - Rock Groove\n',
    );
    expect(text.endsWith('\n\nGenerated by JamMan Manager\n')).toBe(true);

    const { dialog } = await import('./test-utils/electronMock.js');
    expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: path.join(app.documents, 'Gig-setlist.txt') }),
    );

    app.nextSavePath(undefined);
    await expect(app.invoke('playlists:export', sd.path, created.id)).resolves.toEqual({
      success: false,
      canceled: true,
    });
  });
});

describe('operation queue', () => {
  it('reports status and statistics', async () => {
    await expect(app.invoke('operation-queue:status')).resolves.toMatchObject({
      queued: [],
      running: [],
      stats: { queuedCount: 0, runningCount: 0, maxConcurrent: 3 },
    });
    await expect(app.invoke('operation-queue:statistics')).resolves.toMatchObject({
      currentlyQueued: 0,
      currentlyRunning: 0,
    });
  });

  it('queues each writing operation with its priority and lock', async () => {
    await app.selectFolder(sd.path);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const enqueue = vi.spyOn(operationQueue, 'enqueue');
    const withLock = vi.spyOn(lockManager, 'withLock');

    const wav = path.join(sd.path, 'Patch01', 'PhraseA', 'phrase.wav');
    const form = (directory: string) => ({
      basePath: sd.path,
      directory,
      patchName: 'x',
      rhythmType: 'Silence',
      stopMode: 'StopInstantly',
      phrases: [phraseForm('PhraseA', wav)],
    });
    await app.invoke('patches:create', form('Patch04'));
    await app.invoke('patches:update', form('Patch04'));
    await app.invoke('patches:delete', sd.path, 'Patch04');
    await app.invoke('patches:deleteBatch', sd.path, ['Patch03']);
    await app.invoke('patches:reorder', sd.path, ['Patch02', 'Patch01']);
    app.nextSavePath(undefined);
    await app.invoke('backup:create', sd.path);
    const snap = await app.invoke<{ snapshot: { id: string } }>('undo:createSnapshot', sd.path, {
      kind: 'all',
    });
    await app.invoke('undo:restoreSnapshot', snap.snapshot.id, sd.path, 'replace');
    const zip = path.join(sd.path, 'bad.zip');
    fs.writeFileSync(zip, 'x');
    await app.invoke('backup:restore', zip, sd.path, 'merge').catch(() => undefined);

    expect(
      enqueue.mock.calls.map(([type, description, , priority]) => [type, description, priority]),
    ).toEqual([
      ['patches:create', 'Create patch: Patch04', OperationPriority.NORMAL],
      ['patches:update', 'Update patch: Patch04', OperationPriority.NORMAL],
      ['patches:delete', 'Delete patch: Patch04', OperationPriority.HIGH],
      ['patches:deleteBatch', 'Delete 1 patches', OperationPriority.HIGH],
      ['patches:reorder', 'Reorder 2 patches', OperationPriority.NORMAL],
      ['backup:create', 'Create backup', OperationPriority.NORMAL],
      ['undo:createSnapshot', 'Create undo snapshot', OperationPriority.HIGH],
      ['undo:restoreSnapshot', 'Restore undo snapshot', OperationPriority.HIGH],
      ['backup:restore', 'Restore backup (merge mode)', OperationPriority.HIGH],
    ]);

    const patch04 = path.join(sd.path, 'Patch04');
    expect(withLock.mock.calls.map(([key]) => key)).toEqual(
      expect.arrayContaining([patch04, path.join(sd.path, 'Patch03'), sd.path]),
    );
    expect(withLock.mock.calls.slice(0, 3).map(([key]) => key)).toEqual([
      patch04,
      patch04,
      patch04,
    ]);
  });
});
