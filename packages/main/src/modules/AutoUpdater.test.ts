import { describe, expect, it, vi } from 'vitest';
import type { AppUpdater, Logger } from 'electron-updater';

vi.mock('electron-updater', () => import('../test-utils/updaterMock.js'));

const { AutoUpdater } = await import('./AutoUpdater.js');

function withUpdater(check: () => Promise<unknown>) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
  const updater = new AutoUpdater({ logger });
  vi.spyOn(updater, 'getAutoUpdater').mockReturnValue({
    checkForUpdatesAndNotify: check,
  } as unknown as AppUpdater);
  return { updater, warn: logger.warn as ReturnType<typeof vi.fn> };
}

describe('AutoUpdater', () => {
  it('returns the update check result', async () => {
    const result = { updateInfo: { version: '9.9.9' } };
    const { updater } = withUpdater(async () => result);

    await expect(updater.runAutoUpdater()).resolves.toBe(result);
  });

  it('ignores "No published versions" without logging it', async () => {
    const { updater, warn } = withUpdater(async () => {
      throw new Error('No published versions on GitHub');
    });

    await expect(updater.runAutoUpdater()).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  // A pushed tag whose release is still a draft: GitHub's feed lists the tag, but its
  // latest*.yml does not exist yet. This must not reject and break app startup.
  it('logs any other failure and does not reject', async () => {
    const error = new Error('Cannot find latest-linux.yml in the latest release artifacts: 404');
    const { updater, warn } = withUpdater(async () => {
      throw error;
    });

    await expect(updater.runAutoUpdater()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('Update check failed:', error);
  });
});
