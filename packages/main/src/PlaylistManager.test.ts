/**
 * PlaylistManager tests — real code, real fs on a temp copy of the JamMan SD fixture.
 * Only the logger (electron-log, used by SecureXMLParser) is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTempSd, SD_FIXTURE_PATCHES, type TempSd } from '../../../tests/fixtures/index.js';
import { PlaylistManager } from './PlaylistManager.js';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const [P1, P2, P3] = SD_FIXTURE_PATCHES;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('PlaylistManager', () => {
  let sd: TempSd;
  let base: string;
  let playlistFile: string;

  const readFile = () => JSON.parse(fs.readFileSync(playlistFile, 'utf-8'));
  const writeFile = (data: unknown) => fs.writeFileSync(playlistFile, JSON.stringify(data));
  const names = async () => (await PlaylistManager.loadPlaylists(base)).playlists.map(p => p.name);

  beforeEach(() => {
    sd = createTempSd();
    base = sd.path;
    playlistFile = path.join(base, '.jamman-playlists.json');
    // PlaylistManager logs with console.*; keep test output clean
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sd.cleanup();
  });

  describe('loadPlaylists', () => {
    it('returns an empty v2 structure when no playlist file exists', async () => {
      const data = await PlaylistManager.loadPlaylists(base);
      expect(data).toEqual({ version: '2.0', playlists: [], patches: [] });
      expect(fs.existsSync(playlistFile)).toBe(false);
    });

    it('falls back to empty playlists on corrupt JSON without touching the file', async () => {
      fs.writeFileSync(playlistFile, '{ this is not json');
      const data = await PlaylistManager.loadPlaylists(base);
      expect(data.playlists).toEqual([]);
      expect(fs.readFileSync(playlistFile, 'utf-8')).toBe('{ this is not json');
    });

    it('falls back to empty playlists on an empty file', async () => {
      fs.writeFileSync(playlistFile, '');
      expect((await PlaylistManager.loadPlaylists(base)).playlists).toEqual([]);
    });

    it('treats a non-array "playlists" field as no playlists', async () => {
      writeFile({ version: '2.0', playlists: { nope: true } });
      expect((await PlaylistManager.loadPlaylists(base)).playlists).toEqual([]);
    });

    it('tolerates a playlist entry without patchIds', async () => {
      writeFile({ version: '2.0', playlists: [{ id: 'x', name: 'Bare' }] });
      const { playlists } = await PlaylistManager.loadPlaylists(base);
      expect(playlists).toHaveLength(1);
      expect(playlists[0].patches).toEqual([]);
    });

    it('resolves stored patch IDs to the current directory names', async () => {
      writeFile({
        version: '2.0',
        playlists: [{ id: 'a', name: 'Set', patchIds: [P3.id, P1.id] }],
      });
      const { playlists } = await PlaylistManager.loadPlaylists(base);
      expect(playlists[0].patches).toEqual([P3.dir, P1.dir]);
    });

    it('follows a patch when its directory is renamed (IDs, not folder names, are stored)', async () => {
      const created = await PlaylistManager.createPlaylist(base, 'Set', [P1.dir, P2.dir]);
      fs.renameSync(path.join(base, P1.dir), path.join(base, 'Patch09'));

      const { playlists } = await PlaylistManager.loadPlaylists(base);
      expect(playlists.find(p => p.id === created.id)?.patches).toEqual(['Patch09', P2.dir]);
    });

    it('omits patches deleted from the SD but keeps their IDs in the file', async () => {
      await PlaylistManager.createPlaylist(base, 'Set', [P1.dir, P2.dir]);
      fs.rmSync(path.join(base, P1.dir), { recursive: true });

      const { playlists } = await PlaylistManager.loadPlaylists(base);
      expect(playlists[0].patches).toEqual([P2.dir]);
      expect(readFile().playlists[0].patchIds).toEqual([P1.id, P2.id]);
    });

    it('ignores folders with a corrupt patch.xml when resolving IDs', async () => {
      writeFile({ version: '2.0', playlists: [{ id: 'a', name: 'S', patchIds: [P1.id, P2.id] }] });
      fs.writeFileSync(path.join(base, P1.dir, 'patch.xml'), '<JamManPatch><unclosed>');
      expect((await PlaylistManager.loadPlaylists(base)).playlists[0].patches).toEqual([P2.dir]);
    });

    it('ignores non-"Patch*" folders and plain files when resolving IDs', async () => {
      fs.cpSync(path.join(base, P1.dir), path.join(base, 'Backup01'), { recursive: true });
      writeFile({ version: '2.0', playlists: [{ id: 'a', name: 'S', patchIds: [P1.id] }] });
      expect((await PlaylistManager.loadPlaylists(base)).playlists[0].patches).toEqual([P1.dir]);
    });

    it('migrates a v1 file (directory names) to v2 (IDs) and rewrites it', async () => {
      writeFile({
        version: '1.0',
        playlists: [{ id: 'old', name: 'Legacy', patches: [P2.dir, P1.dir, 'Patch77'] }],
      });

      const { version, playlists } = await PlaylistManager.loadPlaylists(base);

      expect(version).toBe('2.0');
      expect(playlists[0].patches).toEqual([P2.dir, P1.dir]);
      const onDisk = readFile();
      expect(onDisk.version).toBe('2.0');
      expect(onDisk.playlists[0].patchIds).toEqual([P2.id, P1.id]); // missing Patch77 dropped
      expect(onDisk.playlists[0].patches).toBeUndefined();
    });

    it('treats a file without a version as v1', async () => {
      writeFile({ playlists: [{ id: 'old', name: 'Legacy', patches: [P3.dir] }] });
      const { version, playlists } = await PlaylistManager.loadPlaylists(base);
      expect(version).toBe('2.0');
      expect(playlists[0].patches).toEqual([P3.dir]);
      expect(readFile().version).toBe('2.0');
    });
  });

  describe('createPlaylist', () => {
    it('creates a playlist and persists IDs in the on-disk format', async () => {
      const playlist = await PlaylistManager.createPlaylist(base, 'Gig', [P2.dir, P1.dir]);

      expect(playlist.id).toMatch(UUID_RE);
      expect(playlist.name).toBe('Gig');
      expect((playlist as any).patches).toEqual([P2.dir, P1.dir]);
      expect(playlist.createdAt).toBe(playlist.updatedAt);

      const onDisk = readFile();
      expect(onDisk.version).toBe('2.0');
      expect(onDisk.playlists).toEqual([
        {
          id: playlist.id,
          name: 'Gig',
          patchIds: [P2.id, P1.id],
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
        },
      ]);
    });

    it('creates an empty playlist when no patches are given', async () => {
      const playlist = await PlaylistManager.createPlaylist(base, 'Empty');
      expect(playlist.patchIds).toEqual([]);
      expect(await names()).toEqual(['Empty']);
    });

    it('generates distinct IDs', async () => {
      const a = await PlaylistManager.createPlaylist(base, 'A');
      const b = await PlaylistManager.createPlaylist(base, 'B');
      expect(a.id).not.toBe(b.id);
    });

    it('rejects duplicate names and leaves the file untouched', async () => {
      await PlaylistManager.createPlaylist(base, 'Gig');
      const before = fs.readFileSync(playlistFile, 'utf-8');
      await expect(PlaylistManager.createPlaylist(base, 'Gig')).rejects.toThrow(
        'Playlist "Gig" already exists',
      );
      expect(fs.readFileSync(playlistFile, 'utf-8')).toBe(before);
    });

    it('treats names as case-sensitive', async () => {
      await PlaylistManager.createPlaylist(base, 'Gig');
      await expect(PlaylistManager.createPlaylist(base, 'gig')).resolves.toBeDefined();
    });

    it('does not persist directories that do not exist on the SD', async () => {
      await PlaylistManager.createPlaylist(base, 'Gig', [P1.dir, 'Patch77']);
      expect(readFile().playlists[0].patchIds).toEqual([P1.id]);
    });

    // The returned object used to echo the requested dirs instead of what was stored,
    // so the caller saw 'Patch77' in a playlist that does not contain it.
    it('returns only the patches that were actually stored', async () => {
      const playlist = await PlaylistManager.createPlaylist(base, 'Gig', [P1.dir, 'Patch77']);
      expect((playlist as any).patches).toEqual([P1.dir]);
    });

    it('returns the patches in the stored order, skipping unknown ones in between', async () => {
      const playlist = await PlaylistManager.createPlaylist(base, 'Gig', [
        P2.dir,
        'Patch77',
        P1.dir,
      ]);
      expect((playlist as any).patches).toEqual([P2.dir, P1.dir]);
      expect(await PlaylistManager.getPlaylistPatches(base, playlist.id)).toEqual(
        (playlist as any).patches,
      );
    });

    it('fails with a clear message when the SD is not writable/existing', async () => {
      const missing = path.join(base, 'does-not-exist');
      await expect(PlaylistManager.createPlaylist(missing, 'X')).rejects.toThrow(
        /Failed to save playlists/,
      );
    });

    // Load-modify-save used to run unserialized: concurrent creates both read the same
    // snapshot, and the last writer silently dropped the other playlist.
    it('keeps both playlists when two are created concurrently', async () => {
      await Promise.all([
        PlaylistManager.createPlaylist(base, 'One', [P1.dir]),
        PlaylistManager.createPlaylist(base, 'Two', [P2.dir]),
      ]);
      expect((await names()).sort()).toEqual(['One', 'Two']);
    });
  });

  describe('concurrent writes', () => {
    it('keeps every playlist when many are created at once', async () => {
      const wanted = Array.from({ length: 12 }, (_, i) => `List ${i}`);
      await Promise.all(wanted.map(name => PlaylistManager.createPlaylist(base, name, [P1.dir])));
      expect((await names()).sort()).toEqual([...wanted].sort());
    });

    it('keeps changes made to different playlists at the same time', async () => {
      const a = await PlaylistManager.createPlaylist(base, 'A', [P1.dir]);
      const b = await PlaylistManager.createPlaylist(base, 'B', [P1.dir]);
      await Promise.all([
        PlaylistManager.addPatchesToPlaylist(base, a.id, [P2.dir]),
        PlaylistManager.updatePlaylist(base, b.id, { name: 'B2' }),
        PlaylistManager.createPlaylist(base, 'C'),
        PlaylistManager.deletePlaylist(base, b.id).catch(() => undefined),
      ]);
      const stored = readFile().playlists;
      const byName = Object.fromEntries(stored.map((p: { name: string }) => [p.name, p]));
      expect(byName.A.patchIds).toEqual([P1.id, P2.id]);
      expect(byName.C).toBeDefined();
      expect(byName.B).toBeUndefined();
    });

    it('still rejects a duplicate name created concurrently', async () => {
      const results = await Promise.allSettled([
        PlaylistManager.createPlaylist(base, 'Same'),
        PlaylistManager.createPlaylist(base, 'Same'),
      ]);
      expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(readFile().playlists).toHaveLength(1);
    });

    it('does not let a failed operation block the ones queued behind it', async () => {
      const [failed, ok] = await Promise.allSettled([
        PlaylistManager.deletePlaylist(base, 'missing'),
        PlaylistManager.createPlaylist(base, 'After'),
      ]);
      expect(failed.status).toBe('rejected');
      expect(ok.status).toBe('fulfilled');
      expect(await names()).toEqual(['After']);
    });

    it('does not serialize across different SD folders', async () => {
      const other = createTempSd();
      try {
        await Promise.all([
          PlaylistManager.createPlaylist(base, 'Here'),
          PlaylistManager.createPlaylist(other.path, 'There'),
        ]);
        expect(await names()).toEqual(['Here']);
        expect(
          (await PlaylistManager.loadPlaylists(other.path)).playlists.map(p => p.name),
        ).toEqual(['There']);
      } finally {
        other.cleanup();
      }
    });
  });

  describe('updatePlaylist', () => {
    it('renames a playlist and bumps updatedAt', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
      const created = await PlaylistManager.createPlaylist(base, 'Old', [P1.dir]);
      vi.setSystemTime(new Date('2025-01-02T00:00:00.000Z'));

      const updated = await PlaylistManager.updatePlaylist(base, created.id, { name: 'New' });

      expect(updated.name).toBe('New');
      expect(updated.createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(updated.updatedAt).toBe('2025-01-02T00:00:00.000Z');
      expect((updated as any).patches).toEqual([P1.dir]);
      expect(readFile().playlists[0].name).toBe('New');
    });

    it('allows "renaming" to the same name', async () => {
      const created = await PlaylistManager.createPlaylist(base, 'Same');
      await expect(
        PlaylistManager.updatePlaylist(base, created.id, { name: 'Same' }),
      ).resolves.toBeDefined();
    });

    it('rejects renaming onto another playlist name', async () => {
      await PlaylistManager.createPlaylist(base, 'A');
      const b = await PlaylistManager.createPlaylist(base, 'B');
      await expect(PlaylistManager.updatePlaylist(base, b.id, { name: 'A' })).rejects.toThrow(
        'Playlist "A" already exists',
      );
      expect(await names()).toEqual(['A', 'B']);
    });

    it('replaces the patch list when "patches" is given (including with an empty list)', async () => {
      const created = await PlaylistManager.createPlaylist(base, 'S', [P1.dir]);

      const replaced = await PlaylistManager.updatePlaylist(base, created.id, {
        patches: [P3.dir, P2.dir],
      });
      expect((replaced as any).patches).toEqual([P3.dir, P2.dir]);
      expect(readFile().playlists[0].patchIds).toEqual([P3.id, P2.id]);

      const cleared = await PlaylistManager.updatePlaylist(base, created.id, { patches: [] });
      expect((cleared as any).patches).toEqual([]);
    });

    it('leaves the patch list alone when only the name changes', async () => {
      const created = await PlaylistManager.createPlaylist(base, 'S', [P1.dir, P2.dir]);
      await PlaylistManager.updatePlaylist(base, created.id, { name: 'T' });
      expect(readFile().playlists[0].patchIds).toEqual([P1.id, P2.id]);
    });

    it('ignores an empty-string name (keeps the old one)', async () => {
      const created = await PlaylistManager.createPlaylist(base, 'Keep');
      const updated = await PlaylistManager.updatePlaylist(base, created.id, { name: '' });
      expect(updated.name).toBe('Keep');
    });

    it('throws for an unknown playlist ID', async () => {
      await expect(PlaylistManager.updatePlaylist(base, 'nope', { name: 'x' })).rejects.toThrow(
        'Playlist not found: nope',
      );
    });
  });

  describe('deletePlaylist', () => {
    it('removes only the requested playlist', async () => {
      const a = await PlaylistManager.createPlaylist(base, 'A', [P1.dir]);
      await PlaylistManager.createPlaylist(base, 'B');

      await PlaylistManager.deletePlaylist(base, a.id);

      expect(await names()).toEqual(['B']);
    });

    it('does not touch the patches on the SD', async () => {
      const a = await PlaylistManager.createPlaylist(base, 'A', [P1.dir]);
      await PlaylistManager.deletePlaylist(base, a.id);
      expect(fs.existsSync(path.join(base, P1.dir, 'patch.xml'))).toBe(true);
    });

    it('throws for an unknown ID and leaves the file untouched', async () => {
      await PlaylistManager.createPlaylist(base, 'A');
      const before = fs.readFileSync(playlistFile, 'utf-8');
      await expect(PlaylistManager.deletePlaylist(base, 'nope')).rejects.toThrow(
        'Playlist not found: nope',
      );
      expect(fs.readFileSync(playlistFile, 'utf-8')).toBe(before);
    });

    it('throws when deleting twice', async () => {
      const a = await PlaylistManager.createPlaylist(base, 'A');
      await PlaylistManager.deletePlaylist(base, a.id);
      await expect(PlaylistManager.deletePlaylist(base, a.id)).rejects.toThrow(/not found/);
    });
  });

  describe('addPatchesToPlaylist / removePatchesFromPlaylist', () => {
    it('appends new patches in order and skips ones already present', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P2.dir]);
      const result = await PlaylistManager.addPatchesToPlaylist(base, pl.id, [
        P1.dir,
        P2.dir,
        P3.dir,
      ]);
      expect((result as any).patches).toEqual([P2.dir, P1.dir, P3.dir]);
    });

    it('does not add the same patch twice when it appears twice in the request', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S');
      await PlaylistManager.addPatchesToPlaylist(base, pl.id, [P1.dir, P1.dir]);
      expect(readFile().playlists[0].patchIds).toEqual([P1.id]);
    });

    it('ignores directories that do not exist', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S');
      await PlaylistManager.addPatchesToPlaylist(base, pl.id, ['Patch77']);
      expect(readFile().playlists[0].patchIds).toEqual([]);
    });

    it('removes the given patches and keeps the rest in order', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P1.dir, P2.dir, P3.dir]);
      const result = await PlaylistManager.removePatchesFromPlaylist(base, pl.id, [P2.dir]);
      expect((result as any).patches).toEqual([P1.dir, P3.dir]);
    });

    it('removing a patch that is not in the playlist is a no-op', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P1.dir]);
      const result = await PlaylistManager.removePatchesFromPlaylist(base, pl.id, [P3.dir]);
      expect((result as any).patches).toEqual([P1.dir]);
    });

    it('throw for an unknown playlist', async () => {
      await expect(PlaylistManager.addPatchesToPlaylist(base, 'nope', [P1.dir])).rejects.toThrow(
        /not found/,
      );
      await expect(
        PlaylistManager.removePatchesFromPlaylist(base, 'nope', [P1.dir]),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('reorderPlaylistPatches', () => {
    it('applies a new order', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P1.dir, P2.dir, P3.dir]);
      const result = await PlaylistManager.reorderPlaylistPatches(base, pl.id, [
        P3.dir,
        P1.dir,
        P2.dir,
      ]);
      expect((result as any).patches).toEqual([P3.dir, P1.dir, P2.dir]);
      expect(readFile().playlists[0].patchIds).toEqual([P3.id, P1.id, P2.id]);
      expect(await PlaylistManager.getPlaylistPatches(base, pl.id)).toEqual([
        P3.dir,
        P1.dir,
        P2.dir,
      ]);
    });

    it('rejects an order with missing patches and keeps the old order', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P1.dir, P2.dir]);
      await expect(PlaylistManager.reorderPlaylistPatches(base, pl.id, [P2.dir])).rejects.toThrow(
        /Invalid patch order/,
      );
      expect(readFile().playlists[0].patchIds).toEqual([P1.id, P2.id]);
    });

    it('rejects an order that includes a patch not in the playlist', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P1.dir, P2.dir]);
      await expect(
        PlaylistManager.reorderPlaylistPatches(base, pl.id, [P1.dir, P3.dir]),
      ).rejects.toThrow('Invalid patch order');
    });

    it('rejects an order that contains an unknown directory', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P1.dir, P2.dir]);
      await expect(
        PlaylistManager.reorderPlaylistPatches(base, pl.id, [P1.dir, 'Patch77']),
      ).rejects.toThrow('Invalid patch order');
    });

    it('accepts an empty order only for an empty playlist', async () => {
      const empty = await PlaylistManager.createPlaylist(base, 'E');
      await expect(
        PlaylistManager.reorderPlaylistPatches(base, empty.id, []),
      ).resolves.toBeDefined();
      const full = await PlaylistManager.createPlaylist(base, 'F', [P1.dir]);
      await expect(PlaylistManager.reorderPlaylistPatches(base, full.id, [])).rejects.toThrow();
    });

    // Validation used to compare only lengths, so a duplicated entry stood in for a
    // missing one: [P1, P1] passed for a playlist of [P1, P2] and silently dropped P2.
    it('rejects an order that repeats a patch instead of dropping another', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P1.dir, P2.dir]);
      await expect(
        PlaylistManager.reorderPlaylistPatches(base, pl.id, [P1.dir, P1.dir]),
      ).rejects.toThrow();
      expect(readFile().playlists[0].patchIds).toEqual([P1.id, P2.id]);
    });

    it('rejects a longer order that repeats a patch', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P1.dir, P2.dir]);
      await expect(
        PlaylistManager.reorderPlaylistPatches(base, pl.id, [P1.dir, P2.dir, P1.dir]),
      ).rejects.toThrow(/Invalid patch order/);
      expect(readFile().playlists[0].patchIds).toEqual([P1.id, P2.id]);
    });

    it('rejects a same-length order where one patch is swapped for a foreign one', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P1.dir, P2.dir]);
      await expect(
        PlaylistManager.reorderPlaylistPatches(base, pl.id, [P1.dir, P3.dir]),
      ).rejects.toThrow(/Invalid patch order/);
      expect(readFile().playlists[0].patchIds).toEqual([P1.id, P2.id]);
    });

    it('throws for an unknown playlist', async () => {
      await expect(PlaylistManager.reorderPlaylistPatches(base, 'nope', [])).rejects.toThrow(
        /not found/,
      );
    });
  });

  describe('getPlaylistPatches', () => {
    it('returns directories in playlist order', async () => {
      const pl = await PlaylistManager.createPlaylist(base, 'S', [P3.dir, P1.dir]);
      expect(await PlaylistManager.getPlaylistPatches(base, pl.id)).toEqual([P3.dir, P1.dir]);
    });

    it('throws for an unknown playlist', async () => {
      await expect(PlaylistManager.getPlaylistPatches(base, 'nope')).rejects.toThrow(/not found/);
    });
  });

  describe('cleanupDeletedPatches', () => {
    it('drops IDs of patches that are no longer in the existing list, in every playlist', async () => {
      await PlaylistManager.createPlaylist(base, 'A', [P1.dir, P2.dir]);
      await PlaylistManager.createPlaylist(base, 'B', [P2.dir, P3.dir]);

      await PlaylistManager.cleanupDeletedPatches(base, [P1.dir, P3.dir]);

      const { playlists } = readFile();
      expect(playlists[0].patchIds).toEqual([P1.id]);
      expect(playlists[1].patchIds).toEqual([P3.id]);
    });

    it('bumps updatedAt only on playlists that changed', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
      await PlaylistManager.createPlaylist(base, 'Changed', [P1.dir, P2.dir]);
      await PlaylistManager.createPlaylist(base, 'Same', [P1.dir]);
      vi.setSystemTime(new Date('2025-02-01T00:00:00.000Z'));

      await PlaylistManager.cleanupDeletedPatches(base, [P1.dir]);

      const { playlists } = readFile();
      expect(playlists[0].updatedAt).toBe('2025-02-01T00:00:00.000Z');
      expect(playlists[1].updatedAt).toBe('2025-01-01T00:00:00.000Z');
    });

    it('does not rewrite the file when nothing changes', async () => {
      await PlaylistManager.createPlaylist(base, 'A', [P1.dir]);
      const before = fs.readFileSync(playlistFile, 'utf-8');
      fs.utimesSync(playlistFile, new Date(0), new Date(0));

      await PlaylistManager.cleanupDeletedPatches(base, [P1.dir, P2.dir, P3.dir]);

      expect(fs.readFileSync(playlistFile, 'utf-8')).toBe(before);
      expect(fs.statSync(playlistFile).mtimeMs).toBe(0);
    });

    it('is a no-op when there is no playlist file', async () => {
      await PlaylistManager.cleanupDeletedPatches(base, [P1.dir]);
      expect(fs.existsSync(playlistFile)).toBe(false);
    });
  });

  describe('savePlaylists', () => {
    it('writes pretty-printed JSON that loadPlaylists can read back', async () => {
      PlaylistManager.savePlaylists(base, {
        version: '2.0',
        playlists: [{ id: 'x', name: 'Raw', patchIds: [P1.id], createdAt: 'c', updatedAt: 'u' }],
      });
      expect(fs.readFileSync(playlistFile, 'utf-8')).toContain('\n  "version": "2.0"');
      const { playlists } = await PlaylistManager.loadPlaylists(base);
      expect(playlists[0]).toMatchObject({ id: 'x', name: 'Raw', patches: [P1.dir] });
    });

    it('wraps fs errors in a descriptive error', () => {
      expect(() =>
        PlaylistManager.savePlaylists(path.join(base, 'missing'), {
          version: '2.0',
          playlists: [],
        }),
      ).toThrow(/^Failed to save playlists: /);
    });
  });
});
