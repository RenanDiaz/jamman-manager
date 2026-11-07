import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlaylistManager } from './PlaylistManager';
import {
  PLAYLIST_FORMAT_VERSION,
  PLAYLIST_SCHEMA_VERSION,
  collectLegacyPatchDirs,
  getPlaylistSchemaVersion,
  migratePlaylistFile,
} from './PlaylistSchema';
import { syntheticPlaylists, writeSyntheticSd } from './__fixtures__/backups/synthetic-sd';

const legacyDirBased = {
  version: '1.0',
  playlists: [
    {
      id: 'pl-1',
      name: 'Old set',
      patches: ['Patch02', 'Patch01', 'Patch99'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
};

describe('PlaylistSchema (pure migration)', () => {
  it('treats a file without schemaVersion as legacy v1', () => {
    expect(getPlaylistSchemaVersion({ version: '2.0', playlists: [] })).toBe(1);
    expect(getPlaylistSchemaVersion({ schemaVersion: 2, version: '2.0', playlists: [] })).toBe(2);
  });

  it('rejects non-object input and non-integer schemaVersion', () => {
    expect(() => getPlaylistSchemaVersion(null)).toThrow();
    expect(() => getPlaylistSchemaVersion([])).toThrow();
    expect(() => getPlaylistSchemaVersion({ schemaVersion: '2' })).toThrow();
    expect(() => migratePlaylistFile('nope')).toThrow();
  });

  it('migrates a v1 directory-based file to v2 using the dir -> id map', () => {
    const dirs = collectLegacyPatchDirs(legacyDirBased);
    expect(dirs.sort()).toEqual(['Patch01', 'Patch02', 'Patch99']);

    const dirToId = new Map([
      ['Patch01', 'id-1'],
      ['Patch02', 'id-2'],
    ]);
    const { data, migrated } = migratePlaylistFile(legacyDirBased, dirToId);

    expect(migrated).toBe(true);
    expect(data.schemaVersion).toBe(PLAYLIST_SCHEMA_VERSION);
    expect(data.version).toBe(PLAYLIST_FORMAT_VERSION);
    expect(data.playlists).toEqual([
      {
        id: 'pl-1',
        name: 'Old set',
        patchIds: ['id-2', 'id-1'], // order kept, unresolvable Patch99 dropped
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('migrates a v1 ID-based (version 2.0) file by adding schemaVersion only', () => {
    const raw = JSON.parse(syntheticPlaylists());
    expect(collectLegacyPatchDirs(raw)).toEqual([]);

    const { data, migrated } = migratePlaylistFile(raw);
    expect(migrated).toBe(true);
    expect(data).toEqual({ ...raw, schemaVersion: 2 });
  });

  it('does not mutate its input', () => {
    const raw = structuredClone(legacyDirBased);
    migratePlaylistFile(raw, new Map([['Patch01', 'id-1']]));
    expect(raw).toEqual(legacyDirBased);
  });

  it('handles missing or malformed playlists arrays', () => {
    expect(migratePlaylistFile({}).data).toEqual({
      schemaVersion: 2,
      version: '2.0',
      playlists: [],
    });
    expect(migratePlaylistFile({ version: '1.0', playlists: 'x' }).data.playlists).toEqual([]);
  });

  it('leaves a current-schema file unchanged', () => {
    const current = {
      schemaVersion: 2,
      version: '2.0',
      playlists: [{ id: 'a', name: 'A', patchIds: ['x'], createdAt: 'c', updatedAt: 'u' }],
    };
    const { data, migrated } = migratePlaylistFile(current);
    expect(migrated).toBe(false);
    expect(data).toEqual(current);
    expect(collectLegacyPatchDirs(current)).toEqual([]);
  });

  it('refuses a schema newer than supported', () => {
    expect(() => migratePlaylistFile({ schemaVersion: 99, playlists: [] })).toThrow(/newer/);
  });
});

describe('PlaylistManager schemaVersion on disk', () => {
  let sdDir: string;
  const playlistFile = () => path.join(sdDir, '.jamman-playlists.json');
  const readFile = () => JSON.parse(fs.readFileSync(playlistFile(), 'utf-8'));

  beforeEach(() => {
    sdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamman-playlist-schema-'));
    writeSyntheticSd(sdDir, false);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(sdDir, { recursive: true, force: true });
  });

  it('migrates a legacy directory-based file on load and persists schemaVersion', async () => {
    fs.writeFileSync(playlistFile(), JSON.stringify(legacyDirBased));

    const loaded = await PlaylistManager.loadPlaylists(sdDir);

    expect(loaded.playlists[0].patchIds).toEqual(['patch-id-02', 'patch-id-01']);
    expect((loaded.playlists[0] as unknown as { patches: string[] }).patches).toEqual([
      'Patch02',
      'Patch01',
    ]);
    const onDisk = readFile();
    expect(onDisk.schemaVersion).toBe(2);
    expect(onDisk.version).toBe('2.0');
    expect(onDisk.playlists[0].patchIds).toEqual(['patch-id-02', 'patch-id-01']);
    expect(onDisk.playlists[0].patches).toBeUndefined();
  });

  it('migrates a legacy ID-based file (the one in old backups) on load', async () => {
    fs.writeFileSync(playlistFile(), syntheticPlaylists());

    const loaded = await PlaylistManager.loadPlaylists(sdDir);

    expect(loaded.playlists).toHaveLength(1);
    expect((loaded.playlists[0] as unknown as { patches: string[] }).patches).toEqual([
      'Patch02',
      'Patch01',
    ]);
    expect(readFile().schemaVersion).toBe(2);
  });

  it('writes schemaVersion when saving a new playlist', async () => {
    await PlaylistManager.createPlaylist(sdDir, 'New', ['Patch05']);
    const onDisk = readFile();
    expect(onDisk.schemaVersion).toBe(PLAYLIST_SCHEMA_VERSION);
    expect(onDisk.playlists[0].patchIds).toEqual(['patch-id-05']);
  });

  it('does not rewrite a file that is already at the current schema', async () => {
    await PlaylistManager.createPlaylist(sdDir, 'New', ['Patch05']);
    const before = fs.readFileSync(playlistFile(), 'utf-8');
    const past = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(playlistFile(), past, past);

    await PlaylistManager.loadPlaylists(sdDir);

    expect(fs.statSync(playlistFile()).mtime.getTime()).toBe(past.getTime());
    expect(fs.readFileSync(playlistFile(), 'utf-8')).toBe(before);
  });

  it('returns no playlists (and does not throw) for a newer schema', async () => {
    fs.writeFileSync(playlistFile(), JSON.stringify({ schemaVersion: 99, playlists: [] }));
    const loaded = await PlaylistManager.loadPlaylists(sdDir);
    expect(loaded.playlists).toEqual([]);
  });
});
