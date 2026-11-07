import { resolveModuleExportNames } from 'mlly';
import { getChromeMajorVersion } from '@app/electron-versions';

export default /**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
({
  build: {
    ssr: true,
    sourcemap: 'inline',
    outDir: 'dist',
    target: `chrome${getChromeMajorVersion()}`,
    assetsDir: '.',
    lib: {
      entry: ['src/exposed.ts'],
      formats: ['cjs'],
    },
    rollupOptions: {
      output: {
        // The window runs with `sandbox: true`, and sandboxed preload scripts are
        // plain scripts: no ES modules, and `require` only resolves 'electron'
        // and a few built-ins. So the preload is a single self-contained
        // CommonJS file. It keeps the `.mjs` name that `entry-point.mjs` and the
        // package `exports` reference; Electron does not look at the extension
        // of a sandboxed preload.
        // https://www.electronjs.org/docs/latest/tutorial/sandbox#preload-scripts
        entryFileNames: '[name].mjs',
        inlineDynamicImports: true,
      },
    },
    emptyOutDir: true,
    reportCompressedSize: false,
  },
  plugins: [mockExposed(), handleHotReload()],
});

/**
 * This plugin creates a browser (renderer) version of `preload` package.
 * Basically, it just read all nominals you exported from package and define it as globalThis properties
 * expecting that real values were exposed by `electron.contextBridge.exposeInMainWorld()`
 *
 * Example:
 * ```ts
 * // index.ts
 * export const someVar = 'my-value';
 * ```
 *
 * Output
 * ```js
 * // _virtual_browser.mjs
 * export const someVar = globalThis[<hash>] // 'my-value'
 * ```
 */
function mockExposed() {
  return {
    name: 'electron-main-exposer',
    async generateBundle() {
      const exportedNames = await resolveModuleExportNames('./src/index.ts', {
        url: import.meta.url,
      });
      const source = exportedNames.reduce((s, key) => {
        return (
          s +
          (key === 'default'
            ? `export default globalThis['${btoa(key)}'];\n`
            : `export const ${key} = globalThis['${btoa(key)}'];\n`)
        );
      }, '');

      // Emitted as an asset (not a second entry) so it stays an ES module while
      // the preload itself is built as CommonJS.
      this.emitFile({ type: 'asset', fileName: '_virtual_browser.mjs', source });
    },
  };
}

/**
 * Implement Electron webview reload when some file was changed
 * @return {import('vite').Plugin}
 */
function handleHotReload() {
  /** @type {import('vite').ViteDevServer|null} */
  let rendererWatchServer = null;

  return {
    name: '@app/preload-process-hot-reload',

    config(config, env) {
      if (env.mode !== 'development') {
        return;
      }

      const rendererWatchServerProvider = config.plugins.find(
        p => p.name === '@app/renderer-watch-server-provider',
      );
      if (!rendererWatchServerProvider) {
        throw new Error('Renderer watch server provider not found');
      }

      rendererWatchServer = rendererWatchServerProvider.api.provideRendererWatchServer();

      return {
        build: {
          watch: {},
        },
      };
    },

    writeBundle() {
      if (!rendererWatchServer) {
        return;
      }

      rendererWatchServer.ws.send({
        type: 'full-reload',
      });
    },
  };
}
