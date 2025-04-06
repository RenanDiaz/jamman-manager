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
    const jammanPath = path.join(folderPath, "JAMMAN", "JamManStereo");
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
          patch: patchData,
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

  await moduleRunner;
}
