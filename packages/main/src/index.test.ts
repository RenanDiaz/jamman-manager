/**
 * Wiring of the main process: what `initApp` registers with Electron.
 *
 * Runs the real `initApp` with Electron replaced by a test double; the
 * behaviour of each handler is covered in `ipc.integration.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => import('./test-utils/electronMock.js'));
vi.mock('electron-log', () => import('./test-utils/logMock.js'));
vi.mock('electron-updater', () => import('./test-utils/updaterMock.js'));

import { protocol, session } from './test-utils/electronMock.js';
import { startApp, type AppHarness } from './test-utils/appHarness.js';

/** Every channel the renderer can call. Changing this list changes the IPC API. */
const CHANNELS = [
  'audio:readFile',
  'audio:validateWav',
  'backup:create',
  'backup:restore',
  'backup:selectFile',
  'backup:validate',
  'dialog:selectFile',
  'dialog:selectFolder',
  'folder:getSize',
  'operation-queue:statistics',
  'operation-queue:status',
  'patches:create',
  'patches:delete',
  'patches:deleteBatch',
  'patches:exportPDF',
  'patches:exportTXT',
  'patches:read',
  'patches:reorder',
  'patches:update',
  'phrase:getAudioURL',
  'playlists:addPatches',
  'playlists:create',
  'playlists:delete',
  'playlists:export',
  'playlists:load',
  'playlists:removePatches',
  'playlists:reorderPatches',
  'playlists:update',
  'undo:createSnapshot',
  'undo:discardSnapshot',
  'undo:restoreSnapshot',
];

let app: AppHarness | undefined;

afterEach(() => {
  app?.cleanup();
  app = undefined;
});

describe('initApp', () => {
  it('registers exactly the IPC channels of the API', async () => {
    app = await startApp();
    expect(app.channels()).toEqual(CHANNELS);
  });

  it('registers the jamman scheme as privileged before the app is ready', async () => {
    app = await startApp();
    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      { scheme: 'jamman', privileges: { supportFetchAPI: true, stream: true } },
    ]);
    expect(protocol.handle).not.toHaveBeenCalled();
  });

  it('installs the CSP, denies permissions and serves jamman:// once ready', async () => {
    app = await startApp({ ready: true });
    await vi.waitFor(() =>
      expect(protocol.handle).toHaveBeenCalledWith('jamman', expect.any(Function)),
    );

    expect(session.defaultSession.webRequest.onHeadersReceived).toHaveBeenCalled();
    const [permissionHandler] = session.defaultSession.setPermissionRequestHandler.mock
      .calls[0] as [
      (contents: unknown, permission: string, callback: (granted: boolean) => void) => void,
    ];
    const callback = vi.fn();
    permissionHandler({}, 'media', callback);
    expect(callback).toHaveBeenCalledWith(false);
  });

  it.each(CHANNELS)('rejects %s from an untrusted frame', async channel => {
    app = await startApp();
    await expect(app.invokeFrom('https://evil.example/', channel)).rejects.toThrow(
      'Blocked IPC call from untrusted sender',
    );
  });
});
