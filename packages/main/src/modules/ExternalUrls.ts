import { AppModule } from '../AppModule.js';
import { ModuleContext } from '../ModuleContext.js';
import { shell } from 'electron';
import { URL } from 'node:url';

/**
 * Denies every `window.open` / `target="_blank"` request (deny by default).
 *
 * New Electron windows are never created. A URL is handed to the system browser with
 * `shell.openExternal` only when it is `https:` and its origin is on the allowlist.
 * The app currently links to no external site, so the allowlist passed in `index.ts` is empty.
 *
 * @see https://www.electronjs.org/docs/latest/tutorial/security#14-disable-or-limit-creation-of-new-windows
 */
export class ExternalUrls implements AppModule {
  readonly #externalUrls: Set<string>;

  constructor(externalUrls: Set<string>) {
    this.#externalUrls = externalUrls;
  }

  isAllowed(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && this.#externalUrls.has(parsed.origin);
    } catch {
      return false;
    }
  }

  enable({ app }: ModuleContext): Promise<void> | void {
    app.on('web-contents-created', (_, contents) => {
      contents.setWindowOpenHandler(({ url }) => {
        if (this.isAllowed(url)) {
          shell.openExternal(url).catch(console.error);
        } else if (import.meta.env.DEV) {
          console.warn(`Blocked the opening of a disallowed URL: ${url}`);
        }

        // Prevent creating a new window.
        return { action: 'deny' };
      });
    });
  }
}

export function allowExternalUrls(...args: ConstructorParameters<typeof ExternalUrls>) {
  return new ExternalUrls(...args);
}
