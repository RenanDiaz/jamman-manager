/**
 * Test double for the `electron` module, used only at the edges.
 *
 * Tests replace `electron` with this module (`vi.mock('electron', () => import(...))`)
 * and then drive the real main-process code: `initApp` registers its IPC
 * handlers on `ipcMain`, and the tests call them through `invoke()` with a fake
 * event whose sender is the app's own page.
 *
 * Nothing here reimplements app logic. It only records what the code asks
 * Electron to do (handlers, dialogs, protocol registration) and answers with
 * values the test controls.
 *
 * @module test-utils/electronMock
 */
import { vi } from 'vitest';

type Listener = (event: unknown, ...args: unknown[]) => unknown;

/** Mutable state shared by the mock and the tests. */
export const electronState = {
  handlers: new Map<string, Listener>(),
  paths: {} as Record<string, string>,
  version: '9.9.9-test',
  /** When false, `app.whenReady()` never resolves (window and protocol setup never run). */
  ready: false,
};

export function resetElectronState(paths: Record<string, string>): void {
  electronState.handlers.clear();
  electronState.paths = paths;
  electronState.ready = false;
  vi.clearAllMocks();
}

export const app = {
  whenReady: vi.fn(() =>
    electronState.ready ? Promise.resolve() : new Promise<void>(() => undefined),
  ),
  getPath: vi.fn((name: string) => {
    const p = electronState.paths[name];
    if (!p) throw new Error(`electronMock: no path configured for "${name}"`);
    return p;
  }),
  getVersion: vi.fn(() => electronState.version),
  on: vi.fn(),
  quit: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => true),
  disableHardwareAcceleration: vi.fn(),
};

export const ipcMain = {
  handle: vi.fn((channel: string, listener: Listener) => {
    electronState.handlers.set(channel, listener);
  }),
  removeHandler: vi.fn((channel: string) => electronState.handlers.delete(channel)),
};

export const dialog = {
  showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  showSaveDialog: vi.fn(async () => ({
    canceled: true,
    filePath: undefined as string | undefined,
  })),
};

export const protocol = {
  registerSchemesAsPrivileged: vi.fn(),
  handle: vi.fn(),
};

export const session = {
  defaultSession: {
    webRequest: { onHeadersReceived: vi.fn() },
    setPermissionRequestHandler: vi.fn(),
  },
};

export class BrowserWindow {
  static getAllWindows = vi.fn((): BrowserWindow[] => []);
  webContents = { openDevTools: vi.fn(), send: vi.fn() };
  constructor(public options: unknown) {}
  loadURL = vi.fn(async () => undefined);
  loadFile = vi.fn(async () => undefined);
  isDestroyed = () => false;
  isMinimized = () => false;
  restore = vi.fn();
  show = vi.fn();
  focus = vi.fn();
}

export const nativeImage = { createFromPath: vi.fn(() => ({})) };
export const shell = { openExternal: vi.fn() };
export const net = { fetch: vi.fn() };

export default {
  app,
  ipcMain,
  dialog,
  protocol,
  session,
  BrowserWindow,
  nativeImage,
  shell,
  net,
};
