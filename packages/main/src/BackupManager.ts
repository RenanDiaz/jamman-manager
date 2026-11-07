import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import fse from 'fs-extra';

/**
 * Backup manifest schema version.
 *
 * - 1 (legacy): manifests without `schemaVersion` (app versions up to 0.1.0, which
 *   also hard-coded `appVersion: "0.1.0"`).
 * - 2: adds `schemaVersion` and records the real app version.
 */
export const BACKUP_SCHEMA_VERSION = 2;

/**
 * Value of the legacy `version` field. Kept unchanged so that older app versions,
 * which only check `version`, `patchCount` and `patches`, can still read new backups.
 */
export const BACKUP_FORMAT_VERSION = '1.0';

// ---- Restore limits -------------------------------------------------------------
// A JamMan Stereo loop is 44.1 kHz / 16-bit stereo WAV (~10 MB per minute), and the
// largest SD card the pedal supports is 32 GB. The limits leave headroom over that
// while refusing archives that would exhaust memory or fill the disk.

/** Largest uncompressed size accepted for a single `.wav` entry (~100 min of audio). */
export const MAX_AUDIO_ENTRY_BYTES = 1024 * 1024 * 1024; // 1 GiB
/** Largest uncompressed size accepted for any other entry (manifest, XML, JSON, README). */
export const MAX_METADATA_ENTRY_BYTES = 16 * 1024 * 1024; // 16 MiB
/** Largest total uncompressed size accepted for a whole backup. */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024 * 1024; // 32 GiB
/** Largest number of entries accepted in a backup (99 patches with room to spare). */
export const MAX_BACKUP_ENTRIES = 10_000;
/**
 * An entry that declares 0 uncompressed bytes cannot have more compressed data than an
 * empty deflate stream needs. adm-zip 0.5 only bounds inflation when the declared size
 * is greater than 0, so a larger payload here would be an unbounded decompression.
 */
const MAX_COMPRESSED_BYTES_FOR_EMPTY_ENTRY = 16;

export interface BackupLimits {
  maxAudioEntryBytes: number;
  maxMetadataEntryBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
}

export const DEFAULT_BACKUP_LIMITS: Readonly<BackupLimits> = Object.freeze({
  maxAudioEntryBytes: MAX_AUDIO_ENTRY_BYTES,
  maxMetadataEntryBytes: MAX_METADATA_ENTRY_BYTES,
  maxTotalBytes: MAX_TOTAL_UNCOMPRESSED_BYTES,
  maxEntries: MAX_BACKUP_ENTRIES,
});

const STAGING_PREFIX = '.jamman-restore-';
const PLAYLIST_FILENAME = '.jamman-playlists.json';
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATED = 8;
const ZIP_FLAG_ENCRYPTED = 0x0001;

export interface BackupManifest {
  schemaVersion: number;
  version: string;
  appVersion: string;
  patchCount: number;
  createdAt: string;
  patches: string[];
  playlists?: unknown;
}

export interface BackupOptions {
  basePath: string;
  outputPath: string;
  patches?: string[]; // If not provided, backup all patches
  includePlaylist?: boolean;
  /** Version of the app creating the backup (`app.getVersion()` in production). */
  appVersion?: string;
}

export interface RestoreOptions {
  backupPath: string;
  targetPath: string;
  mode: 'replace' | 'merge';
  patches?: string[]; // If not provided, restore all patches
  /** Overrides for the extraction limits; mainly for tests. */
  limits?: Partial<BackupLimits>;
}

export interface BackupInfo {
  valid: boolean;
  manifest?: BackupManifest;
  error?: string;
}

/** Raised when a backup archive is malformed or unsafe to extract. */
export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the schema version of a parsed manifest; missing means legacy v1. */
export function getManifestSchemaVersion(raw: unknown): number {
  if (!isObject(raw)) {
    throw new BackupValidationError('Invalid manifest structure');
  }
  if (raw.schemaVersion === undefined) {
    return 1;
  }
  if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion)) {
    throw new BackupValidationError('Invalid manifest: schemaVersion must be an integer');
  }
  return raw.schemaVersion;
}

/**
 * Validates a parsed `manifest.json` and migrates it to the current schema.
 * Pure: it neither reads nor writes anything.
 *
 * @throws BackupValidationError if the manifest is malformed or newer than supported.
 */
export function migrateManifest(raw: unknown): BackupManifest {
  const schemaVersion = getManifestSchemaVersion(raw);
  const obj = raw as JsonObject;

  if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new BackupValidationError(
      `Backup was created by a newer version of JamMan Manager (schemaVersion ${schemaVersion})`,
    );
  }
  if (schemaVersion < 1) {
    throw new BackupValidationError(`Invalid manifest schemaVersion: ${schemaVersion}`);
  }

  // Fields required by every schema version so far (the v1 check was
  // `!version || !patchCount || !patches`).
  if (
    typeof obj.version !== 'string' ||
    !obj.version ||
    typeof obj.patchCount !== 'number' ||
    !obj.patchCount ||
    !Array.isArray(obj.patches) ||
    !obj.patches.every(p => typeof p === 'string')
  ) {
    throw new BackupValidationError('Invalid manifest structure');
  }

  // v1 -> v2: only `schemaVersion` is new. Future migrations chain here.
  return {
    ...obj,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    version: obj.version,
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : 'unknown',
    patchCount: obj.patchCount,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : '',
    patches: obj.patches as string[],
  };
}

/** A patch directory name is a single path segment starting with "Patch". */
export function isSafePatchDirName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length <= 255 &&
    /^Patch[^/\\\0]*$/.test(name) &&
    name.trim() === name
  );
}

/**
 * Checks that a ZIP entry name is a plain relative path: no absolute or drive-letter
 * paths, no backslashes (Windows separators), no `.`/`..`/empty segments, no NUL.
 * Returns the reason when it is not.
 */
function unsafeEntryNameReason(name: string): string | null {
  if (name.length === 0) return 'empty name';
  if (name.includes('\0')) return 'NUL byte in name';
  if (name.includes('\\')) return 'backslash in name';
  if (name.startsWith('/')) return 'absolute path';
  if (/^[a-zA-Z]:/.test(name)) return 'drive-letter path';
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return `invalid path segment "${segment}"`;
    }
  }
  return null;
}

/** Key used to detect entries that would land on the same file on a case-insensitive FS. */
function collisionKey(name: string): string {
  const trimmed = name.endsWith('/') ? name.slice(0, -1) : name;
  return trimmed.normalize('NFC').toLowerCase();
}

interface InspectedEntry {
  entry: AdmZip.IZipEntry;
  name: string;
  isDirectory: boolean;
  declaredSize: number;
  maxBytes: number;
}

/**
 * Tracks the bytes actually produced while extracting, independently of what the
 * ZIP headers declare.
 */
class ExtractionBudget {
  private used = 0;
  constructor(private readonly limits: BackupLimits) {}

  read(item: InspectedEntry): Buffer {
    const data = item.entry.getData();
    if (data.length !== item.declaredSize || data.length > item.maxBytes) {
      throw new BackupValidationError(
        `Entry "${item.name}" decompressed to an unexpected size (${data.length} bytes)`,
      );
    }
    this.used += data.length;
    if (this.used > this.limits.maxTotalBytes) {
      throw new BackupValidationError(
        `Backup exceeds the uncompressed size limit of ${this.limits.maxTotalBytes} bytes`,
      );
    }
    return data;
  }
}

/** Resolves `relative` under `root`, refusing anything that would land outside it. */
function resolveInside(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (!resolved.startsWith(resolvedRoot + path.sep)) {
    throw new BackupValidationError(`Entry path escapes the destination: ${relative}`);
  }
  return resolved;
}

function resolveLimits(overrides?: Partial<BackupLimits>): BackupLimits {
  return { ...DEFAULT_BACKUP_LIMITS, ...overrides };
}

function listPatchDirs(basePath: string): string[] {
  return fs.readdirSync(basePath).filter(file => {
    const fullPath = path.join(basePath, file);
    return (
      fs.statSync(fullPath).isDirectory() &&
      file.startsWith('Patch') &&
      fs.existsSync(path.join(fullPath, 'patch.xml'))
    );
  });
}

export class BackupManager {
  /**
   * Creates a backup of patches in ZIP format
   */
  static async createBackup(options: BackupOptions): Promise<string> {
    const {
      basePath,
      outputPath,
      patches,
      includePlaylist = false,
      appVersion = 'unknown',
    } = options;

    // Validate base path exists
    if (!fs.existsSync(basePath)) {
      throw new Error(`Base path does not exist: ${basePath}`);
    }

    // Get all patches to backup
    const allPatches = listPatchDirs(basePath);

    const patchesToBackup = patches && patches.length > 0 ? patches : allPatches;

    if (patchesToBackup.length === 0) {
      throw new Error('No patches found to backup');
    }

    const unsafe = patchesToBackup.find(p => !isSafePatchDirName(p));
    if (unsafe !== undefined) {
      throw new Error(`Invalid patch directory name: ${unsafe}`);
    }

    // Create ZIP archive
    const zip = new AdmZip();

    // Create manifest
    const manifest: BackupManifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      version: BACKUP_FORMAT_VERSION,
      appVersion,
      patchCount: patchesToBackup.length,
      createdAt: new Date().toISOString(),
      patches: patchesToBackup,
      playlists: null,
    };

    // Add manifest.json
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

    // Add README.txt
    const readme = this.generateReadme(manifest);
    zip.addFile('README.txt', Buffer.from(readme, 'utf-8'));

    // Add each patch directory
    for (const patchDir of patchesToBackup) {
      const patchPath = path.join(basePath, patchDir);
      if (!fs.existsSync(patchPath)) {
        console.warn(`Patch directory not found, skipping: ${patchDir}`);
        continue;
      }

      // Add patch.xml
      const patchXmlPath = path.join(patchPath, 'patch.xml');
      if (fs.existsSync(patchXmlPath)) {
        const patchXmlContent = fs.readFileSync(patchXmlPath);
        zip.addFile(`${patchDir}/patch.xml`, patchXmlContent);
      }

      // Add all phrase directories
      const phraseDirs = fs.readdirSync(patchPath).filter(file => {
        const fullPath = path.join(patchPath, file);
        return fs.statSync(fullPath).isDirectory() && file.startsWith('Phrase');
      });

      for (const phraseDir of phraseDirs) {
        const phrasePath = path.join(patchPath, phraseDir);

        // Add phrase.xml
        const phraseXmlPath = path.join(phrasePath, 'phrase.xml');
        if (fs.existsSync(phraseXmlPath)) {
          const phraseXmlContent = fs.readFileSync(phraseXmlPath);
          zip.addFile(`${patchDir}/${phraseDir}/phrase.xml`, phraseXmlContent);
        }

        // Add phrase.wav
        const phraseWavPath = path.join(phrasePath, 'phrase.wav');
        if (fs.existsSync(phraseWavPath)) {
          const phraseWavContent = fs.readFileSync(phraseWavPath);
          zip.addFile(`${patchDir}/${phraseDir}/phrase.wav`, phraseWavContent);
        }
      }
    }

    // Add playlists.json if requested and exists
    if (includePlaylist) {
      const playlistPath = path.join(basePath, PLAYLIST_FILENAME);
      if (fs.existsSync(playlistPath)) {
        const playlistContent = fs.readFileSync(playlistPath);
        zip.addFile('playlists.json', playlistContent);
      }
    }

    // Write ZIP to output path
    zip.writeZip(outputPath);

    return outputPath;
  }

  /**
   * Checks every entry of the archive before anything is extracted: entry count,
   * names (Zip Slip), duplicates, file types (symlinks and other special files),
   * encryption, compression method and declared sizes. The real decompressed size of
   * each entry is checked again while reading it (see ExtractionBudget).
   */
  private static inspectArchive(zip: AdmZip, limits: BackupLimits): InspectedEntry[] {
    const entries = zip.getEntries();
    if (entries.length > limits.maxEntries) {
      throw new BackupValidationError(
        `Backup has too many entries (${entries.length}, limit ${limits.maxEntries})`,
      );
    }

    const inspected: InspectedEntry[] = [];
    const seen = new Set<string>();
    const fileKeys = new Set<string>();
    let declaredTotal = 0;

    for (const entry of entries) {
      const name = entry.entryName;
      const reason = unsafeEntryNameReason(name);
      if (reason) {
        throw new BackupValidationError(`Unsafe entry "${name}": ${reason}`);
      }

      const key = collisionKey(name);
      if (seen.has(key)) {
        throw new BackupValidationError(`Duplicate entry in backup: "${name}"`);
      }
      seen.add(key);

      const header = entry.header;
      const isDirectory = name.endsWith('/');
      const fileType = (header.attr >>> 16) & 0xffff & S_IFMT;
      if (fileType === S_IFLNK) {
        throw new BackupValidationError(`Symbolic links are not allowed in backups: "${name}"`);
      }
      if (fileType !== 0 && fileType !== (isDirectory ? S_IFDIR : S_IFREG)) {
        throw new BackupValidationError(`Unsupported file type for entry "${name}"`);
      }
      if ((header.flags & ZIP_FLAG_ENCRYPTED) !== 0) {
        throw new BackupValidationError(`Encrypted entries are not supported: "${name}"`);
      }
      if (header.method !== ZIP_METHOD_STORED && header.method !== ZIP_METHOD_DEFLATED) {
        throw new BackupValidationError(`Unsupported compression method for entry "${name}"`);
      }

      const declaredSize = isDirectory ? 0 : header.size;
      const maxBytes = name.toLowerCase().endsWith('.wav')
        ? limits.maxAudioEntryBytes
        : limits.maxMetadataEntryBytes;
      if (declaredSize > maxBytes) {
        throw new BackupValidationError(
          `Entry "${name}" is too large (${declaredSize} bytes, limit ${maxBytes})`,
        );
      }
      if (
        declaredSize === 0 &&
        header.compressedSize > (isDirectory ? 0 : MAX_COMPRESSED_BYTES_FOR_EMPTY_ENTRY)
      ) {
        throw new BackupValidationError(`Entry "${name}" has inconsistent sizes`);
      }
      declaredTotal += declaredSize;
      if (declaredTotal > limits.maxTotalBytes) {
        throw new BackupValidationError(
          `Backup exceeds the uncompressed size limit of ${limits.maxTotalBytes} bytes`,
        );
      }

      if (!isDirectory) {
        fileKeys.add(key);
      }
      inspected.push({ entry, name, isDirectory, declaredSize, maxBytes });
    }

    // A file must not also be used as a directory by another entry ("a" and "a/b").
    for (const item of inspected) {
      const parts = collisionKey(item.name).split('/');
      for (let i = 1; i < parts.length; i++) {
        if (fileKeys.has(parts.slice(0, i).join('/'))) {
          throw new BackupValidationError(`Entry "${item.name}" conflicts with a file entry`);
        }
      }
    }

    return inspected;
  }

  /** Opens and fully validates a backup. Throws BackupValidationError on any problem. */
  private static openBackup(
    backupPath: string,
    limits: BackupLimits,
  ): { entries: InspectedEntry[]; manifest: BackupManifest; budget: ExtractionBudget } {
    if (!fs.existsSync(backupPath)) {
      throw new BackupValidationError('Backup file not found');
    }

    const zip = new AdmZip(backupPath);
    const entries = this.inspectArchive(zip, limits);
    const budget = new ExtractionBudget(limits);

    // Check for manifest.json
    const manifestEntry = entries.find(e => e.name === 'manifest.json');
    if (!manifestEntry) {
      throw new BackupValidationError('Invalid backup: manifest.json not found');
    }
    const manifest = migrateManifest(JSON.parse(budget.read(manifestEntry).toString('utf-8')));

    const unsafe = manifest.patches.find(p => !isSafePatchDirName(p));
    if (unsafe !== undefined) {
      throw new BackupValidationError(`Invalid patch directory name in manifest: ${unsafe}`);
    }

    // Verify patches exist in ZIP
    for (const patchDir of manifest.patches) {
      if (!entries.some(e => e.name === `${patchDir}/patch.xml`)) {
        throw new BackupValidationError(`Missing patch.xml for ${patchDir}`);
      }
    }

    return { entries, manifest, budget };
  }

  /**
   * Validates and reads a backup file.
   *
   * Checks the archive structure, every entry name and declared size, and the
   * manifest. Entry contents other than the manifest are not decompressed here;
   * `restoreBackup` verifies their real size and CRC before touching the SD card.
   */
  static async validateBackup(
    backupPath: string,
    limits?: Partial<BackupLimits>,
  ): Promise<BackupInfo> {
    try {
      const { manifest } = this.openBackup(backupPath, resolveLimits(limits));
      return { valid: true, manifest };
    } catch (error) {
      if (error instanceof BackupValidationError) {
        return { valid: false, error: error.message };
      }
      return {
        valid: false,
        error: `Failed to validate backup: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Restores a backup to the target path.
   *
   * Everything is first extracted into a staging directory inside `targetPath`, so a
   * malformed or malicious archive is rejected before any existing patch is touched.
   * Only then are existing patches removed (replace mode) and the staged ones moved in.
   * Files are written with fixed permissions; modes stored in the ZIP are ignored.
   */
  static async restoreBackup(
    options: RestoreOptions,
  ): Promise<{ success: boolean; patchesRestored: number }> {
    const { backupPath, targetPath, mode, patches } = options;
    const limits = resolveLimits(options.limits);

    // Validate backup
    let opened: ReturnType<typeof BackupManager.openBackup>;
    try {
      opened = this.openBackup(backupPath, limits);
    } catch (error) {
      if (error instanceof BackupValidationError) throw error;
      throw new Error(
        `Failed to validate backup: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error },
      );
    }
    const { entries, manifest, budget } = opened;

    // Determine which patches to restore
    const patchesToRestore = patches && patches.length > 0 ? patches : manifest.patches;
    for (const patchDir of patchesToRestore) {
      if (!isSafePatchDirName(patchDir) || !manifest.patches.includes(patchDir)) {
        throw new BackupValidationError(`Patch not found in backup: ${patchDir}`);
      }
    }

    // Ensure target path exists
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
    this.removeStaleStagingDirs(targetPath);

    // Decide the final directory name of each patch. In merge mode a patch whose
    // directory already exists goes to the next free number.
    const reserved = new Set<string>();
    const isTaken = (dir: string) => reserved.has(dir) || fs.existsSync(path.join(targetPath, dir));
    const plan = patchesToRestore.map(patchDir => {
      let targetPatchDir = patchDir;
      if (mode === 'merge' && isTaken(patchDir)) {
        const patchNumber = parseInt(patchDir.replace('Patch', ''), 10);
        let nextNumber = patchNumber + 1;
        while (isTaken(`Patch${String(nextNumber).padStart(2, '0')}`)) {
          nextNumber++;
        }
        targetPatchDir = `Patch${String(nextNumber).padStart(2, '0')}`;
        console.log(`Patch ${patchDir} already exists, restoring as ${targetPatchDir}`);
      }
      reserved.add(targetPatchDir);
      return { patchDir, targetPatchDir };
    });

    const stagingDir = fs.mkdtempSync(path.join(targetPath, STAGING_PREFIX));
    try {
      // 1. Extract into staging. Any error aborts before the SD card is modified.
      for (const { patchDir, targetPatchDir } of plan) {
        for (const item of entries) {
          if (item.isDirectory || !item.name.startsWith(`${patchDir}/`)) continue;
          const relative = `${targetPatchDir}/${item.name.slice(patchDir.length + 1)}`;
          this.writeStagedFile(stagingDir, relative, budget.read(item));
        }
      }

      const playlistItem = entries.find(e => e.name === 'playlists.json');
      let stagedPlaylist: string | null = null;
      if (playlistItem) {
        const content = budget.read(playlistItem);
        try {
          JSON.parse(content.toString('utf-8'));
          stagedPlaylist = this.writeStagedFile(stagingDir, PLAYLIST_FILENAME, content);
        } catch {
          console.warn('Skipping playlists.json from backup: invalid JSON');
        }
      }

      // 2. Swap the staged patches in.
      this.commitStaged(targetPath, stagingDir, plan, mode, stagedPlaylist);

      return { success: true, patchesRestored: plan.length };
    } finally {
      fse.removeSync(stagingDir);
    }
  }

  /** Writes a new file under the staging directory with fixed permissions. */
  private static writeStagedFile(stagingDir: string, relative: string, data: Buffer): string {
    const outputPath = resolveInside(stagingDir, relative);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: DIR_MODE });
    // 'wx' fails if anything (including a symlink) already exists at that path.
    fs.writeFileSync(outputPath, data, { mode: FILE_MODE, flag: 'wx' });
    return outputPath;
  }

  /**
   * Moves staged patches into place. In replace mode the existing patches are first
   * moved aside into the staging directory (deleted with it afterwards). If a move
   * fails, the moves already done are undone.
   */
  private static commitStaged(
    targetPath: string,
    stagingDir: string,
    plan: { targetPatchDir: string }[],
    mode: 'replace' | 'merge',
    stagedPlaylist: string | null,
  ): void {
    const undo: Array<() => void> = [];
    const asideDir = path.join(stagingDir, '.replaced');
    const moveAside = (dirName: string) => {
      const from = path.join(targetPath, dirName);
      const to = path.join(asideDir, dirName);
      fs.renameSync(from, to);
      undo.push(() => fs.renameSync(to, from));
    };

    try {
      if (mode === 'replace') {
        fs.mkdirSync(asideDir);
        for (const patchDir of listPatchDirs(targetPath)) {
          moveAside(patchDir);
        }
      }

      for (const { targetPatchDir } of plan) {
        const from = path.join(stagingDir, targetPatchDir);
        const to = path.join(targetPath, targetPatchDir);
        if (fs.existsSync(to)) {
          // Only possible in replace mode, for a folder without patch.xml that
          // listPatchDirs skipped: it is being replaced too.
          if (mode !== 'replace') {
            throw new Error(`Cannot restore ${targetPatchDir}: path already exists`);
          }
          moveAside(targetPatchDir);
        }
        fs.renameSync(from, to);
        undo.push(() => fs.renameSync(to, from));
      }

      if (stagedPlaylist) {
        // rename() replaces the destination itself and never follows a symlink there.
        fs.renameSync(stagedPlaylist, path.join(targetPath, PLAYLIST_FILENAME));
      }
    } catch (error) {
      for (const step of undo.reverse()) {
        try {
          step();
        } catch (rollbackError) {
          console.error('Failed to roll back restore step:', rollbackError);
        }
      }
      throw error;
    }
  }

  /** Removes staging directories left behind by an interrupted restore. */
  private static removeStaleStagingDirs(targetPath: string): void {
    for (const name of fs.readdirSync(targetPath)) {
      if (name.startsWith(STAGING_PREFIX)) {
        fse.removeSync(path.join(targetPath, name));
      }
    }
  }

  /**
   * Generates README content for the backup
   */
  private static generateReadme(manifest: BackupManifest): string {
    return `JamMan Manager Backup
=====================

Backup Information:
- Created: ${new Date(manifest.createdAt).toLocaleString()}
- Patch Count: ${manifest.patchCount}
- App Version: ${manifest.appVersion}
- Backup Format Version: ${manifest.version} (schema ${manifest.schemaVersion})

Structure:
----------
This backup contains JamMan patches in the original directory structure:

/
├── README.txt (this file)
├── manifest.json (backup metadata)
├── playlists.json (optional: playlist data)
├── Patch01/
│   ├── patch.xml (patch configuration)
│   └── PhraseA/
│       ├── phrase.xml (phrase configuration)
│       └── phrase.wav (audio file)
├── Patch02/
...

Patches included in this backup:
${manifest.patches.map(p => `  - ${p}`).join('\n')}

Restoring:
----------
Use JamMan Manager to restore this backup:
1. Open JamMan Manager
2. Click "Restore Backup"
3. Select this ZIP file
4. Choose restore mode:
   - Replace All: Removes existing patches and restores backup
   - Merge: Adds backup patches to existing ones (renumbers if needed)

Manual Extraction:
------------------
You can manually extract this ZIP file to access individual patches.
Each patch folder can be copied directly to your JamMan SD card.

Generated by JamMan Manager
https://github.com/yourusername/jamman-manager
`;
  }
}
