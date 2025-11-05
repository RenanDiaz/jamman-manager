/**
 * Window Manager Module
 *
 * Manages the creation, lifecycle, and restoration of the main application window.
 * Handles window state persistence, custom icon loading, and multi-instance behavior.
 *
 * Features:
 * - Automatic window restoration when app is activated (macOS)
 * - Single window instance management
 * - Custom application icon integration
 * - Developer tools auto-open in development mode
 * - Security-hardened webPreferences
 *
 * @module WindowManager
 */

import type { AppModule } from '../AppModule.js';
import { ModuleContext } from '../ModuleContext.js';
import { BrowserWindow, nativeImage } from 'electron';
import type { AppInitConfig } from '../AppInitConfig.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * WindowManager class implementing the AppModule interface
 */
class WindowManager implements AppModule {
  /** Preload script configuration (private) */
  readonly #preload: { path: string };

  /** Renderer configuration (private) - can be file path or dev server URL */
  readonly #renderer: { path: string } | URL;

  /** Whether to automatically open DevTools (private) */
  readonly #openDevTools;

  /**
   * Creates a new WindowManager instance
   * @param initConfig - Application initialization configuration
   * @param openDevTools - Whether to open DevTools automatically (default: false)
   */
  constructor({
    initConfig,
    openDevTools = false,
  }: {
    initConfig: AppInitConfig;
    openDevTools?: boolean;
  }) {
    this.#preload = initConfig.preload;
    this.#renderer = initConfig.renderer;
    this.#openDevTools = openDevTools;
  }

  /**
   * Enables the window manager module and sets up event listeners
   * Called by the module runner during app initialization
   * @param context - Module context with app instance
   */
  async enable({ app }: ModuleContext): Promise<void> {
    await app.whenReady();
    await this.restoreOrCreateWindow(true);

    // macOS: Restore window when dock icon is clicked and no windows are open
    app.on('activate', () => this.restoreOrCreateWindow(true));

    // Windows/Linux: Focus window when second instance is launched
    app.on('second-instance', () => this.restoreOrCreateWindow(true));
  }

  /**
   * Creates a new BrowserWindow with configured security settings and custom icon
   * @returns Promise resolving to the created BrowserWindow instance
   */
  async createWindow(): Promise<BrowserWindow> {
    // Get icon path - works in both dev and production
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const iconPath = join(__dirname, '../../../../buildResources/icon.png');
    const icon = nativeImage.createFromPath(iconPath);

    const browserWindow = new BrowserWindow({
      show: false, // Use 'ready-to-show' event to prevent visual flash
      icon: icon,
      webPreferences: {
        nodeIntegration: false, // Security: Disable Node.js in renderer
        contextIsolation: true, // Security: Isolate renderer from preload context
        sandbox: false, // Disabled to allow preload script Node.js API access
        webviewTag: false, // Security: Disable deprecated webview tag
        preload: this.#preload.path, // Security bridge to main process
      },
    });

    // Load renderer: dev server URL or built HTML file
    if (this.#renderer instanceof URL) {
      await browserWindow.loadURL(this.#renderer.href);
    } else {
      await browserWindow.loadFile(this.#renderer.path);
    }

    return browserWindow;
  }

  /**
   * Restores an existing window or creates a new one if needed
   * @param show - Whether to show and focus the window (default: false)
   * @returns Promise resolving to the BrowserWindow instance
   */
  async restoreOrCreateWindow(show = false) {
    // Find existing non-destroyed window
    let window = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());

    // Create new window if none exists
    if (window === undefined) {
      window = await this.createWindow();
    }

    if (!show) {
      return window;
    }

    // Restore minimized window
    if (window.isMinimized()) {
      window.restore();
    }

    window?.show();

    // Open DevTools in development mode
    if (this.#openDevTools) {
      window?.webContents.openDevTools();
    }

    window.focus();

    return window;
  }
}

/**
 * Factory function to create a WindowManager module instance
 * @param args - Constructor parameters for WindowManager
 * @returns WindowManager instance
 */
export function createWindowManagerModule(...args: ConstructorParameters<typeof WindowManager>) {
  return new WindowManager(...args);
}
