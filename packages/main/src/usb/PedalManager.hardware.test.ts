/**
 * Read-only checks against a real JamMan connected over USB.
 *
 * Skipped unless `JAMMAN_USB=1`:
 *
 *   JAMMAN_USB=1 npx vitest run packages/main/src/usb/PedalManager.hardware.test.ts
 *
 * Nothing is written to the pedal; WAVs are cached in a temporary folder.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { PatchRecord } from '@app/preload/ipc-contract';
import { PedalManager } from './PedalManager.js';
import { BackupManager } from '../BackupManager.js';
import { parseWavPath } from './pedalPaths.js';
import { findJamManPorts, openSerialTransport } from './serialTransport.js';

const enabled = process.env.JAMMAN_USB === '1';
const quietLog = { info: () => {}, warn: console.warn, error: console.error };

async function collect(stream: ReadableStream<Uint8Array> | null): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of Readable.fromWeb(stream as unknown as NodeReadableStream)) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe.skipIf(!enabled)('PedalManager on a real JamMan', () => {
  let cacheRoot: string;
  let pedal: PedalManager;
  let internal: PatchRecord[];

  beforeAll(async () => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jamman-pedal-cache-'));
    pedal = new PedalManager({
      findPorts: () => findJamManPorts(),
      openTransport: openSerialTransport,
      cacheRoot,
      log: quietLog,
    });
  });

  afterAll(async () => {
    await pedal?.disconnect();
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('connects and reports both banks', async () => {
    const info = await pedal.connect();
    expect(info.name).toMatch(/JamMan/);
    expect(info.banks.map(b => b.id)).toEqual(['internal', 'sd']);
    expect(info.banks[0].capacityBytes).toBeGreaterThan(0);
  });

  it('reads the internal bank', async () => {
    internal = await pedal.readPatches('internal');
    expect(internal.length).toBeGreaterThan(0);
    expect(internal[0].dir).toMatch(/^Patch\d{2}$/);
    expect(internal[0].data.JamManPatch.PatchName[0]).toBeTruthy();
    expect(await pedal.bankSize('internal')).toBeGreaterThan(0);
  });

  it('reads the SD bank when a card is inserted', async () => {
    if (!pedal.status()?.banks[1].available) return;
    const started = Date.now();
    const sd = await pedal.readPatches('sd');
    console.log(`SD: ${sd.length} patches in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    expect(sd.length).toBeGreaterThan(0);
  }, 60_000);

  it('streams a WAV, caches it, and serves ranges', async () => {
    const phrase = internal.flatMap(p => p.phrases)[0];
    const ref = parseWavPath(phrase.wavPath)!;

    const head = await pedal.readWavHead(ref, 64 * 1024);
    expect(head.head.toString('ascii', 0, 4)).toBe('RIFF');

    const whole = await pedal.openWavStream(ref, () => null);
    if (whole.range === 'unsatisfiable') throw new Error('unexpected');
    const fromPedal = await collect(whole.stream);
    expect(fromPedal.length).toBe(head.size);
    expect(fromPedal.subarray(0, 64)).toEqual(head.head.subarray(0, 64));

    // Second time comes from the cache, byte for byte the same.
    const again = await pedal.readWav(ref);
    expect(again.equals(fromPedal)).toBe(true);

    // A range from the middle.
    const ranged = await pedal.openWavStream(ref, () => ({ start: 1000, end: 50_999 }));
    if (ranged.range === 'unsatisfiable') throw new Error('unexpected');
    expect((await collect(ranged.stream)).equals(fromPedal.subarray(1000, 51_000))).toBe(true);
  }, 120_000);

  it('serves a range straight from the pedal when nothing is cached', async () => {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    const phrase = internal.flatMap(p => p.phrases)[0];
    const ref = parseWavPath(phrase.wavPath)!;
    const size = await pedal.wavSize(ref);

    const tail = await pedal.openWavStream(ref, s => ({ start: s - 100, end: s - 1 }));
    if (tail.range === 'unsatisfiable') throw new Error('unexpected');
    const bytes = await collect(tail.stream);
    expect(bytes.length).toBe(100);
    expect(size).toBeGreaterThan(100);
  }, 60_000);

  it('downloads a bank, stops when canceled and resumes', async () => {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    const before = await pedal.audioStatus('internal');
    expect(before.cachedFiles).toBe(0);

    const stopAfter = (bytes: number) => (p: { done: number } | null) => {
      if (p && p.done > bytes) pedal.cancel();
    };
    const listener = stopAfter(3_000_000);
    pedal.on('progress', listener);
    await expect(pedal.downloadAudio('internal')).rejects.toThrow('Canceled');
    pedal.off('progress', listener);
    const partial = await pedal.audioStatus('internal');
    console.log(`after cancel: ${partial.cachedFiles}/${partial.files} files cached`);
    expect(partial.cachedFiles).toBeGreaterThan(0);
    expect(partial.cachedFiles).toBeLessThan(partial.files);

    const started = Date.now();
    const done = await pedal.downloadAudio('internal');
    console.log(
      `resumed: ${((done.totalBytes - partial.cachedBytes) / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    expect((await pedal.audioStatus('internal')).cachedFiles).toBe(done.files);
  }, 180_000);

  it('exports the internal bank to a ZIP backup', async () => {
    const zip = path.join(cacheRoot, 'internal.jamman-backup.zip');
    await pedal.withLocalWorkDir(async dir => {
      const exported = await pedal.exportBank('internal', undefined, false, dir);
      expect(exported.length).toBeGreaterThan(0);
      await BackupManager.createBackup({ basePath: dir, outputPath: zip, patches: exported });
    });
    const info = await BackupManager.validateBackup(zip);
    console.log(
      `backup: ${info.manifest?.patchCount} patches, ${(fs.statSync(zip).size / 1e6).toFixed(1)} MB`,
    );
    expect(info.valid).toBe(true);
  }, 180_000);
});
