/**
 * Stand-in for `electron-updater` in tests: never checks for updates.
 *
 * @module test-utils/updaterMock
 */
const autoUpdater = {
  logger: null as unknown,
  fullChangelog: false,
  channel: undefined as string | undefined,
  checkForUpdatesAndNotify: async () => null,
};

export default { autoUpdater };
