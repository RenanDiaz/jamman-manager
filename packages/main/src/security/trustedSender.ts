/**
 * IPC sender verification
 *
 * Every `ipcMain.handle` listener must check who is calling: only the app's
 * own renderer page, loaded in a top-level frame, may use the IPC API.
 *
 * - Development: the page is served by the Vite dev server, so the sender's
 *   origin must equal the dev server origin.
 * - Production: the page is the packaged `index.html`, so the sender URL must
 *   be a `file:` URL that points exactly to that file.
 *
 * @see https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages
 * @module security/trustedSender
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The renderer location, as given to `initApp` (`AppInitConfig['renderer']`). */
export type RendererLocation = { path: string } | URL;

/**
 * Minimal shape of `IpcMainInvokeEvent` that the check needs, so it can be
 * tested with plain objects.
 */
export type SenderEvent = {
  senderFrame?: { url: string; parent?: unknown } | null;
};

export class UntrustedSenderError extends Error {
  constructor(url: string | undefined) {
    super(`Blocked IPC call from untrusted sender: ${url ?? '<unknown>'}`);
    this.name = 'UntrustedSenderError';
  }
}

/**
 * Returns true when `url` belongs to the app's renderer page.
 */
export function isTrustedRendererUrl(url: string, renderer: RendererLocation): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (renderer instanceof URL) {
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === renderer.origin
    );
  }

  if (parsed.protocol !== 'file:' || (parsed.host !== '' && parsed.host !== 'localhost')) {
    return false;
  }

  try {
    // Compare file system paths, not URL strings, so percent-encoding
    // differences between Chromium and Node do not matter.
    parsed.hash = '';
    parsed.search = '';
    return path.resolve(fileURLToPath(parsed)) === path.resolve(renderer.path);
  } catch {
    return false;
  }
}

/**
 * Throws `UntrustedSenderError` unless the event comes from the app's renderer
 * page in a top-level frame.
 */
export function assertTrustedSender(event: SenderEvent, renderer: RendererLocation): void {
  const frame = event?.senderFrame;
  const url = frame?.url;

  // Sub-frames (iframes) are never trusted, even from the same origin.
  const isTopLevel = frame != null && (frame.parent === null || frame.parent === undefined);

  if (!frame || typeof url !== 'string' || !isTopLevel || !isTrustedRendererUrl(url, renderer)) {
    throw new UntrustedSenderError(url);
  }
}
