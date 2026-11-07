import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import AdmZip from 'adm-zip';
import {
  BACKUP_SCHEMA_VERSION,
  BackupManager,
  MAX_AUDIO_ENTRY_BYTES,
  getManifestSchemaVersion,
  migrateManifest,
} from './BackupManager';
import {
  syntheticPlaylists,
  syntheticSdFiles,
  writeSyntheticSd,
} from './__fixtures__/backups/synthetic-sd';

const FIXTURES = path.join(__dirname, '__fixtures__', 'backups');
const LEGACY_FULL = path.join(FIXTURES, 'legacy-v1-full-with-playlists.zip');
const LEGACY_PARTIAL = path.join(FIXTURES, 'legacy-v1-partial-no-playlists.zip');

// ---- Raw ZIP writer -------------------------------------------------------------
// adm-zip sanitizes names in addFile(), so malicious archives are assembled by hand.

interface RawEntry {
  name: string;
  data?: Buffer;
  /** 0 = stored, 8 = deflated (default). */
  method?: 0 | 8;
  /** Unix mode stored in the external attributes (type + permission bits). */
  unixMode?: number;
  /** Uncompressed size written in the headers; defaults to the real size. */
  declaredSize?: number;
  /** CRC-32 written in the headers; defaults to the real CRC. */
  crc?: number;
}

function buildZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.data ?? Buffer.alloc(0);
    const method = e.method ?? 8;
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = e.crc ?? zlib.crc32(data);
    const size = e.declaredSize ?? data.length;
    const unixMode = e.unixMode ?? (e.name.endsWith('/') ? 0o040755 : 0o100644);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size >>> 0, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size >>> 0, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((unixMode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    const localRecord = Buffer.concat([local, name, compressed]);
    locals.push(localRecord);
    centrals.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }

  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const PATCH_XML = Buffer.from('<JamManPatch><ID>evil</ID></JamManPatch>');

function manifestEntry(patches: string[] = ['Patch01'], extra: object = {}): RawEntry {
  return {
    name: 'manifest.json',
    data: Buffer.from(
      JSON.stringify({
        version: '1.0',
        appVersion: '0.1.0',
        patchCount: patches.length,
        createdAt: '2025-01-01T00:00:00.000Z',
        patches,
        ...extra,
      }),
    ),
  };
}

/** A minimal valid backup (Patch01) plus extra entries. */
function backupWith(...extra: RawEntry[]): RawEntry[] {
  return [manifestEntry(), { name: 'Patch01/patch.xml', data: PATCH_XML }, ...extra];
}

// ---- Helpers --------------------------------------------------------------------

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function snapshot(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rel of listFiles(dir)) {
    result[rel] = fs.readFileSync(path.join(dir, rel)).toString('base64');
  }
  return result;
}

describe('BackupManager', () => {
  let tmp: string;
  let sdDir: string;
  let targetDir: string;
  let zipPath: string;

  /** Writes a raw ZIP to disk and returns its path. */
  function writeZip(entries: RawEntry[]): string {
    fs.writeFileSync(zipPath, buildZip(entries));
    return zipPath;
  }

  /** Asserts that the archive is rejected by validation and by restore, without side effects. */
  async function expectRejected(entries: RawEntry[], message: RegExp) {
    const backupPath = writeZip(entries);
    const info = await BackupManager.validateBackup(backupPath);
    expect(info.valid).toBe(false);
    expect(info.error).toMatch(message);

    const before = snapshot(tmp);
    for (const mode of ['replace', 'merge'] as const) {
      await expect(
        BackupManager.restoreBackup({ backupPath, targetPath: targetDir, mode }),
      ).rejects.toThrow(message);
    }
    expect(snapshot(tmp)).toEqual(before);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jamman-backup-test-'));
    sdDir = path.join(tmp, 'sd');
    targetDir = path.join(tmp, 'target');
    zipPath = path.join(tmp, 'backup.zip');
    fs.mkdirSync(sdDir);
    fs.mkdirSync(targetDir);
    writeSyntheticSd(sdDir, true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('manifest schema', () => {
    it('treats a manifest without schemaVersion as legacy v1 and migrates it', () => {
      const legacy = { version: '1.0', appVersion: '0.1.0', patchCount: 1, patches: ['Patch01'] };
      expect(getManifestSchemaVersion(legacy)).toBe(1);
      const migrated = migrateManifest(legacy);
      expect(migrated.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
      expect(migrated.appVersion).toBe('0.1.0');
      expect(legacy).not.toHaveProperty('schemaVersion'); // input untouched
    });

    it('rejects malformed manifests and newer schemas', () => {
      expect(() => migrateManifest(null)).toThrow(/Invalid manifest/);
      expect(() => migrateManifest({ version: '1.0', patchCount: 0, patches: [] })).toThrow(
        /Invalid manifest structure/,
      );
      expect(() =>
        migrateManifest({ version: '1.0', patchCount: 1, patches: [1] as unknown as string[] }),
      ).toThrow(/Invalid manifest structure/);
      expect(() =>
        migrateManifest({ schemaVersion: 3, version: '1.0', patchCount: 1, patches: ['Patch01'] }),
      ).toThrow(/newer version/);
    });
  });

  describe('legacy backups (compatibility fixtures)', () => {
    it('validates both legacy fixtures', async () => {
      const full = await BackupManager.validateBackup(LEGACY_FULL);
      expect(full).toMatchObject({
        valid: true,
        manifest: {
          schemaVersion: BACKUP_SCHEMA_VERSION,
          version: '1.0',
          appVersion: '0.1.0',
          patchCount: 3,
          patches: ['Patch01', 'Patch02', 'Patch05'],
        },
      });
      const partial = await BackupManager.validateBackup(LEGACY_PARTIAL);
      expect(partial.valid).toBe(true);
      expect(partial.manifest?.patches).toEqual(['Patch02']);
    });

    it('restores the full legacy backup in replace mode', async () => {
      fs.mkdirSync(path.join(targetDir, 'Patch09'));
      fs.writeFileSync(path.join(targetDir, 'Patch09', 'patch.xml'), 'old');

      const result = await BackupManager.restoreBackup({
        backupPath: LEGACY_FULL,
        targetPath: targetDir,
        mode: 'replace',
      });

      expect(result).toEqual({ success: true, patchesRestored: 3 });
      const expected: Record<string, string> = {};
      for (const [rel, content] of Object.entries(syntheticSdFiles())) {
        expected[rel] = content.toString('base64');
      }
      expected['.jamman-playlists.json'] = Buffer.from(syntheticPlaylists()).toString('base64');
      expect(snapshot(targetDir)).toEqual(expected); // Patch09 removed, no staging left
    });

    it('restores the partial legacy backup in merge mode, renumbering on conflict', async () => {
      writeSyntheticSd(targetDir, false);

      const result = await BackupManager.restoreBackup({
        backupPath: LEGACY_PARTIAL,
        targetPath: targetDir,
        mode: 'merge',
      });

      expect(result.patchesRestored).toBe(1);
      const files = syntheticSdFiles();
      for (const rel of Object.keys(files).filter(r => r.startsWith('Patch02/'))) {
        const renumbered = rel.replace('Patch02/', 'Patch03/');
        expect(fs.readFileSync(path.join(targetDir, renumbered))).toEqual(files[rel]);
        expect(fs.readFileSync(path.join(targetDir, rel))).toEqual(files[rel]); // untouched
      }
      expect(fs.existsSync(path.join(targetDir, '.jamman-playlists.json'))).toBe(false);
    });
  });

  describe('create / validate / restore', () => {
    it('creates a backup with schemaVersion and the injected app version', async () => {
      await BackupManager.createBackup({
        basePath: sdDir,
        outputPath: zipPath,
        includePlaylist: true,
        appVersion: '9.8.7',
      });

      const zip = new AdmZip(zipPath);
      const manifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf-8'));
      expect(manifest).toMatchObject({
        schemaVersion: BACKUP_SCHEMA_VERSION,
        version: '1.0',
        appVersion: '9.8.7',
        patchCount: 3,
        patches: ['Patch01', 'Patch02', 'Patch05'],
      });
      expect(zip.getEntry('README.txt')!.getData().toString('utf-8')).toContain('9.8.7');
      expect(zip.getEntry('playlists.json')!.getData().toString('utf-8')).toBe(
        syntheticPlaylists(),
      );

      const info = await BackupManager.validateBackup(zipPath);
      expect(info.valid).toBe(true);
      expect(info.manifest?.appVersion).toBe('9.8.7');
    });

    it('does not hard-code an app version when none is given', async () => {
      await BackupManager.createBackup({ basePath: sdDir, outputPath: zipPath });
      const info = await BackupManager.validateBackup(zipPath);
      expect(info.manifest?.appVersion).toBe('unknown');
    });

    it('round-trips a selection of patches in replace mode', async () => {
      await BackupManager.createBackup({
        basePath: sdDir,
        outputPath: zipPath,
        patches: ['Patch01', 'Patch05'],
      });

      const result = await BackupManager.restoreBackup({
        backupPath: zipPath,
        targetPath: targetDir,
        mode: 'replace',
        patches: ['Patch05'],
      });

      expect(result.patchesRestored).toBe(1);
      const files = syntheticSdFiles();
      expect(listFiles(targetDir)).toEqual(
        Object.keys(files)
          .filter(r => r.startsWith('Patch05/'))
          .sort(),
      );
    });

    it('rejects unsafe patch names when creating a backup', async () => {
      await expect(
        BackupManager.createBackup({ basePath: sdDir, outputPath: zipPath, patches: ['../sd'] }),
      ).rejects.toThrow(/Invalid patch directory name/);
    });

    it('rejects restoring a patch that is not in the backup', async () => {
      await BackupManager.createBackup({ basePath: sdDir, outputPath: zipPath });
      await expect(
        BackupManager.restoreBackup({
          backupPath: zipPath,
          targetPath: targetDir,
          mode: 'merge',
          patches: ['../../etc'],
        }),
      ).rejects.toThrow(/not found in backup/);
      expect(fs.readdirSync(targetDir)).toEqual([]);
    });

    it('cleans up staging directories left by an interrupted restore', async () => {
      fs.mkdirSync(path.join(targetDir, '.jamman-restore-stale'));
      await BackupManager.restoreBackup({
        backupPath: LEGACY_PARTIAL,
        targetPath: targetDir,
        mode: 'merge',
      });
      expect(fs.readdirSync(targetDir)).toEqual(['Patch02']);
    });
  });

  describe('corrupt archives', () => {
    it('reports a missing file', async () => {
      const info = await BackupManager.validateBackup(path.join(tmp, 'nope.zip'));
      expect(info).toEqual({ valid: false, error: 'Backup file not found' });
    });

    it('rejects a file that is not a ZIP', async () => {
      fs.writeFileSync(zipPath, 'this is not a zip file at all');
      const info = await BackupManager.validateBackup(zipPath);
      expect(info.valid).toBe(false);
      expect(info.error).toMatch(/Failed to validate backup/);
      await expect(
        BackupManager.restoreBackup({ backupPath: zipPath, targetPath: targetDir, mode: 'merge' }),
      ).rejects.toThrow(/Failed to validate backup/);
    });

    it('rejects a truncated ZIP', async () => {
      const bytes = fs.readFileSync(LEGACY_FULL);
      fs.writeFileSync(zipPath, bytes.subarray(0, Math.floor(bytes.length / 2)));
      const info = await BackupManager.validateBackup(zipPath);
      expect(info.valid).toBe(false);
    });

    it('rejects a ZIP without manifest, with a broken manifest or a missing patch.xml', async () => {
      writeZip([{ name: 'Patch01/patch.xml', data: PATCH_XML }]);
      expect((await BackupManager.validateBackup(zipPath)).error).toMatch(
        /manifest.json not found/,
      );

      writeZip([{ name: 'manifest.json', data: Buffer.from('{not json') }]);
      expect((await BackupManager.validateBackup(zipPath)).error).toMatch(/Failed to validate/);

      writeZip([
        manifestEntry(['Patch01', 'Patch02']),
        { name: 'Patch01/patch.xml', data: PATCH_XML },
      ]);
      expect((await BackupManager.validateBackup(zipPath)).error).toMatch(
        /Missing patch.xml for Patch02/,
      );
    });

    it('rejects a manifest whose patch names escape the destination', async () => {
      await expectRejected(
        [manifestEntry(['Patch01/../../x']), { name: 'Patch01/patch.xml', data: PATCH_XML }],
        /Unsafe entry|Invalid patch directory name/,
      );
    });

    it('aborts the restore on a CRC mismatch without touching existing patches', async () => {
      writeSyntheticSd(targetDir, true);
      const before = snapshot(targetDir);
      writeZip(
        backupWith({ name: 'Patch01/PhraseA/phrase.wav', data: Buffer.alloc(1000, 7), crc: 1234 }),
      );

      await expect(
        BackupManager.restoreBackup({
          backupPath: zipPath,
          targetPath: targetDir,
          mode: 'replace',
        }),
      ).rejects.toThrow(/CRC|checksum/i);
      expect(snapshot(targetDir)).toEqual(before);
      expect(fs.readdirSync(targetDir).some(n => n.startsWith('.jamman-restore-'))).toBe(false);
    });
  });

  describe('malicious archives', () => {
    describe('Zip Slip', () => {
      const cases: Array<[string, string]> = [
        ['parent traversal at root', '../evil.txt'],
        ['parent traversal inside a patch', 'Patch01/../../evil.txt'],
        ['deep traversal inside a phrase', 'Patch01/PhraseA/../../../evil.txt'],
        ['absolute POSIX path', '/tmp/jamman-evil.txt'],
        ['Windows drive path', 'C:/evil.txt'],
        ['Windows drive path with backslashes', 'C:\\evil.txt'],
        ['Windows backslash traversal', 'Patch01\\..\\..\\evil.txt'],
        ['Windows UNC path', '\\\\server\\share\\evil.txt'],
      ];

      it.each(cases)('rejects %s', async (_label, name) => {
        await expectRejected(backupWith({ name, data: Buffer.from('pwned') }), /Unsafe entry/);
        expect(fs.existsSync(path.join(tmp, 'evil.txt'))).toBe(false);
        expect(fs.existsSync('/tmp/jamman-evil.txt')).toBe(false);
      });
    });

    it('rejects an entry whose declared size exceeds the per-entry limit (default limits)', async () => {
      // Declares 1 GiB + 1 bytes without actually containing them: rejected before any
      // decompression or allocation happens.
      await expectRejected(
        backupWith({
          name: 'Patch01/PhraseA/phrase.wav',
          data: Buffer.from('x'),
          method: 0,
          declaredSize: MAX_AUDIO_ENTRY_BYTES + 1,
        }),
        /too large/,
      );
    });

    it('rejects a compression bomb that exceeds the per-entry limit', async () => {
      const bomb = Buffer.alloc(4 * 1024 * 1024); // 4 MiB of zeros, ~4 KiB compressed
      const backupPath = writeZip(backupWith({ name: 'Patch01/PhraseA/phrase.wav', data: bomb }));
      const limits = { maxAudioEntryBytes: 1024 * 1024 };

      const info = await BackupManager.validateBackup(backupPath, limits);
      expect(info.valid).toBe(false);
      expect(info.error).toMatch(/too large/);
      await expect(
        BackupManager.restoreBackup({ backupPath, targetPath: targetDir, mode: 'merge', limits }),
      ).rejects.toThrow(/too large/);
      expect(fs.readdirSync(targetDir)).toEqual([]);
    });

    it('rejects a bomb whose header lies about its size', async () => {
      writeSyntheticSd(targetDir, true);
      const before = snapshot(targetDir);
      const bomb = Buffer.alloc(4 * 1024 * 1024);
      writeZip(backupWith({ name: 'Patch01/PhraseA/phrase.wav', data: bomb, declaredSize: 1000 }));

      // The header looks harmless, so only the real decompression can catch it.
      await expect(
        BackupManager.restoreBackup({
          backupPath: zipPath,
          targetPath: targetDir,
          mode: 'replace',
        }),
      ).rejects.toThrow();
      expect(snapshot(targetDir)).toEqual(before);
    });

    it('rejects an empty-declared entry carrying compressed data', async () => {
      await expectRejected(
        backupWith({
          name: 'Patch01/PhraseA/phrase.wav',
          data: Buffer.alloc(1024 * 1024),
          declaredSize: 0,
        }),
        /inconsistent sizes/,
      );
    });

    it('rejects a backup whose total uncompressed size exceeds the limit', async () => {
      const backupPath = writeZip(
        backupWith(
          { name: 'Patch01/PhraseA/phrase.wav', data: Buffer.alloc(600 * 1024) },
          { name: 'Patch01/PhraseB/phrase.wav', data: Buffer.alloc(600 * 1024) },
        ),
      );
      const limits = { maxAudioEntryBytes: 1024 * 1024, maxTotalBytes: 1024 * 1024 };
      const info = await BackupManager.validateBackup(backupPath, limits);
      expect(info.error).toMatch(/uncompressed size limit/);
      await expect(
        BackupManager.restoreBackup({ backupPath, targetPath: targetDir, mode: 'merge', limits }),
      ).rejects.toThrow(/uncompressed size limit/);
    });

    it('rejects a metadata entry larger than the metadata limit', async () => {
      const backupPath = writeZip(
        backupWith({ name: 'Patch01/PhraseA/phrase.xml', data: Buffer.alloc(2048, 0x20) }),
      );
      const info = await BackupManager.validateBackup(backupPath, { maxMetadataEntryBytes: 1024 });
      expect(info.error).toMatch(/too large/);
    });

    it('rejects too many entries', async () => {
      const backupPath = writeZip(
        backupWith(
          { name: 'Patch01/PhraseA/phrase.xml', data: PATCH_XML },
          { name: 'Patch01/PhraseB/phrase.xml', data: PATCH_XML },
        ),
      );
      const info = await BackupManager.validateBackup(backupPath, { maxEntries: 3 });
      expect(info.error).toMatch(/too many entries/);
    });

    it('rejects duplicate entries', async () => {
      await expectRejected(
        backupWith({ name: 'Patch01/patch.xml', data: Buffer.from('<second/>') }),
        /Duplicate entry/,
      );
    });

    it('rejects entries that only differ in case (same file on FAT32/APFS)', async () => {
      await expectRejected(
        backupWith({ name: 'patch01/PATCH.XML', data: Buffer.from('<second/>') }),
        /Duplicate entry/,
      );
    });

    it('rejects a file entry that is also used as a directory', async () => {
      await expectRejected(
        backupWith(
          { name: 'Patch01/PhraseA', data: Buffer.from('file') },
          { name: 'Patch01/PhraseA/phrase.xml', data: PATCH_XML },
        ),
        /conflicts with a file entry/,
      );
    });

    it('rejects symbolic links', async () => {
      await expectRejected(
        backupWith({
          name: 'Patch01/PhraseA/phrase.wav',
          data: Buffer.from('/etc/passwd'),
          unixMode: 0o120777,
        }),
        /Symbolic links/,
      );
    });

    it('rejects other special files (FIFO, devices)', async () => {
      await expectRejected(
        backupWith({
          name: 'Patch01/PhraseA/phrase.wav',
          data: Buffer.from(''),
          unixMode: 0o010644,
        }),
        /Unsupported file type/,
      );
    });

    it('does not preserve permissions or SUID/SGID bits', async () => {
      writeZip(
        backupWith({
          name: 'Patch01/PhraseA/phrase.wav',
          data: Buffer.from('RIFF....WAVE'),
          unixMode: 0o106777, // regular file, setuid + setgid, rwxrwxrwx
        }),
      );

      await BackupManager.restoreBackup({
        backupPath: zipPath,
        targetPath: targetDir,
        mode: 'merge',
      });

      const mode = fs.statSync(path.join(targetDir, 'Patch01/PhraseA/phrase.wav')).mode;
      expect(mode & 0o7000).toBe(0); // no setuid / setgid / sticky
      expect(mode & 0o111).toBe(0); // not executable
      expect(mode & 0o022).toBe(0); // not group/world writable
    });

    it('does not follow a symlink planted at the playlist path', async () => {
      const outside = path.join(tmp, 'outside.txt');
      fs.writeFileSync(outside, 'keep me');
      fs.symlinkSync(outside, path.join(targetDir, '.jamman-playlists.json'));
      writeZip(backupWith({ name: 'playlists.json', data: Buffer.from(syntheticPlaylists()) }));

      await BackupManager.restoreBackup({
        backupPath: zipPath,
        targetPath: targetDir,
        mode: 'merge',
      });

      expect(fs.readFileSync(outside, 'utf-8')).toBe('keep me');
      const playlistPath = path.join(targetDir, '.jamman-playlists.json');
      expect(fs.lstatSync(playlistPath).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(playlistPath, 'utf-8')).toBe(syntheticPlaylists());
    });
  });
});
