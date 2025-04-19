import type { AppInitConfig } from "./AppInitConfig.js";
import { createModuleRunner } from "./ModuleRunner.js";
import { disallowMultipleAppInstance } from "./modules/SingleInstanceApp.js";
import { createWindowManagerModule } from "./modules/WindowManager.js";
import { terminateAppOnLastWindowClose } from "./modules/ApplicationTerminatorOnLastWindowClose.js";
import { hardwareAccelerationMode } from "./modules/HardwareAccelerationModule.js";
import { autoUpdater } from "./modules/AutoUpdater.js";
import { allowInternalOrigins } from "./modules/BlockNotAllowdOrigins.js";
import { allowExternalUrls } from "./modules/ExternalUrls.js";
import { app, dialog, ipcMain, protocol } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as xml2js from "xml2js";
import { v4 as uuidv4 } from "uuid";
import * as fse from "fs-extra";

export async function initApp(initConfig: AppInitConfig) {
  const moduleRunner = createModuleRunner()
    .init(
      createWindowManagerModule({
        initConfig,
        openDevTools: import.meta.env.DEV,
      })
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
        new Set(
          initConfig.renderer instanceof URL ? [initConfig.renderer.origin] : []
        )
      )
    )
    .init(
      allowExternalUrls(
        new Set(
          initConfig.renderer instanceof URL
            ? [
                "https://vite.dev",
                "https://developer.mozilla.org",
                "https://solidjs.com",
                "https://qwik.dev",
                "https://lit.dev",
                "https://react.dev",
                "https://preactjs.com",
                "https://www.typescriptlang.org",
                "https://vuejs.org",
              ]
            : []
        )
      )
    );

  app.whenReady().then(() => {
    protocol.registerFileProtocol("jamman", (request, callback) => {
      const url = request.url.replace("jamman://", "");
      const decodedPath = decodeURIComponent(url);
      callback({ path: decodedPath });
    });
  });

  ipcMain.handle("dialog:selectFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.filePaths[0];
  });

  ipcMain.handle("patches:read", async (_event, folderPath: string) => {
    const jammanPath = path.join(folderPath);
    const patchDirs = fs
      .readdirSync(jammanPath)
      .filter((d) => fs.statSync(path.join(jammanPath, d)).isDirectory());

    const patches = await Promise.all(
      patchDirs.map(async (dir) => {
        const patchDirPath = path.join(jammanPath, dir);
        const patchXmlPath = path.join(patchDirPath, "patch.xml");
        const patchXml = fs.readFileSync(patchXmlPath, "utf-8");

        const parser = new xml2js.Parser();
        const patchData = await parser.parseStringPromise(patchXml);

        // Read all PhraseX folders (PhraseA, PhraseB, etc.)
        const phraseDirs = fs
          .readdirSync(patchDirPath)
          .filter(
            (subdir) =>
              /^Phrase[A-Z]$/.test(subdir) &&
              fs.existsSync(path.join(patchDirPath, subdir, "phrase.xml"))
          );

        const phrases = await Promise.all(
          phraseDirs.map(async (phraseDir) => {
            const phraseXmlPath = path.join(
              patchDirPath,
              phraseDir,
              "phrase.xml"
            );
            const phraseWavPath = path.join(
              patchDirPath,
              phraseDir,
              "phrase.wav"
            );

            const phraseXml = fs.readFileSync(phraseXmlPath, "utf-8");
            const phraseData = await parser.parseStringPromise(phraseXml);
            return {
              dir: phraseDir,
              data: phraseData,
              wavPath: phraseWavPath,
            };
          })
        );

        return {
          dir,
          data: patchData,
          phrases,
        };
      })
    );

    return patches;
  });

  ipcMain.handle("phrase:getAudioURL", async (_event, filePath: string) => {
    if (!fs.existsSync(filePath)) return null;
    return `jamman://${encodeURIComponent(filePath)}`;
  });

  ipcMain.handle("dialog:selectFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav"] }],
    });

    return result.canceled || result.filePaths.length === 0
      ? null
      : result.filePaths[0];
  });

  ipcMain.handle("patches:create", async (_event, data) => {
    const { basePath, directory, patchName, rhythmType, stopMode, phrases } =
      data;

    const patchDir = path.join(basePath, directory);
    fse.ensureDirSync(patchDir);

    // Patch UUIDs
    const patchId = uuidv4();
    const patchOriginId = uuidv4();

    // 1. Write patch.xml
    const patchXml = `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManManager" version="1">
  <PatchName>${patchName}</PatchName>
  <RhythmType>${rhythmType}</RhythmType>
  <StopMode>${stopMode}</StopMode>
  <SettingsVersion>1</SettingsVersion>
  <ID>${patchId}</ID>
  <OriginID>${patchOriginId}</OriginID>
  <Metadata/>
</JamManPatch>`.trim();

    fs.writeFileSync(path.join(patchDir, "patch.xml"), patchXml, "utf-8");

    // 2. Write each phrase folder and XML
    for (const phrase of phrases) {
      const phraseDir = path.join(patchDir, phrase.name);
      fse.ensureDirSync(phraseDir);

      const phraseId = uuidv4();
      const originId = uuidv4();

      // Copy WAV file
      const wavDest = path.join(phraseDir, "phrase.wav");
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

      fs.writeFileSync(path.join(phraseDir, "phrase.xml"), phraseXml, "utf-8");
    }

    return true;
  });

  ipcMain.handle("patches:update", async (_event, data) => {
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

    // Overwrite patch.xml
    const updatedPatchID = patchID || uuidv4();
    const updatedOriginID = patchOriginID || uuidv4();
    const updatedSettingsVersion = Number(settingsVersion || "0") + 1;

    const patchXml = `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManManager" version="1">
  <PatchName>${patchName}</PatchName>
  <RhythmType>${rhythmType}</RhythmType>
  <StopMode>${stopMode}</StopMode>
  <SettingsVersion>${updatedSettingsVersion}</SettingsVersion>
  <ID>${updatedPatchID}</ID>
  <OriginID>${updatedOriginID}</OriginID>
  <Metadata/>
</JamManPatch>`.trim();

    fs.writeFileSync(path.join(patchDir, "patch.xml"), patchXml, "utf-8");

    // Overwrite each phrase
    const existingPhraseDirs = fs
      .readdirSync(patchDir)
      .filter((d) => /^Phrase[A-Z]$/.test(d));

    const updatedPhraseDirs = phrases.map((p: any) => p.name);
    const toDelete = existingPhraseDirs.filter(
      (d) => !updatedPhraseDirs.includes(d)
    );

    toDelete.forEach((phraseName) => {
      fse.removeSync(path.join(patchDir, phraseName));
    });

    // 🔄 Write/Update phrases
    for (const phrase of phrases) {
      const phraseDir = path.join(patchDir, phrase.name);
      fse.ensureDirSync(phraseDir);

      const phraseXmlPath = path.join(phraseDir, "phrase.xml");

      // Try to reuse existing ID and OriginID
      let phraseId = uuidv4();
      let originId = uuidv4();

      if (fs.existsSync(phraseXmlPath)) {
        const existingPhraseXml = fs.readFileSync(phraseXmlPath, "utf-8");
        const parsed = await new xml2js.Parser().parseStringPromise(
          existingPhraseXml
        );
        phraseId = parsed.JamManPhrase?.ID?.[0] ?? phraseId;
        originId = parsed.JamManPhrase?.OriginID?.[0] ?? originId;
      }

      // If wavPath is not already in that location, copy it
      const destWav = path.join(phraseDir, "phrase.wav");
      if (
        phrase.wavPath &&
        path.resolve(phrase.wavPath) !== path.resolve(destWav)
      ) {
        fse.copyFileSync(phrase.wavPath, destWav);
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

      fs.writeFileSync(phraseXmlPath, phraseXml, "utf-8");
    }

    return true;
  });

  ipcMain.handle(
    "patches:delete",
    async (_event, directory: string, basePath: string) => {
      const patchPath = path.join(basePath, directory);
      if (!fs.existsSync(patchPath)) {
        throw new Error("Patch not found");
      }

      await fse.remove(patchPath);
      return true;
    }
  );

  await moduleRunner;
}
