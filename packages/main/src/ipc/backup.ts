/**
 * ZIP backups of the SD folder: create (to a file the user picks), validate
 * and restore.
 *
 * Channels: `backup:create`, `backup:validate`, `backup:restore`
 * (`backup:selectFile` lives in `dialogs.ts`).
 *
 * @module ipc/backup
 */
import * as path from 'node:path';
import type { IpcHandlers } from '@app/preload/ipc-contract';
import { OperationPriority } from '../OperationQueue.js';
import type { IpcDeps } from './deps.js';
import { ipcError } from './errors.js';

export type BackupChannel = 'backup:create' | 'backup:validate' | 'backup:restore';

export function createBackupHandlers({
  log,
  dialog,
  app,
  folderAccess,
  operationQueue,
  patchCache,
  backupManager,
}: Pick<
  IpcDeps,
  'log' | 'dialog' | 'app' | 'folderAccess' | 'operationQueue' | 'patchCache' | 'backupManager'
>): IpcHandlers<BackupChannel> {
  return {
    'backup:create': async (basePath, patches, includePlaylist) => {
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

            if (canceled || !filePath) {
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
