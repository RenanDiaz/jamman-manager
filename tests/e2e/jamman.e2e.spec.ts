/**
 * JamMan Manager E2E tests, run against the packaged app (npm run compile).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SD_FIXTURE_PATCHES } from '../fixtures/index.js';
import type { Page } from '@playwright/test';
import { expect, loadSd, patchRow, test } from './app.js';

const PATCH_DIRS = SD_FIXTURE_PATCHES.map(p => p.dir);
const listPatchDirs = (sd: string) =>
  fs
    .readdirSync(sd)
    .filter(d => /^Patch\d{2}$/.test(d))
    .sort();

test('starts sandboxed, with context isolation and no CSP violations', async ({ jamman }) => {
  const { app, page } = jamman;

  const prefs = await app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map(w => {
      const p = w.getLastWebPreferences();
      return {
        url: w.getURL(),
        sandbox: p.sandbox,
        contextIsolation: p.contextIsolation,
        nodeIntegration: p.nodeIntegration,
      };
    }),
  );
  const win = prefs.find(p => /^(file|http)/.test(p.url));
  expect(win, 'app window not found').toBeDefined();
  expect(win).toMatchObject({ sandbox: true, contextIsolation: true });
  expect(win!.nodeIntegration).toBeFalsy();

  // The renderer has no Node, only the preload API.
  const renderer = await page.evaluate(() => ({
    process: typeof (globalThis as { process?: unknown }).process,
    require: typeof (globalThis as { require?: unknown }).require,
    api: typeof (window as unknown as { electronAPI?: unknown }).electronAPI,
  }));
  expect(renderer).toEqual({ process: 'undefined', require: 'undefined', api: 'object' });

  // The UI rendered (not a blank page caused by a blocked script/style).
  await expect(page.getByRole('button', { name: /Load patches/i }).first()).toBeVisible();

  expect(jamman.cspMessages, 'CSP violations at startup').toEqual([]);
  expect(jamman.pageErrors, 'uncaught page errors').toEqual([]);
});

test('loads the SD card and lists its patches', async ({ jamman }) => {
  await loadSd(jamman.page, PATCH_DIRS);

  for (const patch of SD_FIXTURE_PATCHES) {
    await expect(jamman.page.getByText(patch.name).first()).toBeVisible();
  }
  expect(jamman.cspMessages).toEqual([]);
  expect(jamman.pageErrors).toEqual([]);
});

/** State of the footer `<audio>`, or null before the player mounts. */
const footerAudio = (page: Page) =>
  page.evaluate(() => {
    const audio = document.querySelector('audio');
    return audio
      ? {
          src: audio.src.startsWith('jamman://'),
          error: audio.error?.code ?? null,
          duration: audio.readyState >= 1 ? audio.duration : 0,
        }
      : null;
  });

/**
 * Silent 16-bit stereo 44.1 kHz WAV of `seconds`, with a LIST chunk after the audio data like
 * the ones Logic Pro exports (it also adds `LGWV` and `cue `). A file this long makes the media
 * stack read the trailing chunk with a second range request.
 */
function longWavWithTrailingChunk(seconds: number): Buffer {
  const dataSize = seconds * 44100 * 4;
  const info = Buffer.from('INFOISFT\x0e\x00\x00\x00Logic Pro 11\x00\x00', 'latin1');
  const buf = Buffer.alloc(44 + dataSize + 8 + info.length);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(44100 * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  const list = 44 + dataSize;
  buf.write('LIST', list, 'ascii');
  buf.writeUInt32LE(info.length, list + 4);
  info.copy(buf, list + 8);
  return buf;
}

test('plays a phrase through the jamman:// protocol', async ({ jamman }) => {
  const { page } = jamman;
  await loadSd(page, PATCH_DIRS);

  await patchRow(page, 'Patch01').click();
  await page.getByRole('button', { name: 'Play PhraseA' }).first().click();

  await expect(page.getByText('Now Playing')).toBeVisible();

  // The footer <audio> loads the phrase from the approved folder and decodes it.
  // (The fixture WAV is a few ms long, so we assert it loaded rather than that it is still playing.)
  await expect
    .poll(async () => {
      const audio = await footerAudio(page);
      return audio && { src: audio.src, error: audio.error, loaded: audio.duration > 0 };
    })
    .toEqual({ src: true, error: null, loaded: true });

  expect(jamman.cspMessages).toEqual([]);
});

test('plays a long WAV that has chunks after the audio data', async ({ jamman }) => {
  const { page, sd } = jamman;
  fs.writeFileSync(
    path.join(sd.path, 'Patch01', 'PhraseA', 'phrase.wav'),
    longWavWithTrailingChunk(40),
  );
  await loadSd(page, PATCH_DIRS);

  await patchRow(page, 'Patch01').click();
  await page.getByRole('button', { name: 'Play PhraseA' }).first().click();

  await expect
    .poll(async () => {
      const audio = await footerAudio(page);
      return audio && { src: audio.src, error: audio.error, duration: Math.round(audio.duration) };
    })
    .toEqual({ src: true, error: null, duration: 40 });

  expect(jamman.cspMessages).toEqual([]);
});

test('deletes a patch and restores it with undo', async ({ jamman }) => {
  const { page, sd } = jamman;
  await loadSd(page, PATCH_DIRS);

  const target = SD_FIXTURE_PATCHES[1]; // Patch02, two phrases
  const targetDir = path.join(sd.path, target.dir);
  const originalFiles = fs.readdirSync(targetDir, { recursive: true }).sort();
  const originalXml = fs.readFileSync(path.join(targetDir, 'patch.xml'));
  const originalWav = fs.readFileSync(path.join(targetDir, 'PhraseA', 'phrase.wav'));

  await patchRow(page, target.dir).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

  await expect.poll(() => listPatchDirs(sd.path)).toEqual(['Patch01', 'Patch03']);

  await page.keyboard.press('ControlOrMeta+z');

  await expect.poll(() => listPatchDirs(sd.path)).toEqual(PATCH_DIRS);
  expect(fs.readdirSync(targetDir, { recursive: true }).sort()).toEqual(originalFiles);
  expect(fs.readFileSync(path.join(targetDir, 'patch.xml')).equals(originalXml)).toBe(true);
  expect(fs.readFileSync(path.join(targetDir, 'PhraseA', 'phrase.wav')).equals(originalWav)).toBe(
    true,
  );
  await expect(page.getByText(target.name).first()).toBeVisible();
  expect(jamman.pageErrors).toEqual([]);
});
