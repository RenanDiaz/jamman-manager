/**
 * Starts the real main process (`initApp`) against the Electron test double
 * and gives tests a way to call its IPC handlers as the renderer would.
 *
 * The test file must mock the edges before importing this module:
 *
 *   vi.mock('electron', () => import('./test-utils/electronMock.js'));
 *   vi.mock('electron-log', () => import('./test-utils/logMock.js'));
 *   vi.mock('electron-updater', () => import('./test-utils/updaterMock.js'));
 *
 * @module test-utils/appHarness
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dialog, electronState, resetElectronState } from './electronMock.js';
import { initApp } from '../index.js';

export type AppHarness = {
  /** Temporary directory holding `userData`, `documents` and the fake renderer. */
  tmp: string;
  userData: string;
  documents: string;
  /** Calls a handler as the app's own page (trusted sender). */
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  /** Calls a handler from an arbitrary frame URL. */
  invokeFrom: <T = unknown>(url: string, channel: string, ...args: unknown[]) => Promise<T>;
  /** Channels registered by `initApp`. */
  channels: () => string[];
  /** Approves `folder` the way the user does: through `dialog:selectFolder`. */
  selectFolder: (folder: string) => Promise<string | undefined>;
  /** Grants `file` the way the user does: through `dialog:selectFile`. */
  selectFile: (file: string) => Promise<string | null>;
  /** Makes the next save dialog answer `filePath` (or cancel when undefined). */
  nextSavePath: (filePath: string | undefined) => void;
  cleanup: () => void;
};

export async function startApp({
  ready = false,
  userData: existingUserData,
}: {
  ready?: boolean;
  /** Reuse another instance's `userData` (simulates a restart). */
  userData?: string;
} = {}): Promise<AppHarness> {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamman-app-')));
  const userData = existingUserData ?? path.join(tmp, 'userData');
  const documents = path.join(tmp, 'documents');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(documents, { recursive: true });
  const rendererHtml = path.join(tmp, 'renderer', 'index.html');

  resetElectronState({ userData, documents });
  electronState.ready = ready;

  // initApp only resolves once the window module is done, which needs
  // `app.whenReady()`. Handlers are registered synchronously before that.
  void initApp({
    preload: { path: path.join(tmp, 'preload.js') },
    renderer: { path: rendererHtml },
  });

  const trustedUrl = pathToFileURL(rendererHtml).href;

  const invokeFrom = async <T>(url: string, channel: string, ...args: unknown[]): Promise<T> => {
    const listener = electronState.handlers.get(channel);
    if (!listener) throw new Error(`No IPC handler registered for "${channel}"`);
    const event = { senderFrame: { url, parent: null } };
    return (await listener(event, ...args)) as T;
  };
  const invoke = <T>(channel: string, ...args: unknown[]) =>
    invokeFrom<T>(trustedUrl, channel, ...args);

  return {
    tmp,
    userData,
    documents,
    invoke,
    invokeFrom,
    channels: () => [...electronState.handlers.keys()].sort(),
    selectFolder: folder => {
      dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [folder] });
      return invoke<string | undefined>('dialog:selectFolder');
    },
    selectFile: file => {
      dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
      return invoke<string | null>('dialog:selectFile');
    },
    nextSavePath: filePath => {
      dialog.showSaveDialog.mockResolvedValueOnce(
        filePath ? { canceled: false, filePath } : { canceled: true, filePath: undefined },
      );
    },
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}
