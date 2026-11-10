import { AppModule } from '../AppModule.js';
import electronUpdater, { type AppUpdater, type Logger } from 'electron-updater';

type DownloadNotification = Parameters<AppUpdater['checkForUpdatesAndNotify']>[0];

export class AutoUpdater implements AppModule {
  readonly #logger: Logger | null;
  readonly #notification: DownloadNotification;

  constructor({
    logger = null,
    downloadNotification = undefined,
  }: {
    logger?: Logger | null | undefined;
    downloadNotification?: DownloadNotification;
  } = {}) {
    this.#logger = logger;
    this.#notification = downloadNotification;
  }

  async enable(): Promise<void> {
    await this.runAutoUpdater();
  }

  getAutoUpdater(): AppUpdater {
    // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.
    // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.
    const { autoUpdater } = electronUpdater;
    return autoUpdater;
  }

  async runAutoUpdater() {
    const updater = this.getAutoUpdater();
    try {
      updater.logger = this.#logger || null;
      updater.fullChangelog = true;

      if (import.meta.env.VITE_DISTRIBUTION_CHANNEL) {
        updater.channel = import.meta.env.VITE_DISTRIBUTION_CHANNEL;
      }

      return await updater.checkForUpdatesAndNotify(this.#notification);
    } catch (error) {
      // An update check must never break startup. It fails when there is no release yet, when
      // a tag is pushed but its release is still a draft (GitHub's feed already lists the tag,
      // its latest*.yml is a 404), offline, or when GitHub rate-limits the request.
      if (!(error instanceof Error && error.message.includes('No published versions'))) {
        this.#logger?.warn(
          `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }
}

export function autoUpdater(...args: ConstructorParameters<typeof AutoUpdater>) {
  return new AutoUpdater(...args);
}
