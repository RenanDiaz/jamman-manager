/**
 * Central registration of every IPC handler.
 *
 * - Each channel of the contract (`@app/preload/ipc-contract`) must have a
 *   handler: `createIpcHandlers` does not compile otherwise.
 * - Every handler is registered through `createTrustedIpcHandle`, so calls from
 *   any frame other than the app's own page are rejected before it runs.
 * - Whatever a handler throws reaches the renderer as an `Error`.
 *
 * @module ipc/register
 */
import type { IpcChannel, IpcHandlers } from '@app/preload/ipc-contract';
import { createTrustedIpcHandle, type IpcMainLike } from '../security/trustedIpc.js';
import type { RendererLocation, SenderEvent } from '../security/trustedSender.js';
import { createAudioHandlers } from './audio.js';
import { createBackupHandlers } from './backup.js';
import type { IpcDeps } from './deps.js';
import { createDialogHandlers } from './dialogs.js';
import { toError } from './errors.js';
import { createExportHandlers } from './export.js';
import { createPatchHandlers } from './patches.js';
import { createPlaylistHandlers } from './playlists.js';
import { createQueueHandlers } from './queue.js';
import { createUndoHandlers } from './undo.js';

/** The handler of every channel, built from its dependencies. */
export function createIpcHandlers(deps: IpcDeps): IpcHandlers<IpcChannel> {
  return {
    ...createDialogHandlers(deps),
    ...createPatchHandlers(deps),
    ...createAudioHandlers(deps),
    ...createExportHandlers(deps),
    ...createBackupHandlers(deps),
    ...createUndoHandlers(deps),
    ...createPlaylistHandlers(deps),
    ...createQueueHandlers(deps),
  };
}

export type RegisterIpcDeps<E extends SenderEvent> = IpcDeps & {
  ipcMain: IpcMainLike<E>;
  /** Where the app's page is loaded from; only that page may call the handlers. */
  renderer: RendererLocation;
};

/** Registers every handler on `ipcMain`, behind the trusted-sender check. */
export function registerIpcHandlers<E extends SenderEvent>({
  ipcMain,
  renderer,
  ...deps
}: RegisterIpcDeps<E>): void {
  const handle = createTrustedIpcHandle(ipcMain, renderer, deps.log);
  const handlers = createIpcHandlers(deps);

  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    // Arguments come from the renderer and are untrusted: each handler checks
    // them (folder access, typeof, name patterns) before using them. A schema
    // validator (e.g. zod) per channel would plug in here.
    const handler = handlers[channel] as (...args: unknown[]) => unknown;
    handle(channel, async (_event, ...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        throw toError(error);
      }
    });
  }
}
