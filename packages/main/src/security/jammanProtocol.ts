/**
 * `jamman://` protocol handler
 *
 * Serves WAV files from the JamMan SD folder the user approved through the
 * native folder dialog (see `FolderAccess`) to `<audio>` elements in the
 * renderer. Everything else is refused with 403.
 *
 * The handler is pure: the allowed root and the file system functions are
 * injected, so it can be unit tested without Electron. `index.ts` only wires it
 * into `protocol.handle`.
 *
 * Why the handler serves byte ranges itself instead of `net.fetch(file://…)`:
 * on Electron 39, `net.fetch` of a `file:` URL honours the `Range` header but
 * answers `200` without `Content-Range`, so Chromium's media stack cannot seek
 * reliably. Answering `206 Partial Content` here keeps seeking working.
 *
 * See docs/adr/0001-jamman-protocol.md.
 *
 * @module security/jammanProtocol
 */

import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { PathValidator } from '../PathValidator.js';

export const JAMMAN_SCHEME = 'jamman';
/**
 * The scheme is registered as `standard`, so Chromium parses what follows `//` as a host.
 * The file path goes in the URL path, percent-encoded as one segment, under a fixed host.
 */
export const JAMMAN_HOST = 'audio';
const URL_PREFIX = `${JAMMAN_SCHEME}://${JAMMAN_HOST}/`;
const ALLOWED_EXTENSIONS = ['.wav'];

/**
 * File system functions the handler needs. Injected for tests.
 */
export type JammanProtocolFs = {
  realpath(p: string): Promise<string>;
  stat(p: string): Promise<{ isFile(): boolean; size: number }>;
  /** Opens a byte stream over [start, end] (inclusive). */
  openStream(p: string, range: { start: number; end: number }): ReadableStream<Uint8Array>;
};

export type JammanProtocolLogger = {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

export type JammanProtocolDeps = {
  /** Returns the approved SD folder, or null when none has been approved yet. */
  getAllowedRoot: () => string | null;
  fs?: JammanProtocolFs;
  log?: JammanProtocolLogger;
};

export const defaultJammanProtocolFs: JammanProtocolFs = {
  realpath: p => nodeFs.promises.realpath(p),
  stat: p => nodeFs.promises.stat(p),
  openStream: (p, { start, end }) =>
    Readable.toWeb(nodeFs.createReadStream(p, { start, end })) as ReadableStream<Uint8Array>,
};

/**
 * Builds the `jamman://` URL the renderer uses for an absolute file path.
 */
export function toJammanUrl(filePath: string): string {
  return `${URL_PREFIX}${encodeURIComponent(filePath)}`;
}

/**
 * Extracts the file path from a `jamman://` URL. Returns null when the URL is
 * not a jamman URL or cannot be decoded.
 */
export function parseJammanUrl(url: string): string | null {
  if (typeof url !== 'string' || !url.startsWith(URL_PREFIX)) {
    return null;
  }

  // `toJammanUrl` encodes the whole path with encodeURIComponent, so a raw
  // `?` or `#` can only be a query/fragment added by Chromium, and a raw `/`
  // can only be a trailing slash. Drop them.
  let encoded = url.slice(URL_PREFIX.length);
  encoded = encoded.split(/[?#]/, 1)[0];
  if (encoded.endsWith('/')) {
    encoded = encoded.slice(0, -1);
  }
  if (encoded.includes('/')) {
    return null;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * Parses a single `bytes=` range. Multi-range requests are not supported and
 * are answered with the full file, which RFC 9110 allows.
 *
 * @returns the inclusive range, `null` when the header is absent or ignored,
 *   or `'unsatisfiable'` when it is syntactically valid but out of bounds.
 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return null;
  }

  const [, startText, endText] = match;
  if (startText === '' && endText === '') {
    return null;
  }

  let start: number;
  let end: number;

  if (startText === '') {
    // Suffix range: last N bytes
    const suffix = Number(endText);
    if (suffix === 0) {
      return 'unsatisfiable';
    }
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  }

  if (start >= size || start > end) {
    return 'unsatisfiable';
  }

  return { start, end };
}

function textResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain', ...headers },
  });
}

function isMissingFileError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Creates the `protocol.handle('jamman', …)` handler.
 */
export function createJammanProtocolHandler(deps: JammanProtocolDeps) {
  const fs = deps.fs ?? defaultJammanProtocolFs;
  const log = deps.log ?? console;

  const forbidden = (reason: string, detail: unknown) => {
    log.warn(`jamman:// request denied (${reason}):`, detail);
    return textResponse(403, 'Forbidden');
  };

  return async function handleJammanRequest(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return textResponse(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      }

      const requested = parseJammanUrl(request.url);
      if (requested === null || requested.trim() === '') {
        return textResponse(400, 'Empty or invalid file path');
      }

      const root = deps.getAllowedRoot();
      if (!root) {
        return forbidden('no approved folder', requested);
      }

      if (!path.isAbsolute(requested) || requested.includes('\0')) {
        return forbidden('not an absolute path', requested);
      }

      // 1. Lexical checks on the normalised path (catches `..` traversal).
      const resolved = path.resolve(requested);
      if (!PathValidator.hasAllowedExtension(resolved, ALLOWED_EXTENSIONS)) {
        return forbidden('extension', resolved);
      }
      if (!PathValidator.isPathSafe(resolved, root)) {
        return forbidden('outside approved folder', resolved);
      }

      // 2. Same checks on the real path (catches symlinks pointing elsewhere).
      let realFile: string;
      let realRoot: string;
      try {
        realRoot = await fs.realpath(root);
        realFile = await fs.realpath(resolved);
      } catch (error) {
        if (isMissingFileError(error)) {
          return textResponse(404, 'File not found');
        }
        throw error;
      }

      if (!PathValidator.hasAllowedExtension(realFile, ALLOWED_EXTENSIONS)) {
        return forbidden('real path extension', realFile);
      }
      if (!PathValidator.isPathSafe(realFile, realRoot)) {
        return forbidden('real path outside approved folder', realFile);
      }

      const stats = await fs.stat(realFile);
      if (!stats.isFile()) {
        return forbidden('not a regular file', realFile);
      }

      const size = stats.size;
      const baseHeaders: Record<string, string> = {
        'Content-Type': 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      };

      const range = parseRange(request.headers.get('range'), size);
      if (range === 'unsatisfiable') {
        return textResponse(416, 'Range not satisfiable', { 'Content-Range': `bytes */${size}` });
      }

      const isHead = request.method === 'HEAD';

      if (range === null) {
        const body =
          isHead || size === 0 ? null : fs.openStream(realFile, { start: 0, end: size - 1 });
        return new Response(body, {
          status: 200,
          headers: { ...baseHeaders, 'Content-Length': String(size) },
        });
      }

      const body = isHead ? null : fs.openStream(realFile, range);
      return new Response(body, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        },
      });
    } catch (error) {
      log.error('Error serving jamman:// request:', error);
      return textResponse(500, 'Internal server error');
    }
  };
}
