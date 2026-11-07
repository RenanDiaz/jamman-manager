/**
 * Playwright E2E configuration.
 *
 * The tests launch the packaged app produced by `npm run compile` (see tests/e2e/app.ts),
 * so build first: `npm run compile && npm run test:e2e`.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.spec.ts',

  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Every test launches its own app instance with its own user-data dir and SD copy.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
