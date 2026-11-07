/**
 * Patch folders on the SD: read (with a cache), create, update, delete,
 * batch delete, reorder, and the folder size.
 *
 * Every write goes through the operation queue and holds a lock on the patch
 * folder (or the whole folder for a reorder), and rolls back on failure.
 *
 * Channels: `folder:getSize`, `patches:read|create|update|delete|deleteBatch|reorder`.
 *
 * @module ipc/patches
 */
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IpcHandlers, PatchRecord, PhraseForm, PhraseRecord } from '@app/preload/ipc-contract';
import { OperationPriority } from '../OperationQueue.js';
import { PathValidator } from '../PathValidator.js';
import { SecureXMLParser } from '../SecureXMLParser.js';
import type { IpcDeps } from './deps.js';
import { errorMessage, ipcError } from './errors.js';

export type PatchChannel =
  | 'folder:getSize'
  | 'patches:read'
  | 'patches:create'
  | 'patches:update'
  | 'patches:delete'
  | 'patches:deleteBatch'
  | 'patches:reorder';

/** How long a deleted patch is kept aside (`__deleted_*`) before it is removed for good. */
export const DELETE_SAFETY_WINDOW_MS = 5000;

/** Temporary folders created by delete (`__deleted_`), update (`__backup_`) and reorder (`__tmp_`). */
const INTERNAL_DIR_RE = /^__(deleted|backup|tmp)_/;
const PHRASE_DIR_RE = /^Phrase[A-Z]$/;

type CacheEntry = {
  patches: PatchRecord[];
  /** mtime of every patch.xml and phrase.xml when the patches were parsed. */
  modTimes: Map<string, number>;
};

/**
 * Parsed patches per folder. An entry is used only while the mtimes of every
 * patch.xml and phrase.xml still match; writers invalidate it explicitly.
 */
export class PatchCache {
  readonly #entries = new Map<string, CacheEntry>();

  get(folder: string): CacheEntry | undefined {
    return this.#entries.get(folder);
  }

  set(folder: string, entry: CacheEntry): void {
    this.#entries.set(folder, entry);
  }

  invalidate(folder: string): void {
    this.#entries.delete(folder);
  }
}

type PatchXmlFields = {
  patchName: string;
  rhythmType: string;
  stopMode: string;
  settingsVersion: number;
  id: string;
  originId: string;
};

function buildPatchXml(p: PatchXmlFields): string {
  return `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManStereo" version="1">
  <PatchName>${p.patchName}</PatchName>
  <RhythmType>${p.rhythmType}</RhythmType>
  <StopMode>${p.stopMode}</StopMode>
  <SettingsVersion>${p.settingsVersion}</SettingsVersion>
  <ID>${p.id}</ID>
  <OriginID>${p.originId}</OriginID>
  <Metadata/>
</JamManPatch>`.trim();
}

function buildPhraseXml(phrase: PhraseForm, id: string, originId: string): string {
  return `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPhrase xmlns="http://schemas.digitech.com/JamMan/Phrase" version="1">
  <BeatsPerMinute>${phrase.beatsPerMinute}</BeatsPerMinute>
  <BeatsPerMeasure>${phrase.beatsPerMeasure}</BeatsPerMeasure>
  <BpmValidated>0</BpmValidated>
  <IsLoop>${phrase.isLoop ? 1 : 0}</IsLoop>
  <IsReversed>${phrase.isReversed ? 1 : 0}</IsReversed>
  <SettingsVersion>1</SettingsVersion>
  <AudioVersion>1</AudioVersion>
  <ID>${id}</ID>
  <OriginID>${originId}</OriginID>
  <Metadata/>
</JamManPhrase>`.trim();
}

export function createPatchHandlers({
  fs,
  fse,
  log,
  folderAccess,
  operationQueue,
  lockManager,
  patchCache,
}: Pick<
  IpcDeps,
  'fs' | 'fse' | 'log' | 'folderAccess' | 'operationQueue' | 'lockManager' | 'patchCache'
>): IpcHandlers<PatchChannel> {
  /** Phrase folders of a patch that contain a phrase.xml. */
  const listPhraseDirs = (patchDirPath: string) =>
    fs
      .readdirSync(patchDirPath)
      .filter(
        subdir =>
          PHRASE_DIR_RE.test(subdir) &&
          fs.existsSync(path.join(patchDirPath, subdir, 'phrase.xml')),
      );

  /** Recursively calculates the total size of a directory. */
  const calculateFolderSize = async (dirPath: string): Promise<number> => {
    let totalSize = 0;

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          totalSize += await calculateFolderSize(fullPath);
        } else if (entry.isFile()) {
          const stats = await fs.promises.stat(fullPath);
          totalSize += stats.size;
        }
      }
    } catch (error) {
      log.warn(`Error reading directory ${dirPath}:`, error);
      // Continue even if a subdirectory fails
    }

    return totalSize;
  };

  /** Parses one patch folder, or returns null (and logs) when it cannot be read. */
  const readPatch = async (jammanPath: string, dir: string): Promise<PatchRecord | null> => {
    try {
      const patchDirPath = path.join(jammanPath, dir);
      const patchXmlPath = path.join(patchDirPath, 'patch.xml');

      if (!fs.existsSync(patchXmlPath)) {
        log.warn(`Skipping ${dir}: patch.xml not found`);
        return null;
      }

      const patchXml = fs.readFileSync(patchXmlPath, 'utf-8');
      // Security: Use hardened XML parser to prevent XXE attacks
      const patchData = await SecureXMLParser.parsePatchXML(patchXml);

      const phrases = await Promise.all(
        listPhraseDirs(patchDirPath).map(async (phraseDir): Promise<PhraseRecord | null> => {
          try {
            const phraseXmlPath = path.join(patchDirPath, phraseDir, 'phrase.xml');
            const phraseWavPath = path.join(patchDirPath, phraseDir, 'phrase.wav');

            const phraseXml = fs.readFileSync(phraseXmlPath, 'utf-8');
            // Security: Use hardened XML parser to prevent XXE attacks
            const phraseData = await SecureXMLParser.parsePhraseXML(phraseXml);
            return { dir: phraseDir, data: phraseData, wavPath: phraseWavPath };
          } catch (error) {
            log.error(`Error reading phrase ${phraseDir}:`, error);
            return null;
          }
        }),
      );

      return {
        dir,
        data: patchData,
        phrases: phrases.filter((p): p is PhraseRecord => p !== null),
      };
    } catch (error) {
      log.error(`Error reading patch ${dir}:`, error);
      return null;
    }
  };

  /** Removes the parked `__deleted_*` folders once the safety window is over. */
  const removeLater = (backupDirs: string[], label: (dir: string) => string) => {
    setTimeout(() => {
      for (const backupDir of backupDirs) {
        if (fs.existsSync(backupDir)) {
          fse.removeSync(backupDir);
          log.info(`Permanently deleted patch backup: ${label(backupDir)}`);
        }
      }
    }, DELETE_SAFETY_WINDOW_MS);
  };

  return {
    'folder:getSize': async folderPath => {
      try {
        // Security: Validate folder path
        if (!folderPath || typeof folderPath !== 'string') {
          throw new Error('Invalid folder path');
        }
        folderAccess.assertRoot(folderPath);

        if (!PathValidator.pathExists(folderPath, 'directory')) {
          throw new Error('Folder does not exist');
        }

        const sizeBytes = await calculateFolderSize(folderPath);
        log.info(`Folder size for ${folderPath}: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);

        return {
          sizeBytes,
          sizeMB: sizeBytes / 1024 / 1024,
          sizeGB: sizeBytes / 1024 / 1024 / 1024,
        };
      } catch (error) {
        throw ipcError(
          log,
          'Error calculating folder size:',
          'Failed to calculate folder size',
          error,
        );
      }
    },

    'patches:read': async folderPath => {
      try {
        // Security: Validate folder path
        if (!folderPath || typeof folderPath !== 'string') {
          throw new Error('Invalid folder path');
        }
        // Security: only the folder approved through the dialog (also after a restart)
        folderAccess.assertRoot(folderPath);

        if (!PathValidator.pathExists(folderPath, 'directory')) {
          throw new Error('Folder does not exist or is not a directory');
        }

        if (!PathValidator.isValidJamManFolder(folderPath)) {
          log.warn('Folder does not appear to be a valid JamMan folder:', folderPath);
          // Don't throw error - user might be setting up a new folder
        }

        const jammanPath = path.resolve(folderPath);

        const patchDirs = fs.readdirSync(jammanPath).filter(d => {
          // Folders the app itself parks during delete/update/reorder are not patches.
          if (INTERNAL_DIR_RE.test(d)) {
            return false;
          }
          try {
            return fs.statSync(path.join(jammanPath, d)).isDirectory();
          } catch {
            return false; // Skip files that can't be accessed
          }
        });

        // Modification times of every patch and phrase XML
        const currentModTimes = new Map<string, number>();
        for (const dir of patchDirs) {
          const patchXmlPath = path.join(jammanPath, dir, 'patch.xml');
          if (fs.existsSync(patchXmlPath)) {
            currentModTimes.set(patchXmlPath, fs.statSync(patchXmlPath).mtimeMs);

            const patchDirPath = path.join(jammanPath, dir);
            for (const phraseDir of listPhraseDirs(patchDirPath)) {
              const phraseXmlPath = path.join(patchDirPath, phraseDir, 'phrase.xml');
              if (fs.existsSync(phraseXmlPath)) {
                currentModTimes.set(phraseXmlPath, fs.statSync(phraseXmlPath).mtimeMs);
              }
            }
          }
        }

        const cached = patchCache.get(folderPath);
        if (
          cached &&
          cached.modTimes.size === currentModTimes.size &&
          [...currentModTimes].every(([file, mtime]) => cached.modTimes.get(file) === mtime)
        ) {
          log.info(`Using cached patches for ${folderPath}`);
          return cached.patches;
        }

        // Cache miss or invalid - parse patches
        log.info(`Parsing patches for ${folderPath}`);
        const patches = (
          await Promise.all(patchDirs.map(dir => readPatch(jammanPath, dir)))
        ).filter((p): p is PatchRecord => p !== null);

        patchCache.set(folderPath, { patches, modTimes: currentModTimes });
        return patches;
      } catch (error) {
        throw ipcError(
          log,
          'Error reading patches from folder:',
          'Failed to read patches from folder',
          error,
        );
      }
    },

    'patches:create': async data => {
      const { basePath, directory, patchName, rhythmType, stopMode, phrases } = data;

      // Security: Validate base path
      if (!basePath || typeof basePath !== 'string') {
        throw new Error('Invalid base path');
      }
      folderAccess.assertRoot(basePath);

      // Security: Validate directory name format
      if (!PathValidator.isValidPatchDir(directory)) {
        throw new Error(`Invalid patch directory name: ${directory}`);
      }

      // Security: source WAVs must come from the approved folder or the file dialog
      for (const phrase of phrases ?? []) {
        folderAccess.assertReadableFile(phrase.wavPath, ['.wav']);
      }

      // Security: Validate patch directory is within base path
      const patchDir = PathValidator.safeJoin(basePath, directory);

      return operationQueue.enqueue(
        'patches:create',
        `Create patch: ${directory}`,
        () =>
          // Lock: no concurrent operations on the same patch
          lockManager.withLock(patchDir, async () => {
            // Outside the try: the rollback below removes patchDir, which here
            // is someone else's patch.
            if (fs.existsSync(patchDir)) {
              throw new Error(
                `Failed to create patch: Patch directory ${directory} already exists`,
              );
            }

            try {
              fse.ensureDirSync(patchDir);

              // 1. Write patch.xml
              const patchXml = buildPatchXml({
                patchName,
                rhythmType,
                stopMode,
                settingsVersion: 1,
                id: randomUUID(),
                originId: randomUUID(),
              });
              fs.writeFileSync(path.join(patchDir, 'patch.xml'), patchXml, 'utf-8');

              // 2. Write each phrase folder, WAV and XML
              for (const phrase of phrases) {
                const phraseDir = path.join(patchDir, phrase.name);
                fse.ensureDirSync(phraseDir);

                const phraseId = randomUUID();
                const originId = randomUUID();

                const wavDest = path.join(phraseDir, 'phrase.wav');
                if (!fs.existsSync(phrase.wavPath)) {
                  throw new Error(`Source WAV file not found: ${phrase.wavPath}`);
                }
                fs.copyFileSync(phrase.wavPath, wavDest);

                fs.writeFileSync(
                  path.join(phraseDir, 'phrase.xml'),
                  buildPhraseXml(phrase, phraseId, originId),
                  'utf-8',
                );
              }

              log.info(`Successfully created patch: ${directory}`);
              patchCache.invalidate(basePath);
              return true as const;
            } catch (error) {
              log.error(`Error creating patch ${directory}:`, error);

              // Rollback: Remove the partially created directory
              if (fs.existsSync(patchDir)) {
                try {
                  fse.removeSync(patchDir);
                  log.info(`Rolled back partial patch creation: ${directory}`);
                } catch (rollbackError) {
                  log.error(`Failed to rollback patch creation:`, rollbackError);
                }
              }

              throw new Error(`Failed to create patch: ${errorMessage(error)}`);
            }
          }),
        OperationPriority.NORMAL,
      );
    },

    'patches:update': async data => {
      const {
        basePath,
        directory,
        patchName,
        rhythmType,
        stopMode,
        settingsVersion,
        patchID,
        patchOriginID,
        phrases,
      } = data;

      // Security: approved folder, valid patch directory and readable source WAVs
      folderAccess.assertRoot(basePath);
      if (!PathValidator.isValidPatchDir(directory)) {
        throw new Error(`Invalid patch directory name: ${directory}`);
      }
      for (const phrase of phrases ?? []) {
        folderAccess.assertReadableFile(phrase.wavPath, ['.wav']);
      }

      const patchDir = PathValidator.safeJoin(basePath, directory);
      const backupDir = PathValidator.safeJoin(basePath, `__backup_${directory}_${Date.now()}`);

      return operationQueue.enqueue(
        'patches:update',
        `Update patch: ${directory}`,
        () =>
          // Lock: no concurrent operations on the same patch
          lockManager.withLock(patchDir, async () => {
            try {
              if (!fs.existsSync(patchDir)) {
                throw new Error(`Patch directory ${directory} does not exist`);
              }

              // Create backup before modifying
              fse.copySync(patchDir, backupDir);
              log.info(`Created backup: ${backupDir}`);

              // Overwrite patch.xml
              const patchXml = buildPatchXml({
                patchName,
                rhythmType,
                stopMode,
                settingsVersion: Number(settingsVersion || '0') + 1,
                id: patchID || randomUUID(),
                originId: patchOriginID || randomUUID(),
              });
              fs.writeFileSync(path.join(patchDir, 'patch.xml'), patchXml, 'utf-8');

              // Remove the phrases that are no longer in the form
              const existingPhraseDirs = fs
                .readdirSync(patchDir)
                .filter(d => PHRASE_DIR_RE.test(d));
              const updatedPhraseDirs = phrases.map(p => p.name);
              for (const phraseName of existingPhraseDirs) {
                if (!updatedPhraseDirs.includes(phraseName)) {
                  fse.removeSync(path.join(patchDir, phraseName));
                }
              }

              // Write/Update phrases
              for (const phrase of phrases) {
                const phraseDir = path.join(patchDir, phrase.name);
                fse.ensureDirSync(phraseDir);

                const phraseXmlPath = path.join(phraseDir, 'phrase.xml');

                // Try to reuse existing ID and OriginID
                let phraseId: string = randomUUID();
                let originId: string = randomUUID();

                if (fs.existsSync(phraseXmlPath)) {
                  const existingPhraseXml = fs.readFileSync(phraseXmlPath, 'utf-8');
                  // Security: Use hardened XML parser to prevent XXE attacks
                  const parsed = await SecureXMLParser.parsePhraseXML(existingPhraseXml);
                  phraseId = parsed.JamManPhrase?.ID?.[0] ?? phraseId;
                  originId = parsed.JamManPhrase?.OriginID?.[0] ?? originId;
                }

                // If wavPath is not already in that location, copy it
                const destWav = path.join(phraseDir, 'phrase.wav');
                if (phrase.wavPath && path.resolve(phrase.wavPath) !== path.resolve(destWav)) {
                  if (!fs.existsSync(phrase.wavPath)) {
                    throw new Error(`Source WAV file not found: ${phrase.wavPath}`);
                  }
                  fs.copyFileSync(phrase.wavPath, destWav);
                }

                fs.writeFileSync(
                  phraseXmlPath,
                  buildPhraseXml(phrase, phraseId, originId),
                  'utf-8',
                );
              }

              // Success - remove backup
              fse.removeSync(backupDir);
              log.info(`Successfully updated patch: ${directory}`);
              patchCache.invalidate(basePath);
              return true as const;
            } catch (error) {
              log.error(`Error updating patch ${directory}:`, error);

              // Rollback: Restore from backup
              if (fs.existsSync(backupDir)) {
                try {
                  fse.removeSync(patchDir);
                  fse.moveSync(backupDir, patchDir);
                  log.info(`Rolled back patch update: ${directory}`);
                } catch (rollbackError) {
                  log.error(`Failed to rollback patch update:`, rollbackError);
                }
              }

              throw new Error(`Failed to update patch: ${errorMessage(error)}`);
            }
          }),
        OperationPriority.NORMAL,
      );
    },

    'patches:delete': async (basePath, directory) => {
      // Security: Validate inputs
      if (!basePath || typeof basePath !== 'string') {
        throw new Error('Invalid base path');
      }
      folderAccess.assertRoot(basePath);

      if (!directory || typeof directory !== 'string') {
        throw new Error('Invalid directory name');
      }
      if (!PathValidator.isValidPatchDir(directory)) {
        throw new Error(`Invalid patch directory name: ${directory}`);
      }

      // Security: Validate paths are within base path
      const patchPath = PathValidator.safeJoin(basePath, directory);
      const backupDir = PathValidator.safeJoin(basePath, `__deleted_${directory}_${Date.now()}`);

      // High priority: delete is user-initiated
      return operationQueue.enqueue(
        'patches:delete',
        `Delete patch: ${directory}`,
        () =>
          lockManager.withLock(patchPath, async () => {
            try {
              if (!fs.existsSync(patchPath)) {
                throw new Error(`Patch not found: ${directory}`);
              }

              // Move aside instead of deleting at once, for safety
              fse.moveSync(patchPath, backupDir);
              log.info(`Moved patch to backup before deletion: ${directory}`);
              removeLater([backupDir], () => directory);

              patchCache.invalidate(basePath);
              return true as const;
            } catch (error) {
              log.error(`Error deleting patch ${directory}:`, error);

              // Rollback: Restore from backup if it exists
              if (fs.existsSync(backupDir) && !fs.existsSync(patchPath)) {
                try {
                  fse.moveSync(backupDir, patchPath);
                  log.info(`Restored patch from backup: ${directory}`);
                } catch (rollbackError) {
                  log.error(`Failed to restore deleted patch:`, rollbackError);
                }
              }

              throw new Error(`Failed to delete patch: ${errorMessage(error)}`);
            }
          }),
        OperationPriority.HIGH,
      );
    },

    'patches:deleteBatch': async (basePath, directories) => {
      // Security: approved folder and valid patch directory names only
      folderAccess.assertRoot(basePath);
      if (
        !Array.isArray(directories) ||
        !directories.every(d => PathValidator.isValidPatchDir(d))
      ) {
        throw new Error('Invalid patch directory names');
      }

      const backups: Record<string, string> = {};
      const deleted: string[] = [];

      // High priority: delete is user-initiated
      return operationQueue.enqueue(
        'patches:deleteBatch',
        `Delete ${directories.length} patches`,
        async () => {
          try {
            // Each patch with its own lock
            for (const directory of directories) {
              const patchPath = path.join(basePath, directory);
              const backupDir = path.join(basePath, `__deleted_${directory}_${Date.now()}`);

              await lockManager.withLock(patchPath, async () => {
                if (!fs.existsSync(patchPath)) {
                  log.warn(`Patch not found, skipping: ${directory}`);
                  return;
                }

                // Move aside instead of deleting at once, for safety
                fse.moveSync(patchPath, backupDir);
                backups[directory] = backupDir;
                deleted.push(directory);
                log.info(`Moved patch to backup before deletion: ${directory}`);
              });
            }

            removeLater(Object.values(backups), backupDir => backupDir);
            patchCache.invalidate(basePath);

            log.info(`Successfully deleted ${deleted.length} patches`);
            return { success: true, deleted, failed: directories.length - deleted.length };
          } catch (error) {
            log.error(`Error during batch delete:`, error);

            // Rollback: Restore all backed up patches
            for (const [directory, backupDir] of Object.entries(backups)) {
              const patchPath = path.join(basePath, directory);
              if (fs.existsSync(backupDir) && !fs.existsSync(patchPath)) {
                try {
                  fse.moveSync(backupDir, patchPath);
                  log.info(`Restored patch from backup: ${directory}`);
                } catch (rollbackError) {
                  log.error(`Failed to restore deleted patch ${directory}:`, rollbackError);
                }
              }
            }

            throw new Error(`Failed to delete patches: ${errorMessage(error)}`);
          }
        },
        OperationPriority.HIGH,
      );
    },

    'patches:reorder': async (basePath, newOrder) => {
      // Security: approved folder and valid patch directory names only
      folderAccess.assertRoot(basePath);
      if (!Array.isArray(newOrder) || !newOrder.every(d => PathValidator.isValidPatchDir(d))) {
        throw new Error('Invalid patch directory names');
      }
      const jammanPath = path.join(basePath);
      const tempMap: Record<string, string> = {};

      return operationQueue.enqueue(
        'patches:reorder',
        `Reorder ${newOrder.length} patches`,
        () =>
          // Lock on the whole folder: no concurrent reorders
          lockManager.withLock(basePath, async () => {
            try {
              // Validate all patches exist before starting
              for (const patchName of newOrder) {
                if (!fs.existsSync(path.join(jammanPath, patchName))) {
                  throw new Error(`Patch folder not found: ${patchName}`);
                }
              }

              // 1. Temporary rename to avoid conflicts
              for (let i = 0; i < newOrder.length; i++) {
                const currentName = newOrder[i];
                const tempName = `__tmp_${currentName}`;
                fs.renameSync(path.join(jammanPath, currentName), path.join(jammanPath, tempName));
                tempMap[tempName] = `Patch${String(i + 1).padStart(2, '0')}`;
              }

              // 2. Rename all temporary folders to their final names
              for (const [tempName, finalName] of Object.entries(tempMap)) {
                fs.renameSync(path.join(jammanPath, tempName), path.join(jammanPath, finalName));
              }

              log.info(`Successfully reordered ${newOrder.length} patches`);
              patchCache.invalidate(basePath);
              return true as const;
            } catch (error) {
              log.error('Error reordering patches:', error);

              // Rollback: Try to restore original names from temp
              for (const tempName of Object.keys(tempMap)) {
                const tempPath = path.join(jammanPath, tempName);
                const originalName = tempName.replace('__tmp_', '');
                try {
                  if (fs.existsSync(tempPath)) {
                    fs.renameSync(tempPath, path.join(jammanPath, originalName));
                  }
                } catch (rollbackError) {
                  log.error(`Failed to rollback rename for ${originalName}:`, rollbackError);
                }
              }

              throw new Error(`Failed to reorder patches: ${errorMessage(error)}`);
            }
          }),
        OperationPriority.NORMAL,
      );
    },
  };
}
