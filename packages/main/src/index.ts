import type { AppInitConfig } from './AppInitConfig.js';
import { createModuleRunner } from './ModuleRunner.js';
import { disallowMultipleAppInstance } from './modules/SingleInstanceApp.js';
import { createWindowManagerModule } from './modules/WindowManager.js';
import { terminateAppOnLastWindowClose } from './modules/ApplicationTerminatorOnLastWindowClose.js';
import { hardwareAccelerationMode } from './modules/HardwareAccelerationModule.js';
import { autoUpdater } from './modules/AutoUpdater.js';
import { allowInternalOrigins } from './modules/BlockNotAllowdOrigins.js';
import { allowExternalUrls } from './modules/ExternalUrls.js';
import { app, dialog, ipcMain, protocol } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { v4 as uuidv4 } from 'uuid';
import * as fse from 'fs-extra';
import * as mm from 'music-metadata';
import log from 'electron-log';

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

export async function initApp(initConfig: AppInitConfig) {
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

  // Register custom protocol scheme as privileged before app is ready
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

  app.whenReady().then(() => {
    // Use modern protocol.handle() API instead of deprecated registerFileProtocol
    protocol.handle('jamman', async request => {
      try {
        // Extract file path from URL
        const url = request.url.replace('jamman://', '');
        const filePath = decodeURIComponent(url);

        log.info(`Serving audio file: ${filePath}`);

        // Validate file exists
        if (!fs.existsSync(filePath)) {
          log.error(`Audio file not found: ${filePath}`);
          return new Response('File not found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' },
          });
        }

        // Read file
        const fileBuffer = fs.readFileSync(filePath);

        // Return Response with proper headers for WAV audio
        return new Response(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': fileBuffer.length.toString(),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch (error) {
        log.error('Error serving audio file:', error);
        return new Response('Internal server error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    });
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
      if (!fs.existsSync(filePath)) {
        log.warn(`Audio file not found: ${filePath}`);
        return null;
      }
      return `jamman://${encodeURIComponent(filePath)}`;
    } catch (error) {
      log.error('Error getting audio URL:', error);
      return null;
    }
  });

  ipcMain.handle('audio:validateWav', async (_event, filePath: string) => {
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: 'File not found' };
    }

    try {
      const metadata = await mm.parseFile(filePath);
      const { sampleRate, numberOfChannels, bitsPerSample, duration, container } = metadata.format;

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
      };
    } catch {
      return { valid: false, error: 'Unable to parse WAV file.' };
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
      const existingPhraseDirs = fs.readdirSync(patchDir).filter(d => /^Phrase[A-Z]$/.test(d));

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

  ipcMain.handle('patches:delete', async (_event, basePath: string, directory: string) => {
    const patchPath = path.join(basePath, directory);
    const backupDir = path.join(basePath, `__deleted_${directory}_${Date.now()}`);

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

  ipcMain.handle('patches:reorder', async (_event, basePath: string, newOrder: string[]) => {
    const jammanPath = path.join(basePath);
    const tempMap: Record<string, string> = {};
    const originalState: Record<string, boolean> = {};

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

  await moduleRunner;
}
