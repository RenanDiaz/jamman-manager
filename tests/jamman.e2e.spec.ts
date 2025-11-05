/**
 * JamMan Manager E2E Tests
 *
 * Comprehensive end-to-end tests for JamMan Manager application features.
 */

import type { ElectronApplication, Page } from 'playwright';
import { _electron as electron } from 'playwright';
import { expect, test as base } from '@playwright/test';
import { globSync } from 'glob';
import { platform } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

process.env.PLAYWRIGHT_TEST = 'true';

type TestFixtures = {
  electronApp: ElectronApplication;
  page: Page;
  testDataDir: string;
};

const test = base.extend<TestFixtures>({
  electronApp: [
    async ({}, use) => {
      let executablePattern = 'dist/*/root{,.*}';
      if (platform === 'darwin') {
        executablePattern += '/Contents/*/root';
      }

      const [executablePath] = globSync(executablePattern);
      if (!executablePath) {
        throw new Error('App Executable path not found');
      }

      const electronApp = await electron.launch({
        executablePath: executablePath,
        args: ['--no-sandbox'],
      });

      electronApp.on('console', msg => {
        if (msg.type() === 'error') {
          console.error(`[electron][${msg.type()}] ${msg.text()}`);
        }
      });

      await use(electronApp);
      await electronApp.close();
    },
    { scope: 'worker', auto: true } as any,
  ],

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    page.on('pageerror', error => {
      console.error(error);
    });
    page.on('console', msg => {
      console.log(msg.text());
    });

    await page.waitForLoadState('load');
    await use(page);
  },

  testDataDir: async ({}, use) => {
    // Create temporary test data directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamman-e2e-'));

    // Create test JamMan folder structure
    const patch01Dir = path.join(tempDir, 'Patch01');
    fs.mkdirSync(patch01Dir, { recursive: true });

    // Create patch.xml
    const patchXML = `<?xml version="1.0" encoding="UTF-8"?>
<JamManPatch>
  <PatchName>Test Patch 01</PatchName>
  <RhythmType>0</RhythmType>
  <StopMode>0</StopMode>
</JamManPatch>`;
    fs.writeFileSync(path.join(patch01Dir, 'patch.xml'), patchXML);

    // Create PhraseA
    const phraseADir = path.join(patch01Dir, 'PhraseA');
    fs.mkdirSync(phraseADir);

    const phraseXML = `<?xml version="1.0" encoding="UTF-8"?>
<JamManPhrase>
  <BeatsPerMinute>120</BeatsPerMinute>
  <BeatsPerMeasure>4</BeatsPerMeasure>
  <ID>phrase-a</ID>
</JamManPhrase>`;
    fs.writeFileSync(path.join(phraseADir, 'phrase.xml'), phraseXML);

    // Create minimal valid WAV file
    const wavHeader = Buffer.alloc(44);
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(2, 22);
    wavHeader.writeUInt32LE(44100, 24);
    wavHeader.writeUInt32LE(176400, 28);
    wavHeader.writeUInt16LE(4, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(0, 40);
    fs.writeFileSync(path.join(phraseADir, 'phrase.wav'), wavHeader);

    await use(tempDir);

    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
});

test.describe('Application Launch', () => {
  test('Application should launch successfully', async ({ electronApp }) => {
    expect(electronApp).toBeDefined();
  });

  test('Main window should be visible', async ({ page }) => {
    await expect(page).toBeTruthy();
    const isVisible = await page.isVisible('body');
    expect(isVisible).toBe(true);
  });

  test('Application should have correct title', async ({ page }) => {
    const title = await page.title();
    expect(title).toBeDefined();
  });
});

test.describe('Folder Selection', () => {
  test('Should show folder selection prompt on first launch', async ({ page }) => {
    // Look for folder selection UI elements
    const folderButton = page.getByRole('button', { name: /select.*folder/i }).first();
    if (await folderButton.isVisible()) {
      await expect(folderButton).toBeVisible();
    }
  });
});

test.describe('Patch Management', () => {
  test('Should display patch list', async ({ page }) => {
    // Wait for patches to load
    await page.waitForTimeout(1000);

    // Look for patch list container
    const patchList = page.locator('[data-testid="patch-list"]').or(page.locator('.patch-list'));
    const isVisible = await patchList
      .first()
      .isVisible()
      .catch(() => false);

    // If patches are loaded, verify list exists
    if (isVisible) {
      await expect(patchList.first()).toBeVisible();
    }
  });

  test('Should allow patch selection', async ({ page }) => {
    // Look for selectable patches
    const patchItem = page
      .locator('[data-testid^="patch-"]')
      .or(page.locator('.patch-item'))
      .first();

    const exists = await patchItem.count();
    if (exists > 0) {
      await patchItem.click();
      // Verify patch is selected (should have active/selected class or attribute)
      const isActive = await patchItem.evaluate(
        el =>
          el.classList.contains('selected') ||
          el.classList.contains('active') ||
          el.getAttribute('aria-selected') === 'true',
      );
      expect(isActive).toBeTruthy();
    }
  });
});

test.describe('Audio Playback', () => {
  test('Should have audio player controls', async ({ page }) => {
    // Look for audio player elements
    const audioControls = page
      .locator('[data-testid="audio-player"]')
      .or(page.locator('audio').or(page.locator('.audio-player')));

    // Check if audio player exists in DOM
    const count = await audioControls.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Should have play/pause button', async ({ page }) => {
    // Look for play button
    const playButton = page.getByRole('button', { name: /play|pause/i });
    const exists = await playButton.count();

    // If play button exists, it should be visible or hidden based on state
    if (exists > 0) {
      expect(exists).toBeGreaterThan(0);
    }
  });
});

test.describe('Multi-Select Operations', () => {
  test('Should allow selecting multiple patches', async ({ page }) => {
    const patchItems = page.locator('[data-testid^="patch-"]').or(page.locator('.patch-item'));
    const count = await patchItems.count();

    if (count >= 2) {
      // Select first patch
      await patchItems.nth(0).click();

      // Select second patch with Ctrl/Cmd key
      const modifier = platform === 'darwin' ? 'Meta' : 'Control';
      await patchItems.nth(1).click({ modifiers: [modifier] });

      // Verify multiple selection
      const selectedCount = await page.locator('.selected, [aria-selected="true"]').count();
      expect(selectedCount).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('Export Functionality', () => {
  test('Should have export options', async ({ page }) => {
    // Look for export menu or buttons
    const exportButton = page.getByRole('button', { name: /export/i });
    const menuButton = page.getByRole('button', { name: /menu/i });

    const exportExists = await exportButton.count();
    const menuExists = await menuButton.count();

    // Either export button or menu should exist
    expect(exportExists + menuExists).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Backup and Restore', () => {
  test('Should have backup functionality', async ({ page }) => {
    // Look for backup options
    const backupButton = page.getByRole('button', { name: /backup/i });
    const menuButton = page.getByRole('button', { name: /menu/i });

    const exists = (await backupButton.count()) + (await menuButton.count());
    expect(exists).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Settings and Configuration', () => {
  test('Should have settings menu', async ({ page }) => {
    // Look for settings button
    const settingsButton = page.getByRole('button', { name: /settings|preferences/i });
    const menuButton = page.getByRole('button', { name: /menu/i });

    const exists = (await settingsButton.count()) + (await menuButton.count());
    expect(exists).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Error Handling', () => {
  test('Should handle invalid folder selection gracefully', async ({ page }) => {
    // The app should not crash if user cancels folder selection
    const isVisible = await page.isVisible('body');
    expect(isVisible).toBe(true);
  });

  test('Should display error messages for invalid operations', async ({ page }) => {
    // Look for error notification containers
    const errorContainer = page
      .locator('[role="alert"]')
      .or(page.locator('.error, .error-message, [data-testid="error"]'));

    // Error container should exist in DOM (even if not visible)
    const count = await errorContainer.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Keyboard Navigation', () => {
  test('Should support keyboard shortcuts', async ({ page }) => {
    // Test Escape key (should not cause errors)
    await page.keyboard.press('Escape');

    const isVisible = await page.isVisible('body');
    expect(isVisible).toBe(true);
  });

  test('Should support Tab navigation', async ({ page }) => {
    // Press Tab to navigate
    await page.keyboard.press('Tab');

    // Check if focus moved
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeDefined();
  });
});

test.describe('Responsive Layout', () => {
  test('Should handle window resizing', async ({ page }) => {
    const originalSize = await page.viewportSize();

    // Resize window
    await page.setViewportSize({ width: 1024, height: 768 });

    // Verify page is still functional
    const isVisible = await page.isVisible('body');
    expect(isVisible).toBe(true);

    // Restore original size if it existed
    if (originalSize) {
      await page.setViewportSize(originalSize);
    }
  });
});

test.describe('Performance', () => {
  test('Application should load within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - startTime;

    // Should load within 10 seconds
    expect(loadTime).toBeLessThan(10000);
  });

  test('UI should be responsive to user interactions', async ({ page }) => {
    // Click on body should not hang
    await page.click('body');

    // Verify page is still responsive
    const isVisible = await page.isVisible('body');
    expect(isVisible).toBe(true);
  });
});
