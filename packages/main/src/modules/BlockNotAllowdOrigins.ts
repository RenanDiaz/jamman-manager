import { AbstractSecurityRule } from './AbstractSecurityModule.js';
import * as Electron from 'electron';
import { URL } from 'node:url';

/**
 * Returns the origin of `url`, or null when it cannot be parsed.
 */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Block navigation to origins not on the allowlist (deny by default).
 *
 * Navigation exploits are quite common. If an attacker can convince the app to navigate away from its current page,
 * they can possibly force the app to open arbitrary web resources/websites on the web.
 *
 * In production the allowlist is empty: the renderer is a single page loaded with `loadFile`, so every
 * navigation (including to other `file://` pages, whose origin is the opaque "null") is blocked.
 * In development only the Vite dev server origin is allowed.
 *
 * @see https://www.electronjs.org/docs/latest/tutorial/security#13-disable-or-limit-navigation
 */
export class BlockNotAllowedOrigins extends AbstractSecurityRule {
  readonly #allowedOrigins: Set<string>;

  constructor(allowedOrigins: Set<string> = new Set()) {
    super();
    this.#allowedOrigins = structuredClone(allowedOrigins);
  }

  isAllowed(url: string): boolean {
    const origin = originOf(url);
    return origin !== null && origin !== 'null' && this.#allowedOrigins.has(origin);
  }

  applyRule(contents: Electron.WebContents): Promise<void> | void {
    const guard = (event: Electron.Event, url: string) => {
      if (this.isAllowed(url)) {
        return;
      }

      // Prevent navigation
      event.preventDefault();

      if (import.meta.env.DEV) {
        console.warn(`Blocked navigating to disallowed origin: ${originOf(url) ?? url}`);
      }
    };

    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);

    // The app never embeds <webview>; refuse it even if webviewTag were re-enabled.
    contents.on('will-attach-webview', event => event.preventDefault());
  }
}

export function allowInternalOrigins(
  ...args: ConstructorParameters<typeof BlockNotAllowedOrigins>
): BlockNotAllowedOrigins {
  return new BlockNotAllowedOrigins(...args);
}
