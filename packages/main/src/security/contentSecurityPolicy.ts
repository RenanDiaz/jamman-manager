/**
 * Content Security Policy for the renderer.
 *
 * Sent as a response header from the main process (`onHeadersReceived`), which
 * also covers `file://` pages in production. Kept here, in one place, so it is
 * the same for development and production except for what the Vite dev server
 * needs.
 *
 * What the renderer needs:
 * - `script-src 'self'` – the bundled scripts. In development the React
 *   plugin injects an inline "react-refresh" preamble, so development alone
 *   adds `'unsafe-inline'`.
 * - `style-src 'self' 'unsafe-inline'` – the bundled stylesheets come from
 *   'self', but Vite's dev CSS injects `<style>` tags, and the components and
 *   dnd-kit set inline `style` attributes (CSS custom properties, drag
 *   transforms).
 * - `img-src 'self' data:` – the app icon, plus small images Vite inlines as
 *   data URIs.
 * - `font-src 'self' data:` – the bundled Barlow fonts (@fontsource), plus any
 *   font file small enough for Vite to inline as a data URI.
 * - `media-src 'self' jamman:` – WAV playback through the custom protocol.
 * - `connect-src 'self'` – plus the dev server's WebSocket for HMR in
 *   development.
 *
 * @module security/contentSecurityPolicy
 */

import { JAMMAN_SCHEME } from './jammanProtocol.js';

export type CspOptions = {
  /** Origin of the Vite dev server, only in development. */
  devServerOrigin?: string;
};

export function buildContentSecurityPolicy({ devServerOrigin }: CspOptions = {}): string {
  const isDev = !!devServerOrigin;

  let devSocket: string | undefined;
  if (devServerOrigin) {
    const url = new URL(devServerOrigin);
    devSocket = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...(isDev ? ["'unsafe-inline'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", `${JAMMAN_SCHEME}:`],
    'connect-src': ["'self'", ...(devSocket ? [devSocket] : [])],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'worker-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

type HeadersDetails = {
  resourceType: string;
  responseHeaders?: Record<string, string[] | string>;
};

type HeadersCallback = (response: { responseHeaders: Record<string, string[] | string> }) => void;

export type SessionLike = {
  webRequest: {
    onHeadersReceived(listener: (details: HeadersDetails, callback: HeadersCallback) => void): void;
  };
};

/**
 * Adds the CSP header to every document (main frame and sub-frame) response of
 * `session`, replacing any CSP the server sent.
 */
export function installContentSecurityPolicy(session: SessionLike, options: CspOptions = {}) {
  const policy = buildContentSecurityPolicy(options);

  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...(details.responseHeaders ?? {}) };

    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      for (const name of Object.keys(responseHeaders)) {
        if (name.toLowerCase() === 'content-security-policy') {
          delete responseHeaders[name];
        }
      }
      responseHeaders['Content-Security-Policy'] = [policy];
    }

    callback({ responseHeaders });
  });

  return policy;
}
