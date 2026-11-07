import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.e2e.spec.ts'],

    // Test timeout
    testTimeout: 10000,
    hookTimeout: 10000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Measure the code the app runs: the main process, the preload bridge and
      // the renderer's logic (stores, utils). React components are left out:
      // they have no unit tests and are covered by the e2e suite instead.
      include: [
        'packages/main/src/**/*.ts',
        'packages/preload/src/**/*.ts',
        'packages/renderer/src/store/**/*.ts',
        'packages/renderer/src/utils/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        // Test helpers and fixtures
        'packages/main/src/test-utils/**',
        'packages/main/src/__fixtures__/**',
        'packages/renderer/src/utils/undoTestHarness.ts',
        // Declarations only (no runtime code)
        'packages/main/src/AppInitConfig.ts',
        'packages/main/src/AppModule.ts',
        'packages/main/src/ModuleContext.ts',
        'packages/main/src/ipc/deps.ts',
        'packages/preload/src/ipc-contract.ts',
        // Not wired into the app (its .init() is commented out in index.ts)
        'packages/main/src/modules/ChromeDevToolsExtension.ts',
      ],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },

    // Reporter configuration
    reporters: ['default'],

    // Retry configuration
    retry: process.env.CI ? 2 : 0,

    // Bail on first failure in CI
    bail: process.env.CI ? 1 : 0,
  },
});
