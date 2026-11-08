import type { AppInitConfig } from './AppInitConfig.js';
import { createModuleRunner } from './ModuleRunner.js';
import { disallowMultipleAppInstance } from './modules/SingleInstanceApp.js';
import { createWindowManagerModule } from './modules/WindowManager.js';
import { terminateAppOnLastWindowClose } from './modules/ApplicationTerminatorOnLastWindowClose.js';
import { hardwareAccelerationMode } from './modules/HardwareAccelerationModule.js';
import { autoUpdater } from './modules/AutoUpdater.js';
import { allowInternalOrigins } from './modules/BlockNotAllowdOrigins.js';
import { allowExternalUrls } from './modules/ExternalUrls.js';
import { app, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import fse from 'fs-extra';
import log from 'electron-log';
import { lockManager } from './LockManager.js';
import { operationQueue } from './OperationQueue.js';
import { BackupManager } from './BackupManager.js';
import { PlaylistManager } from './PlaylistManager.js';
import { PatchRestore } from './PatchRestore.js';
import { FolderAccess } from './security/folderAccess.js';
import { installContentSecurityPolicy } from './security/contentSecurityPolicy.js';
import { handleJammanProtocol, registerJammanScheme } from './ipc/audio.js';
import { PatchCache } from './ipc/patches.js';
import { registerIpcHandlers } from './ipc/register.js';
import { PedalManager } from './usb/PedalManager.js';
import { findJamManPorts, openSerialTransport } from './usb/serialTransport.js';

export async function initApp(initConfig: AppInitConfig) {
  // CRITICAL: the custom scheme must be registered before app.ready fires.
  registerJammanScheme(protocol);
  log.info('Custom protocol "jamman" registered as privileged');

  // Security: the only folder the renderer may work on is the one the user
  // picked in the native dialog (persisted so auto-load survives restarts).
  const folderAccess = new FolderAccess({
    storeFile: path.join(app.getPath('userData'), 'folder-access.json'),
    log,
  });
  folderAccess.load();

  // The pedal over USB. Its only local state is the cache of downloaded WAVs.
  const pedal = new PedalManager({
    findPorts: () => findJamManPorts(),
    openTransport: portPath => openSerialTransport(portPath),
    cacheRoot: path.join(app.getPath('userData'), 'pedal-cache'),
    log,
  });
  const sendToWindows = (channel: 'pedal:changed' | 'pedal:progress', payload: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    }
  };
  pedal.on('change', info => sendToWindows('pedal:changed', info));
  pedal.on('progress', progress => sendToWindows('pedal:progress', progress));
  app.on('will-quit', () => {
    pedal.disconnect().catch(error => log.warn('Failed to disconnect the pedal:', error));
  });

  // Registered before the window module so the CSP and the protocol handler
  // exist before the first page request.
  app.whenReady().then(() => {
    installContentSecurityPolicy(session.defaultSession, {
      devServerOrigin: initConfig.renderer instanceof URL ? initConfig.renderer.origin : undefined,
    });

    // Security: the renderer needs no web permission (camera, mic, notifications…).
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );

    handleJammanProtocol(protocol, { folderAccess, log, pedal });
    log.info('Protocol handler "jamman" registered successfully');
  });

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
    .init(autoUpdater({ logger: log }))

    // Install DevTools extension if needed
    // .init(chromeDevToolsExtension({extension: 'VUEJS3_DEVTOOLS'}))

    // Security: navigation is denied except to the dev server in development.
    .init(
      allowInternalOrigins(
        new Set(initConfig.renderer instanceof URL ? [initConfig.renderer.origin] : []),
      ),
    )
    // Security: window.open is always denied. The app links to no external
    // site, so no URL is opened in the system browser either.
    .init(allowExternalUrls(new Set<string>()));

  // Undo snapshots live outside the SD folder. The undo history is in memory,
  // so snapshots from a previous run are unreachable: purge them.
  const patchRestore = new PatchRestore({
    snapshotRoot: path.join(app.getPath('userData'), 'undo-snapshots'),
    withLock: (key, fn) => lockManager.withLock(key, fn),
    logger: log,
  });
  patchRestore.purgeAll().catch(error => log.warn('Failed to purge undo snapshots:', error));

  // Security: every handler checks that the caller is the app's own page.
  registerIpcHandlers({
    ipcMain,
    renderer: initConfig.renderer,
    fs,
    fse,
    log,
    dialog,
    app,
    folderAccess,
    operationQueue,
    lockManager,
    patchCache: new PatchCache(),
    backupManager: BackupManager,
    playlistManager: PlaylistManager,
    patchRestore,
    pedal,
  });

  await moduleRunner;
}
