/**
 * ZIP backups of the SD folder: create (to a file the user picks), validate
 * and restore.
 *
 * Channels: `backup:create`, `backup:validate`, `backup:restore`
 * (`backup:selectFile` lives in `dialogs.ts`).
 *
 * @module ipc/backup
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IpcHandlers } from '@app/preload/ipc-contract';
import { OperationPriority } from '../OperationQueue.js';
import type { IpcDeps } from './deps.js';
import { ipcError } from './errors.js';
import { isPedalPath, parseBankPath, PATCH_DIR_RE } from '../usb/pedalPaths.js';

export type BackupChannel = 'backup:create' | 'backup:validate' | 'backup:restore';

export function createBackupHandlers({
  log,
  dialog,
  app,
  folderAccess,
  operationQueue,
  patchCache,
  backupManager,
  pedal,
}: Pick<
  IpcDeps,
  | 'log'
  | 'dialog'
  | 'app'
  | 'folderAccess'
  | 'operationQueue'
  | 'patchCache'
  | 'backupManager'
  | 'pedal'
>): IpcHandlers<BackupChannel> {
  const pedalBank = (basePath: string) => {
    const bank = parseBankPath(basePath);
    if (!bank) throw new Error('Invalid pedal folder path');
    return bank;
  };

  /** Asks where to save a backup; null when the user cancels. */
  const pickBackupFile = async (): Promise<string | null> => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Save Backup',
      defaultPath: path.join(
        app.getPath('documents'),
        `jamman-backup-${new Date().toISOString().split('T')[0]}.jamman-backup.zip`,
      ),
      filters: [
        { name: 'JamMan Backup', extensions: ['jamman-backup.zip', 'zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return canceled || !filePath ? null : filePath;
  };

  return {
    'backup:create': async (basePath, patches, includePlaylist) => {
      if (isPedalPath(basePath)) {
        const bank = pedalBank(basePath);
        if (
          patches !== undefined &&
          (!Array.isArray(patches) || !patches.every(d => PATCH_DIR_RE.test(d)))
        ) {
          throw new Error('Invalid patch directory names');
        }
        // Ask first: the download that follows can take a while.
        const outputPath = await pickBackupFile();
        if (!outputPath) return { success: false, canceled: true } as const;
        // A local folder laid out like the card, with the audio from the cache.
        const written = await pedal.withLocalWorkDir(async dir => {
          const exported = await pedal.exportBank(bank, patches, !!includePlaylist, dir);
          if (exported.length === 0) throw new Error('No patches found to backup');
          return backupManager.createBackup({
            basePath: dir,
            outputPath,
            patches: exported,
            includePlaylist,
            appVersion: app.getVersion(),
          });
        });
        log.info('Backup of the pedal created:', written);
        return { success: true, filePath: written } as const;
      }
      // Security: approved folder only
      folderAccess.assertRoot(basePath);
      return operationQueue.enqueue(
        'backup:create',
        'Create backup',
        async () => {
          try {
            log.info('Creating backup...', {
              basePath,
              patchCount: patches?.length || 'all',
              includePlaylist,
            });

            const filePath = await pickBackupFile();
            if (!filePath) {
              log.info('Backup creation canceled by user');
              return { success: false, canceled: true } as const;
            }

            const outputPath = await backupManager.createBackup({
              basePath,
              outputPath: filePath,
              patches,
              includePlaylist,
              appVersion: app.getVersion(),
            });

            log.info('Backup created successfully:', outputPath);
            return { success: true, filePath: outputPath } as const;
          } catch (error) {
            throw ipcError(log, 'Error creating backup:', 'Failed to create backup', error);
          }
        },
        OperationPriority.NORMAL,
      );
    },

    'backup:validate': async backupPath => {
      // Security: a backup the user picked in the dialog, or one inside the approved folder
      folderAccess.assertReadableFile(backupPath, ['.zip']);
      try {
        log.info('Validating backup:', backupPath);
        const info = await backupManager.validateBackup(backupPath);
        log.info('Backup validation result:', info);
        return info;
      } catch (error) {
        throw ipcError(log, 'Error validating backup:', 'Failed to validate backup', error);
      }
    },

    'backup:restore': async (backupPath, targetPath, mode, patches) => {
      if (isPedalPath(targetPath)) {
        // Security: a backup the user picked in the dialog
        folderAccess.assertReadableFile(backupPath, ['.zip']);
        const bank = pedalBank(targetPath);
        return pedal.withLocalWorkDir(async dir => {
          // Empty stand-ins for the slots in use on the pedal, so a merge gives
          // backup patches the same new numbers it would on a card.
          for (const used of await pedal.listPatchDirs(bank)) fs.mkdirSync(path.join(dir, used));
          const result = await backupManager.restoreBackup({
            backupPath,
            targetPath: dir,
            mode,
            patches,
          });
          const restored = fs
            .readdirSync(dir)
            .filter(d => PATCH_DIR_RE.test(d) && fs.existsSync(path.join(dir, d, 'patch.xml')));
          await pedal.importPatches(bank, dir, restored, mode === 'replace');
          log.info(`Backup restored onto the pedal (${mode}):`, restored);
          return result;
        });
      }
      // Security: picked backup file and approved target folder only
      folderAccess.assertReadableFile(backupPath, ['.zip']);
      folderAccess.assertRoot(targetPath);
      return operationQueue.enqueue(
        'backup:restore',
        `Restore backup (${mode} mode)`,
        async () => {
          try {
            log.info('Restoring backup...', { backupPath, targetPath, mode, patches });
            const result = await backupManager.restoreBackup({
              backupPath,
              targetPath,
              mode,
              patches,
            });
            log.info('Backup restored successfully:', result);

            // The folder changed under the cache
            patchCache.invalidate(targetPath);
            return result;
          } catch (error) {
            throw ipcError(log, 'Error restoring backup:', 'Failed to restore backup', error);
          }
        },
        OperationPriority.HIGH,
      );
    },
  };
}
