/**
 * Error handling shared by the IPC handlers.
 *
 * Handlers report failures to the renderer as `Error`s whose message starts
 * with what failed ("Failed to read patches from folder: …"), after logging
 * the original error.
 *
 * @module ipc/errors
 */
import type { IpcLogger } from './deps.js';

/** Message of an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Logs `error` under `logLabel` and returns an `Error` for the renderer whose
 * message is `"<prefix>: <original message>"`.
 */
export function ipcError(log: IpcLogger, logLabel: string, prefix: string, error: unknown): Error {
  log.error(logLabel, error);
  return new Error(`${prefix}: ${errorMessage(error)}`);
}

/**
 * Makes sure what a handler throws reaches the renderer as an `Error` (Electron
 * only forwards the message of `Error`s). `Error`s pass through unchanged.
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
