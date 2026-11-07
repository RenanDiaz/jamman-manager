/**
 * Helpers to launch the packaged JamMan Manager for E2E tests.
 *
 * Each launch gets a throw-away `--user-data-dir` and a temporary copy of the synthetic SD
 * (tests/fixtures/jamman-sd), so tests never touch real user data or each other.
 */
import { _electron as electron, expect, test as base } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempSd } from '../fixtures/index.js';
import type { TempSd } from '../fixtures/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Locates the unpacked app that `npm run compile` leaves in `dist/` (see electron-builder.mjs:
 * productName "JamMan Manager", output "dist").
 *
 * - macOS:   dist/mac-arm64/JamMan Manager.app/Contents/MacOS/JamMan Manager (arm64)
 *            dist/mac/JamMan Manager.app/Contents/MacOS/JamMan Manager       (x64)
 * - Windows: dist/win-unpacked/JamMan Manager.exe
 * - Linux:   dist/linux-unpacked/<executableName> (electron-builder uses the package name,
 *            "jamman-manager"; the product name is accepted as a fallback)
 */
export function findExecutable(): string {
  const dist = path.join(REPO_ROOT, 'dist');
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    const dir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    candidates.push(
      path.join(dist, dir, 'JamMan Manager.app', 'Contents', 'MacOS', 'JamMan Manager'),
    );
  } else if (process.platform === 'win32') {
    candidates.push(path.join(dist, 'win-unpacked', 'JamMan Manager.exe'));
  } else {
    candidates.push(
      path.join(dist, 'linux-unpacked', 'jamman-manager'),
      path.join(dist, 'linux-unpacked', 'JamMan Manager'),
    );
  }

  const found = candidates.find(p => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `Packaged app not found. Run "npm run compile" first. Looked for:\n  ${candidates.join('\n  ')}`,
    );
  }
  return found;
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
  sd: TempSd;
  /** Console messages and page errors captured since launch. */
  consoleErrors: string[];
  pageErrors: string[];
  cspMessages: string[];
  close: () => Promise<void>;
}

/**
 * Starts the packaged app with a temporary user-data dir and wires the "open folder" dialog
 * to return the temp SD (the real native dialog cannot be driven by Playwright).
 */
export async function launchApp(): Promise<Launched> {
  const sd = createTempSd();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamman-e2e-userdata-'));

  // The process-level sandbox stays ON. On Linux CI the unpacked chrome-sandbox helper is not
  // SUID, so the workflow fixes its permissions (see .github/workflows/ci.yml) instead of
  // passing --no-sandbox. E2E_NO_SANDBOX=1 is an explicit local escape hatch for hosts where
  // that is impossible; it is never set by CI.
  const args = [`--user-data-dir=${userDataDir}`];
  if (process.env.E2E_NO_SANDBOX === '1') args.push('--no-sandbox');

  const app = await electron.launch({ executablePath: findExecutable(), args });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const cspMessages: string[] = [];

  const page = await app.firstWindow();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', msg => {
    const text = msg.text();
    if (/Content Security Policy|Refused to/i.test(text)) cspMessages.push(text);
    if (msg.type() === 'error') consoleErrors.push(text);
  });
  // Listeners attach after the window may have started loading; reload so startup
  // messages (CSP violations in particular) are captured too. Wait for the first load of
  // the app page to finish before reloading: on Linux `firstWindow()` resolves while the
  // initial navigation is still in flight, and reloading then aborts it (ERR_ABORTED).
  await page.waitForURL(/^(file|https?):/, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await app.evaluate(({ dialog }, sdPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sdPath] });
  }, sd.path);

  return {
    app,
    page,
    sd,
    consoleErrors,
    pageErrors,
    cspMessages,
    close: async () => {
      await app.close().catch(() => undefined);
      sd.cleanup();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

export const test = base.extend<{ jamman: Launched }>({
  jamman: async ({}, use) => {
    const launched = await launchApp();
    try {
      await use(launched);
    } finally {
      await launched.close();
    }
  },
});

export { expect };

/** Clicks "Load Patches" and waits until the fixture patches are listed. */
export async function loadSd(page: Page, patchDirs: readonly string[]): Promise<void> {
  await page.getByRole('button', { name: /Load Patches/ }).click();
  for (const dir of patchDirs) {
    await expect(page.locator('button.accordion-button', { hasText: dir })).toBeVisible();
  }
}
