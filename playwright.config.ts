/**
 * Playwright E2E Test Configuration
 *
 * Configuration for end-to-end testing with Playwright
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Test directory
  testDir: './tests',

  // Test file pattern
  testMatch: '**/*.e2e.spec.ts',

  // Timeout for each test
  timeout: 60000,

  // Number of retries
  retries: process.env.CI ? 2 : 0,

  // Reporter configuration
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/html' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for the application
    // baseURL: 'http://localhost:5173', // Not applicable for Electron

    // Collect trace on failure
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording
    video: 'retain-on-failure',
  },

  // Test output directory
  outputDir: 'test-results/artifacts',

  // Global setup/teardown
  // globalSetup: './tests/global-setup.ts',
  // globalTeardown: './tests/global-teardown.ts',

  // Maximum number of workers
  workers: process.env.CI ? 1 : undefined,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Projects configuration (for testing multiple configurations)
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.spec.ts',
    },
  ],
});
