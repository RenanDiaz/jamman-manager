/**
 * Single registration point for IPC handlers.
 *
 * `createTrustedIpcHandle` returns a drop-in replacement for `ipcMain.handle`
 * that runs `assertTrustedSender` before the listener. Untrusted calls are
 * rejected without running the operation.
 *
 * @module security/trustedIpc
 */

import { assertTrustedSender, type RendererLocation, type SenderEvent } from './trustedSender.js';

type InvokeListener<E extends SenderEvent> = (event: E, ...args: any[]) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any

export type IpcMainLike<E extends SenderEvent> = {
  handle(channel: string, listener: InvokeListener<E>): void;
};

export type TrustedIpcLogger = { warn(...args: unknown[]): void };

export function createTrustedIpcHandle<E extends SenderEvent>(
  ipcMain: IpcMainLike<E>,
  renderer: RendererLocation,
  log: TrustedIpcLogger = console,
) {
  return function handle(channel: string, listener: InvokeListener<E>): void {
    ipcMain.handle(channel, (event, ...args) => {
      try {
        assertTrustedSender(event, renderer);
      } catch (error) {
        log.warn(`IPC "${channel}" rejected:`, error instanceof Error ? error.message : error);
        throw error;
      }
      return listener(event, ...args);
    });
  };
}
