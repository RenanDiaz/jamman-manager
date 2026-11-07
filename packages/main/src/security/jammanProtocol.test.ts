import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createJammanProtocolHandler,
  parseJammanUrl,
  parseRange,
  toJammanUrl,
} from './jammanProtocol.js';

const silentLog = { warn: () => {}, error: () => {} };

let tmp: string;
let root: string;
let validWav: string;
let outsideWav: string;
const WAV_BYTES = Buffer.from(Array.from({ length: 100 }, (_, i) => i));

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jamman-protocol-'));
  root = path.join(tmp, 'sd');
  const phraseDir = path.join(root, 'Patch01', 'PhraseA');
  fs.mkdirSync(phraseDir, { recursive: true });

  validWav = path.join(phraseDir, 'phrase.wav');
  fs.writeFileSync(validWav, WAV_BYTES);
  fs.writeFileSync(path.join(phraseDir, 'phrase.xml'), '<JamManPhrase/>');

  fs.mkdirSync(path.join(tmp, 'outside'));
  outsideWav = path.join(tmp, 'outside', 'secret.wav');
  fs.writeFileSync(outsideWav, 'secret');
  fs.writeFileSync(path.join(tmp, 'outside', 'secret.txt'), 'secret');

  // Symlinks inside the root that point outside it, or to a non-WAV file
  fs.symlinkSync(outsideWav, path.join(root, 'Patch01', 'escape.wav'));
  fs.symlinkSync(path.join(tmp, 'outside'), path.join(root, 'linked-dir'));
  fs.symlinkSync(path.join(phraseDir, 'phrase.xml'), path.join(root, 'xml-as.wav'));
  // A symlink that stays inside the root is fine
  fs.symlinkSync(validWav, path.join(root, 'Patch01', 'alias.wav'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function handlerWithRoot(allowedRoot: string | null = root) {
  return createJammanProtocolHandler({ getAllowedRoot: () => allowedRoot, log: silentLog });
}

function get(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe('toJammanUrl / parseJammanUrl', () => {
  it('round-trips absolute paths, including spaces and unicode', () => {
    const p = '/Volumes/JAMMAN SD/Patch01/PhraseA/phrasé.wav';
    expect(parseJammanUrl(toJammanUrl(p))).toBe(p);
  });

  it('ignores a trailing slash, query and fragment added by the browser', () => {
    const url = toJammanUrl('/a/b.wav');
    expect(parseJammanUrl(`${url}/`)).toBe('/a/b.wav');
    expect(parseJammanUrl(`${url}?t=1#x`)).toBe('/a/b.wav');
  });

  it('rejects other schemes and malformed encodings', () => {
    expect(parseJammanUrl('file:///etc/passwd')).toBeNull();
    expect(parseJammanUrl('jamman://%E0%A4%A')).toBeNull();
  });
});

describe('parseRange', () => {
  it('parses open, closed and suffix ranges', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=50-', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });

  it('flags out-of-bounds ranges and ignores unsupported ones', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=9-1', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange(null, 100)).toBeNull();
  });
});

describe('jamman:// handler', () => {
  it('serves a WAV inside the approved folder', async () => {
    const res = await handlerWithRoot()(get(toJammanUrl(validWav)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('100');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(WAV_BYTES);
  });

  it('answers range requests with 206 so the audio element can seek', async () => {
    const res = await handlerWithRoot()(get(toJammanUrl(validWav), { Range: 'bytes=10-19' }));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100');
    expect(res.headers.get('content-length')).toBe('10');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(WAV_BYTES.subarray(10, 20));
  });

  it('answers 416 for an unsatisfiable range', async () => {
    const res = await handlerWithRoot()(get(toJammanUrl(validWav), { Range: 'bytes=500-' }));
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */100');
  });

  it('serves a symlink that stays inside the approved folder', async () => {
    const res = await handlerWithRoot()(get(toJammanUrl(path.join(root, 'Patch01', 'alias.wav'))));
    expect(res.status).toBe(200);
  });

  it('returns 403 for a path outside the approved folder', async () => {
    const res = await handlerWithRoot()(get(toJammanUrl(outsideWav)));
    expect(res.status).toBe(403);
  });

  it('returns 403 for `..` traversal', async () => {
    const traversal = path.join(root, 'Patch01') + '/../../outside/secret.wav';
    const res = await handlerWithRoot()(get(toJammanUrl(traversal)));
    expect(res.status).toBe(403);

    // Same, written directly in the URL with encoded dots
    const res2 = await handlerWithRoot()(
      get(`jamman://${encodeURIComponent(root)}%2F%2E%2E%2Foutside%2Fsecret.wav`),
    );
    expect(res2.status).toBe(403);
  });

  it('returns 403 for a file that is not a WAV', async () => {
    const res = await handlerWithRoot()(
      get(toJammanUrl(path.join(root, 'Patch01', 'PhraseA', 'phrase.xml'))),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 for a symlink inside the folder that points outside', async () => {
    const res = await handlerWithRoot()(get(toJammanUrl(path.join(root, 'Patch01', 'escape.wav'))));
    expect(res.status).toBe(403);

    const res2 = await handlerWithRoot()(
      get(toJammanUrl(path.join(root, 'linked-dir', 'secret.wav'))),
    );
    expect(res2.status).toBe(403);
  });

  it('returns 403 for a .wav symlink to a non-WAV file', async () => {
    const res = await handlerWithRoot()(get(toJammanUrl(path.join(root, 'xml-as.wav'))));
    expect(res.status).toBe(403);
  });

  it('returns 400 for an empty path', async () => {
    expect((await handlerWithRoot()(get('jamman://'))).status).toBe(400);
    expect((await handlerWithRoot()(get(toJammanUrl('   ')))).status).toBe(400);
  });

  it('returns 403 for a relative path', async () => {
    const res = await handlerWithRoot()(get(toJammanUrl('Patch01/PhraseA/phrase.wav')));
    expect(res.status).toBe(403);
  });

  it('returns 403 when no folder has been approved', async () => {
    const res = await handlerWithRoot(null)(get(toJammanUrl(validWav)));
    expect(res.status).toBe(403);
  });

  it('returns 404 for a missing WAV inside the approved folder', async () => {
    const res = await handlerWithRoot()(get(toJammanUrl(path.join(root, 'Patch02', 'x.wav'))));
    expect(res.status).toBe(404);
  });

  it('returns 405 for methods other than GET and HEAD', async () => {
    const res = await handlerWithRoot()(new Request(toJammanUrl(validWav), { method: 'POST' }));
    expect(res.status).toBe(405);
  });
});
