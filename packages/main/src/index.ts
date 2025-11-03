import type { AppInitConfig } from './AppInitConfig.js';
import { createModuleRunner } from './ModuleRunner.js';
import { disallowMultipleAppInstance } from './modules/SingleInstanceApp.js';
import { createWindowManagerModule } from './modules/WindowManager.js';
import { terminateAppOnLastWindowClose } from './modules/ApplicationTerminatorOnLastWindowClose.js';
import { hardwareAccelerationMode } from './modules/HardwareAccelerationModule.js';
import { autoUpdater } from './modules/AutoUpdater.js';
import { allowInternalOrigins } from './modules/BlockNotAllowdOrigins.js';
import { allowExternalUrls } from './modules/ExternalUrls.js';
import { app, dialog, ipcMain, protocol, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { v4 as uuidv4 } from 'uuid';
import fse from 'fs-extra';
import * as mm from 'music-metadata';
import log from 'electron-log';
import { lockManager } from './LockManager.js';
import { operationQueue, OperationPriority } from './OperationQueue.js';
import PDFDocument from 'pdfkit';

// Cache for parsed patches to improve performance
type CacheEntry = {
  patches: any[];
  modTimes: Map<string, number>;
};

const patchCache = new Map<string, CacheEntry>();

type PhraseForm = {
  name: string;
  beatsPerMinute: number;
  beatsPerMeasure: number;
  isLoop: boolean;
  isReversed: boolean;
  wavPath: string;
};

type PatchForm = {
  basePath: string;
  directory: string;
  patchName: string;
  rhythmType: string;
  stopMode: string;
  settingsVersion?: string;
  patchID?: string;
  patchOriginID?: string;
  phrases: PhraseForm[];
};

type ExportPatch = {
  dir: string;
  data?: {
    JamManPatch?: {
      PatchName?: string[];
      RhythmType?: string[];
      StopMode?: string[];
    };
  };
  phrases?: {
    dir: string;
    data?: {
      JamManPhrase?: {
        BeatsPerMinute?: string[];
        BeatsPerMeasure?: string[];
        IsLoop?: string[];
        IsReversed?: string[];
      };
    };
  }[];
};

export async function initApp(initConfig: AppInitConfig) {
  // CRITICAL: Register custom protocol scheme BEFORE any app initialization
  // This must be called before app.ready fires
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'jamman',
      privileges: {
        bypassCSP: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
  log.info('Custom protocol "jamman" registered as privileged');

  const moduleRunner = createModuleRunner()
    .init(
      createWindowManagerModule({
        initConfig,
        openDevTools: import.meta.env.DEV,
      }),
    )
    .init(disallowMultipleAppInstance())
    .init(terminateAppOnLastWindowClose())
    .init(hardwareAccelerationMode({ enable: false }))
    .init(autoUpdater())

    // Install DevTools extension if needed
    // .init(chromeDevToolsExtension({extension: 'VUEJS3_DEVTOOLS'}))

    // Security
    .init(
      allowInternalOrigins(
        new Set(initConfig.renderer instanceof URL ? [initConfig.renderer.origin] : []),
      ),
    )
    .init(
      allowExternalUrls(
        new Set(
          initConfig.renderer instanceof URL
            ? [
                'https://vite.dev',
                'https://developer.mozilla.org',
                'https://solidjs.com',
                'https://qwik.dev',
                'https://lit.dev',
                'https://react.dev',
                'https://preactjs.com',
                'https://www.typescriptlang.org',
                'https://vuejs.org',
              ]
            : [],
        ),
      ),
    );

  app.whenReady().then(() => {
    // Use net.fetch to proxy file:// URLs through our custom protocol
    // This leverages Chromium's native file streaming which properly supports range requests
    protocol.handle('jamman', request => {
      try {
        log.info(`Protocol handler received request: ${request.url}`);

        // Extract file path from URL
        const url = request.url.replace('jamman://', '');
        const filePath = decodeURIComponent(url);

        log.info(`Decoded file path: ${filePath}`);

        // Validate file path is not empty
        if (!filePath || filePath.trim() === '') {
          log.error('Empty file path received');
          return new Response('Empty file path', {
            status: 400,
            headers: { 'Content-Type': 'text/plain' },
          });
        }

        // Validate file exists
        if (!fs.existsSync(filePath)) {
          log.error(`Audio file not found: ${filePath}`);
          return new Response('File not found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' },
          });
        }

        // Convert to file:// URL and let Chromium handle the streaming
        // This properly supports range requests natively
        const fileUrl = `file://${filePath}`;
        log.info(`Proxying to: ${fileUrl}`);

        return net.fetch(fileUrl);
      } catch (error) {
        log.error('Error serving audio file:', error);
        return new Response('Internal server error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    });
    log.info('Protocol handler "jamman" registered successfully');
  });

  ipcMain.handle('dialog:selectFolder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      });
      return result.filePaths[0];
    } catch (error) {
      log.error('Error selecting folder:', error);
      throw new Error('Failed to open folder selection dialog');
    }
  });

  ipcMain.handle('patches:read', async (_event, folderPath: string) => {
    try {
      if (!fs.existsSync(folderPath)) {
        throw new Error('Folder does not exist');
      }

      const jammanPath = path.join(folderPath);

      // Collect current modification times
      const currentModTimes = new Map<string, number>();
      const patchDirs = fs.readdirSync(jammanPath).filter(d => {
        try {
          return fs.statSync(path.join(jammanPath, d)).isDirectory();
        } catch {
          return false; // Skip files that can't be accessed
        }
      });

      // Get modification times for all patch and phrase XML files
      for (const dir of patchDirs) {
        const patchXmlPath = path.join(jammanPath, dir, 'patch.xml');
        if (fs.existsSync(patchXmlPath)) {
          const stat = fs.statSync(patchXmlPath);
          currentModTimes.set(patchXmlPath, stat.mtimeMs);

          // Check phrase XML files
          const patchDirPath = path.join(jammanPath, dir);
          const phraseDirs = fs
            .readdirSync(patchDirPath)
            .filter(
              subdir =>
                /^Phrase[A-Z]$/.test(subdir) &&
                fs.existsSync(path.join(patchDirPath, subdir, 'phrase.xml')),
            );

          for (const phraseDir of phraseDirs) {
            const phraseXmlPath = path.join(patchDirPath, phraseDir, 'phrase.xml');
            if (fs.existsSync(phraseXmlPath)) {
              const phraseStat = fs.statSync(phraseXmlPath);
              currentModTimes.set(phraseXmlPath, phraseStat.mtimeMs);
            }
          }
        }
      }

      // Check cache
      const cached = patchCache.get(folderPath);
      if (cached) {
        // Verify all modification times match
        let cacheValid = cached.modTimes.size === currentModTimes.size;
        if (cacheValid) {
          for (const [filePath, modTime] of currentModTimes) {
            if (cached.modTimes.get(filePath) !== modTime) {
              cacheValid = false;
              break;
            }
          }
        }

        if (cacheValid) {
          log.info(`Using cached patches for ${folderPath}`);
          return cached.patches;
        }
      }

      // Cache miss or invalid - parse patches
      log.info(`Parsing patches for ${folderPath}`);
      const patches = await Promise.all(
        patchDirs.map(async dir => {
          try {
            const patchDirPath = path.join(jammanPath, dir);
            const patchXmlPath = path.join(patchDirPath, 'patch.xml');

            if (!fs.existsSync(patchXmlPath)) {
              log.warn(`Skipping ${dir}: patch.xml not found`);
              return null;
            }

            const patchXml = fs.readFileSync(patchXmlPath, 'utf-8');
            const parser = new xml2js.Parser();
            const patchData = await parser.parseStringPromise(patchXml);

            // Read all PhraseX folders (PhraseA, PhraseB, etc.)
            const phraseDirs = fs
              .readdirSync(patchDirPath)
              .filter(
                subdir =>
                  /^Phrase[A-Z]$/.test(subdir) &&
                  fs.existsSync(path.join(patchDirPath, subdir, 'phrase.xml')),
              );

            const phrases = await Promise.all(
              phraseDirs.map(async phraseDir => {
                try {
                  const phraseXmlPath = path.join(patchDirPath, phraseDir, 'phrase.xml');
                  const phraseWavPath = path.join(patchDirPath, phraseDir, 'phrase.wav');

                  const phraseXml = fs.readFileSync(phraseXmlPath, 'utf-8');
                  const phraseData = await parser.parseStringPromise(phraseXml);
                  return {
                    dir: phraseDir,
                    data: phraseData,
                    wavPath: phraseWavPath,
                  };
                } catch (error) {
                  log.error(`Error reading phrase ${phraseDir}:`, error);
                  return null;
                }
              }),
            );

            return {
              dir,
              data: patchData,
              phrases: phrases.filter(Boolean),
            };
          } catch (error) {
            log.error(`Error reading patch ${dir}:`, error);
            return null;
          }
        }),
      );

      const filteredPatches = patches.filter(Boolean);

      // Update cache
      patchCache.set(folderPath, {
        patches: filteredPatches,
        modTimes: currentModTimes,
      });

      return filteredPatches;
    } catch (error) {
      log.error('Error reading patches from folder:', error);
      throw new Error(
        `Failed to read patches from folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  });

  ipcMain.handle('phrase:getAudioURL', async (_event, filePath: string) => {
    try {
      log.info(`getAudioURL called with filePath: ${filePath}`);

      // Validate filePath is not empty
      if (!filePath || filePath.trim() === '') {
        log.error('Empty filePath provided to getAudioURL');
        return null;
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        log.warn(`Audio file not found: ${filePath}`);
        return null;
      }

      // Create the custom protocol URL
      const url = `jamman://${encodeURIComponent(filePath)}`;
      log.info(`Generated audio URL: ${url}`);

      return url;
    } catch (error) {
      log.error('Error getting audio URL:', error);
      return null;
    }
  });

  ipcMain.handle('audio:validateWav', async (_event, filePath: string) => {
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: 'File not found', canAttemptPlayback: false };
    }

    try {
      const metadata = await mm.parseFile(filePath);
      const { sampleRate, numberOfChannels, bitsPerSample, duration, container } = metadata.format;

      log.info(
        `WAV metadata for ${filePath}: ${container}, ${sampleRate}Hz, ${bitsPerSample}bit, ${numberOfChannels}ch`,
      );

      const isValid =
        container === 'WAVE' &&
        sampleRate === 44100 &&
        bitsPerSample === 16 &&
        (numberOfChannels === 1 || numberOfChannels === 2);

      return {
        valid: isValid,
        sampleRate,
        bitsPerSample,
        numberOfChannels,
        duration,
        error: isValid ? null : 'Unsupported WAV format. Expected 44.1kHz, 16-bit, mono/stereo.',
        canAttemptPlayback: true, // Even if format is unexpected, let browser try
      };
    } catch (error) {
      // Can't parse metadata, but file might still be playable
      log.warn(`Unable to parse WAV metadata for ${filePath}:`, error);
      return {
        valid: false,
        error: 'Unable to parse WAV file metadata.',
        warning: 'File format could not be validated, but playback will be attempted.',
        canAttemptPlayback: true, // Let the browser try to play it
      };
    }
  });

  ipcMain.handle('dialog:selectFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Audio', extensions: ['wav'] }],
      });

      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    } catch (error) {
      log.error('Error selecting file:', error);
      throw new Error('Failed to open file selection dialog');
    }
  });

  ipcMain.handle('patches:create', async (_event, data: PatchForm) => {
    const { basePath, directory, patchName, rhythmType, stopMode, phrases } = data;
    const patchDir = path.join(basePath, directory);

    // Enqueue operation with normal priority
    return operationQueue.enqueue(
      'patches:create',
      `Create patch: ${directory}`,
      async () => {
        // Use lock to prevent concurrent operations on the same patch
        return lockManager.withLock(patchDir, async () => {
          try {
            // Check if patch already exists
            if (fs.existsSync(patchDir)) {
              throw new Error(`Patch directory ${directory} already exists`);
            }

            fse.ensureDirSync(patchDir);

            // Patch UUIDs
            const patchId = uuidv4();
            const patchOriginId = uuidv4();

            // 1. Write patch.xml
            const patchXml = `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManStereo" version="1">
  <PatchName>${patchName}</PatchName>
  <RhythmType>${rhythmType}</RhythmType>
  <StopMode>${stopMode}</StopMode>
  <SettingsVersion>1</SettingsVersion>
  <ID>${patchId}</ID>
  <OriginID>${patchOriginId}</OriginID>
  <Metadata/>
</JamManPatch>`.trim();

            fs.writeFileSync(path.join(patchDir, 'patch.xml'), patchXml, 'utf-8');

            // 2. Write each phrase folder and XML
            for (const phrase of phrases) {
              const phraseDir = path.join(patchDir, phrase.name);
              fse.ensureDirSync(phraseDir);

              const phraseId = uuidv4();
              const originId = uuidv4();

              // Copy WAV file
              const wavDest = path.join(phraseDir, 'phrase.wav');
              if (!fs.existsSync(phrase.wavPath)) {
                throw new Error(`Source WAV file not found: ${phrase.wavPath}`);
              }
              fs.copyFileSync(phrase.wavPath, wavDest);

              // Write phrase.xml
              const phraseXml = `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPhrase xmlns="http://schemas.digitech.com/JamMan/Phrase" version="1">
  <BeatsPerMinute>${phrase.beatsPerMinute}</BeatsPerMinute>
  <BeatsPerMeasure>${phrase.beatsPerMeasure}</BeatsPerMeasure>
  <BpmValidated>0</BpmValidated>
  <IsLoop>${phrase.isLoop ? 1 : 0}</IsLoop>
  <IsReversed>${phrase.isReversed ? 1 : 0}</IsReversed>
  <SettingsVersion>1</SettingsVersion>
  <AudioVersion>1</AudioVersion>
  <ID>${phraseId}</ID>
  <OriginID>${originId}</OriginID>
  <Metadata/>
</JamManPhrase>`.trim();

              fs.writeFileSync(path.join(phraseDir, 'phrase.xml'), phraseXml, 'utf-8');
            }

            log.info(`Successfully created patch: ${directory}`);

            // Invalidate cache
            patchCache.delete(basePath);

            return true;
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

            throw new Error(
              `Failed to create patch: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          }
        });
      },
      OperationPriority.NORMAL,
    );
  });

  ipcMain.handle('patches:update', async (_event, data: PatchForm) => {
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
    const patchDir = path.join(basePath, directory);
    const backupDir = path.join(basePath, `__backup_${directory}_${Date.now()}`);

    // Enqueue operation with normal priority
    return operationQueue.enqueue(
      'patches:update',
      `Update patch: ${directory}`,
      async () => {
        // Use lock to prevent concurrent operations on the same patch
        return lockManager.withLock(patchDir, async () => {
          try {
            // Validate patch exists
            if (!fs.existsSync(patchDir)) {
              throw new Error(`Patch directory ${directory} does not exist`);
            }

            // Create backup before modifying
            fse.copySync(patchDir, backupDir);
            log.info(`Created backup: ${backupDir}`);

            // Overwrite patch.xml
            const updatedPatchID = patchID || uuidv4();
            const updatedOriginID = patchOriginID || uuidv4();
            const updatedSettingsVersion = Number(settingsVersion || '0') + 1;

            const patchXml = `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManStereo" version="1">
  <PatchName>${patchName}</PatchName>
  <RhythmType>${rhythmType}</RhythmType>
  <StopMode>${stopMode}</StopMode>
  <SettingsVersion>${updatedSettingsVersion}</SettingsVersion>
  <ID>${updatedPatchID}</ID>
  <OriginID>${updatedOriginID}</OriginID>
  <Metadata/>
</JamManPatch>`.trim();

            fs.writeFileSync(path.join(patchDir, 'patch.xml'), patchXml, 'utf-8');

            // Overwrite each phrase
            const existingPhraseDirs = fs
              .readdirSync(patchDir)
              .filter(d => /^Phrase[A-Z]$/.test(d));

            const updatedPhraseDirs = phrases.map((p: any) => p.name);
            const toDelete = existingPhraseDirs.filter(d => !updatedPhraseDirs.includes(d));

            toDelete.forEach(phraseName => {
              fse.removeSync(path.join(patchDir, phraseName));
            });

            // 🔄 Write/Update phrases
            for (const phrase of phrases) {
              const phraseDir = path.join(patchDir, phrase.name);
              fse.ensureDirSync(phraseDir);

              const phraseXmlPath = path.join(phraseDir, 'phrase.xml');

              // Try to reuse existing ID and OriginID
              let phraseId = uuidv4();
              let originId = uuidv4();

              if (fs.existsSync(phraseXmlPath)) {
                const existingPhraseXml = fs.readFileSync(phraseXmlPath, 'utf-8');
                const parsed = await new xml2js.Parser().parseStringPromise(existingPhraseXml);
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

              const phraseXml = `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPhrase xmlns="http://schemas.digitech.com/JamMan/Phrase" version="1">
  <BeatsPerMinute>${phrase.beatsPerMinute}</BeatsPerMinute>
  <BeatsPerMeasure>${phrase.beatsPerMeasure}</BeatsPerMeasure>
  <BpmValidated>0</BpmValidated>
  <IsLoop>${phrase.isLoop ? 1 : 0}</IsLoop>
  <IsReversed>${phrase.isReversed ? 1 : 0}</IsReversed>
  <SettingsVersion>1</SettingsVersion>
  <AudioVersion>1</AudioVersion>
  <ID>${phraseId}</ID>
  <OriginID>${originId}</OriginID>
  <Metadata/>
</JamManPhrase>`.trim();

              fs.writeFileSync(phraseXmlPath, phraseXml, 'utf-8');
            }

            // Success - remove backup
            fse.removeSync(backupDir);
            log.info(`Successfully updated patch: ${directory}`);

            // Invalidate cache
            patchCache.delete(basePath);

            return true;
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

            throw new Error(
              `Failed to update patch: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          }
        });
      },
      OperationPriority.NORMAL,
    );
  });

  ipcMain.handle('patches:delete', async (_event, basePath: string, directory: string) => {
    const patchPath = path.join(basePath, directory);
    const backupDir = path.join(basePath, `__deleted_${directory}_${Date.now()}`);

    // Enqueue operation with high priority (delete is user-initiated)
    return operationQueue.enqueue(
      'patches:delete',
      `Delete patch: ${directory}`,
      async () => {
        // Use lock to prevent concurrent operations on the same patch
        return lockManager.withLock(patchPath, async () => {
          try {
            if (!fs.existsSync(patchPath)) {
              throw new Error(`Patch not found: ${directory}`);
            }

            // Move to backup instead of immediate deletion for safety
            fse.moveSync(patchPath, backupDir);
            log.info(`Moved patch to backup before deletion: ${directory}`);

            // Actually delete the backup after a short delay
            setTimeout(() => {
              if (fs.existsSync(backupDir)) {
                fse.removeSync(backupDir);
                log.info(`Permanently deleted patch backup: ${directory}`);
              }
            }, 5000); // 5 second safety window

            // Invalidate cache
            patchCache.delete(basePath);

            return true;
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

            throw new Error(
              `Failed to delete patch: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          }
        });
      },
      OperationPriority.HIGH,
    );
  });

  ipcMain.handle('patches:reorder', async (_event, basePath: string, newOrder: string[]) => {
    const jammanPath = path.join(basePath);
    const tempMap: Record<string, string> = {};
    const originalState: Record<string, boolean> = {};

    // Enqueue operation with normal priority
    return operationQueue.enqueue(
      'patches:reorder',
      `Reorder ${newOrder.length} patches`,
      async () => {
        // Use lock on base path to prevent concurrent reordering operations
        return lockManager.withLock(basePath, async () => {
          try {
            // Validate all patches exist before starting
            for (const patchName of newOrder) {
              const patchPath = path.join(jammanPath, patchName);
              if (!fs.existsSync(patchPath)) {
                throw new Error(`Patch folder not found: ${patchName}`);
              }
              originalState[patchName] = true;
            }

            // 1. Temporary rename to avoid conflicts
            for (let i = 0; i < newOrder.length; i++) {
              const currentName = newOrder[i];
              const originalPath = path.join(jammanPath, currentName);
              const tempName = `__tmp_${currentName}`;
              const tempPath = path.join(jammanPath, tempName);

              fs.renameSync(originalPath, tempPath);
              tempMap[tempName] = `Patch${String(i + 1).padStart(2, '0')}`;
            }

            // 2. Rename all temporary folders to their final names
            for (const [tempName, finalName] of Object.entries(tempMap)) {
              const tempPath = path.join(jammanPath, tempName);
              const finalPath = path.join(jammanPath, finalName);
              fs.renameSync(tempPath, finalPath);
            }

            log.info(`Successfully reordered ${newOrder.length} patches`);

            // Invalidate cache
            patchCache.delete(basePath);

            return true;
          } catch (error) {
            log.error('Error reordering patches:', error);

            // Rollback: Try to restore original names from temp
            for (const [tempName] of Object.entries(tempMap)) {
              const tempPath = path.join(jammanPath, tempName);
              const originalName = tempName.replace('__tmp_', '');
              const originalPath = path.join(jammanPath, originalName);

              try {
                if (fs.existsSync(tempPath)) {
                  fs.renameSync(tempPath, originalPath);
                }
              } catch (rollbackError) {
                log.error(`Failed to rollback rename for ${originalName}:`, rollbackError);
              }
            }

            throw new Error(
              `Failed to reorder patches: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          }
        });
      },
      OperationPriority.NORMAL,
    );
  });

  ipcMain.handle('patches:exportTXT', async (_event, patches: ExportPatch[], basePath: string) => {
    try {
      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: 'Export Patches to TXT',
        defaultPath: path.join(basePath, 'jamman-patches.txt'),
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      // Format patch data as plain text
      let content = 'JamMan Patches Export\n';
      content += `Generated: ${new Date().toLocaleString()}\n`;
      content += '='.repeat(80) + '\n\n';

      patches.forEach((patch, index) => {
        const patchData = patch.data?.JamManPatch;
        const patchName = patchData?.PatchName?.[0] || 'Unknown';
        const rhythmType = patchData?.RhythmType?.[0] || '0';
        const stopMode = patchData?.StopMode?.[0] || '0';

        content += `Patch ${index + 1}: ${patch.dir}\n`;
        content += `-`.repeat(80) + '\n';
        content += `  Name: ${patchName}\n`;
        content += `  Rhythm Type: ${rhythmType}\n`;
        content += `  Stop Mode: ${stopMode}\n`;

        if (patch.phrases && patch.phrases.length > 0) {
          content += `  Phrases (${patch.phrases.length}):\n`;
          patch.phrases.forEach(phrase => {
            const phraseData = phrase.data?.JamManPhrase;
            const bpm = phraseData?.BeatsPerMinute?.[0] || '120';
            const beatsPerMeasure = phraseData?.BeatsPerMeasure?.[0] || '4';
            const isLoop = phraseData?.IsLoop?.[0] === '1' ? 'Yes' : 'No';
            const isReversed = phraseData?.IsReversed?.[0] === '1' ? 'Yes' : 'No';

            content += `    - ${phrase.dir}: ${bpm} BPM, ${beatsPerMeasure}/4, Loop: ${isLoop}, Reversed: ${isReversed}\n`;
          });
        } else {
          content += `  Phrases: None\n`;
        }

        content += '\n';
      });

      // Write to file
      fs.writeFileSync(result.filePath, content, 'utf-8');
      log.info(`Successfully exported ${patches.length} patches to TXT: ${result.filePath}`);

      return { success: true, filePath: result.filePath };
    } catch (error) {
      log.error('Error exporting patches to TXT:', error);
      throw new Error(
        `Failed to export patches: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  });

  ipcMain.handle('patches:exportPDF', async (_event, patches: ExportPatch[], basePath: string) => {
    try {
      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: 'Export Patches to PDF',
        defaultPath: path.join(basePath, 'jamman-patches.pdf'),
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      // Create PDF document
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(result.filePath);
      doc.pipe(stream);

      // Title
      doc.fontSize(20).text('JamMan Patches Export', { align: 'center' });
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(2);

      // Add each patch
      patches.forEach((patch, index) => {
        const patchData = patch.data?.JamManPatch;
        const patchName = patchData?.PatchName?.[0] || 'Unknown';
        const rhythmType = patchData?.RhythmType?.[0] || '0';
        const stopMode = patchData?.StopMode?.[0] || '0';

        // Check if we need a new page
        if (index > 0 && doc.y > 650) {
          doc.addPage();
        }

        // Patch header
        doc
          .fontSize(14)
          .fillColor('#4A90E2')
          .text(`Patch ${index + 1}: ${patch.dir}`, { underline: true });
        doc.fillColor('black');
        doc.moveDown(0.5);

        // Patch details
        doc.fontSize(11).text(`Name: ${patchName}`);
        doc.text(`Rhythm Type: ${rhythmType}`);
        doc.text(`Stop Mode: ${stopMode}`);
        doc.moveDown(0.5);

        // Phrases
        if (patch.phrases && patch.phrases.length > 0) {
          doc.fontSize(11).fillColor('#666666').text(`Phrases (${patch.phrases.length}):`);
          doc.fillColor('black');

          patch.phrases.forEach(phrase => {
            const phraseData = phrase.data?.JamManPhrase;
            const bpm = phraseData?.BeatsPerMinute?.[0] || '120';
            const beatsPerMeasure = phraseData?.BeatsPerMeasure?.[0] || '4';
            const isLoop = phraseData?.IsLoop?.[0] === '1' ? 'Yes' : 'No';
            const isReversed = phraseData?.IsReversed?.[0] === '1' ? 'Yes' : 'No';

            doc
              .fontSize(10)
              .text(
                `  • ${phrase.dir}: ${bpm} BPM, ${beatsPerMeasure}/4, Loop: ${isLoop}, Reversed: ${isReversed}`,
                { indent: 20 },
              );
          });
        } else {
          doc.fontSize(11).fillColor('#666666').text('Phrases: None');
          doc.fillColor('black');
        }

        doc.moveDown(1.5);
      });

      // Finalize PDF
      doc.end();

      // Wait for the stream to finish
      await new Promise<void>((resolve, reject) => {
        stream.on('finish', () => resolve());
        stream.on('error', reject);
      });

      log.info(`Successfully exported ${patches.length} patches to PDF: ${result.filePath}`);

      return { success: true, filePath: result.filePath };
    } catch (error) {
      log.error('Error exporting patches to PDF:', error);
      throw new Error(
        `Failed to export patches: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  });

  // Get operation queue status
  ipcMain.handle('operation-queue:status', async () => {
    try {
      return operationQueue.getStatus();
    } catch (error) {
      log.error('Error getting operation queue status:', error);
      throw new Error('Failed to get operation queue status');
    }
  });

  // Get operation queue statistics
  ipcMain.handle('operation-queue:statistics', async () => {
    try {
      return operationQueue.getStatistics();
    } catch (error) {
      log.error('Error getting operation queue statistics:', error);
      throw new Error('Failed to get operation queue statistics');
    }
  });

  await moduleRunner;
}
