/**
 * JamMan Manager E2E tests, run against the packaged app (npm run compile).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SD_FIXTURE_PATCHES } from '../fixtures/index.js';
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

test('plays a phrase through the jamman:// protocol', async ({ jamman }) => {
  const { page } = jamman;
  await loadSd(page, PATCH_DIRS);

  await patchRow(page, 'Patch01').click();
  await page.getByRole('button', { name: 'Play PhraseA' }).first().click();

  await expect(page.getByText('Now Playing')).toBeVisible();

  // The footer <audio> loads the phrase from the approved folder and decodes it.
  // (The fixture WAV is a few ms long, so we assert it loaded rather than that it is still playing.)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const audio = document.querySelector('audio');
        return audio
          ? {
              src: audio.src.startsWith('jamman://'),
              error: audio.error?.code ?? null,
              loaded: audio.readyState >= 1 && audio.duration > 0,
            }
          : null;
      }),
    )
    .toEqual({ src: true, error: null, loaded: true });

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
