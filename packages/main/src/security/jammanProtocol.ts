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
import { parseWavPath, type PedalWavRef } from '../usb/pedalPaths.js';

export const JAMMAN_SCHEME = 'jamman';
/**
 * The scheme is registered as `standard`, so Chromium parses what follows `//` as a host.
 * The file path goes in the URL path, percent-encoded as one segment, under a fixed host.
 */
export const JAMMAN_HOST = 'audio';
const URL_PREFIX = `${JAMMAN_SCHEME}://${JAMMAN_HOST}/`;
/** Audio of a pedal connected over USB: the path is a `jamman-pedal://` phrase WAV path. */
export const JAMMAN_PEDAL_HOST = 'pedal';
const PEDAL_URL_PREFIX = `${JAMMAN_SCHEME}://${JAMMAN_PEDAL_HOST}/`;
const ALLOWED_EXTENSIONS = ['.wav'];

type ByteRange = { start: number; end: number };

/**
 * Serves phrase WAVs of a pedal connected over USB. `pickRange` receives the
 * file size (known only after asking the pedal) and returns the range to send.
 */
export type JammanPedalAudio = {
  openWavStream(
    ref: PedalWavRef,
    pickRange: (size: number) => ByteRange | null | 'unsatisfiable',
  ): Promise<
    | { size: number; range: 'unsatisfiable' }
    | { size: number; range: ByteRange | null; stream: ReadableStream<Uint8Array> | null }
  >;
};

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
  /** Audio of the pedal connected over USB; without it `jamman://pedal/` URLs get 404. */
  pedal?: JammanPedalAudio;
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

/** Builds the `jamman://pedal/…` URL for a pedal phrase WAV path. */
export function toJammanPedalUrl(pedalWavPath: string): string {
  return `${PEDAL_URL_PREFIX}${encodeURIComponent(pedalWavPath)}`;
}

/** The phrase WAV a `jamman://pedal/…` URL names, or null. */
export function parseJammanPedalUrl(url: string): PedalWavRef | null {
  return parseWavPath(decodeSingleSegment(url, PEDAL_URL_PREFIX));
}

/**
 * Extracts the file path from a `jamman://` URL. Returns null when the URL is
 * not a jamman URL or cannot be decoded.
 */
export function parseJammanUrl(url: string): string | null {
  return decodeSingleSegment(url, URL_PREFIX);
}

function decodeSingleSegment(url: string, prefix: string): string | null {
  if (typeof url !== 'string' || !url.startsWith(prefix)) {
    return null;
  }

  // The path is encoded whole with encodeURIComponent, so a raw `?` or `#`
  // can only be a query/fragment added by Chromium, and a raw `/` can only be
  // a trailing slash. Drop them.
  let encoded = url.slice(prefix.length);
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

function unsatisfiable(size: number) {
  return textResponse(416, 'Range not satisfiable', { 'Content-Range': `bytes */${size}` });
}

/** `200` with the whole file when `range` is null, `206 Partial Content` otherwise. */
function wavResponse(
  size: number,
  range: ByteRange | null,
  body: ReadableStream<Uint8Array> | null,
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'audio/wav',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  if (range === null) {
    return new Response(body, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) },
    });
  }
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    },
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

  /**
   * `jamman://pedal/<phrase WAV path>`: only the exact `PatchNN/PhraseX/phrase.wav`
   * shape is accepted, so nothing else on the device can be named.
   */
  const servePedal = async (request: Request): Promise<Response> => {
    const ref = parseJammanPedalUrl(request.url);
    if (!ref) {
      return forbidden('not a pedal phrase WAV', request.url);
    }
    if (!deps.pedal) {
      return textResponse(404, 'No pedal connected');
    }

    const isHead = request.method === 'HEAD';
    let opened: Awaited<ReturnType<JammanPedalAudio['openWavStream']>>;
    try {
      opened = await deps.pedal.openWavStream(ref, size =>
        parseRange(request.headers.get('range'), size),
      );
    } catch (error) {
      const name = (error as Error | undefined)?.name;
      // The pedal refused (no such file) or is not connected any more.
      if (name === 'GreenglassRequestError' || name === 'PedalNotConnectedError') {
        log.warn('jamman://pedal/ request failed:', (error as Error).message);
        return textResponse(404, 'File not found');
      }
      throw error;
    }
    if (opened.range === 'unsatisfiable') {
      return unsatisfiable(opened.size);
    }
    if (isHead && opened.stream) {
      // Nothing will read it: release the pedal's file handle now.
      await opened.stream.cancel();
    }
    return wavResponse(opened.size, opened.range, isHead ? null : opened.stream);
  };

  return async function handleJammanRequest(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return textResponse(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      }

      if (request.url.startsWith(PEDAL_URL_PREFIX)) {
        return await servePedal(request);
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
      const range = parseRange(request.headers.get('range'), size);
      if (range === 'unsatisfiable') {
        return unsatisfiable(size);
      }

      const isHead = request.method === 'HEAD';
      const body =
        isHead || size === 0 ? null : fs.openStream(realFile, range ?? { start: 0, end: size - 1 });
      return wavResponse(size, range, body);
    } catch (error) {
      log.error('Error serving jamman:// request:', error);
      return textResponse(500, 'Internal server error');
    }
  };
}
