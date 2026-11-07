/**
 * Native dialogs. These are the only way the renderer gains access to a path:
 * the folder picked becomes the approved root, and a file picked may be read.
 *
 * Channels: `dialog:selectFolder`, `dialog:selectFile`, `backup:selectFile`.
 *
 * @module ipc/dialogs
 */
import type { IpcHandlers } from '@app/preload/ipc-contract';
import type { IpcDeps } from './deps.js';
import { errorMessage } from './errors.js';

export type DialogChannel = 'dialog:selectFolder' | 'dialog:selectFile' | 'backup:selectFile';

export function createDialogHandlers({
  dialog,
  folderAccess,
  log,
  app,
}: Pick<IpcDeps, 'dialog' | 'folderAccess' | 'log' | 'app'>): IpcHandlers<DialogChannel> {
  return {
    'dialog:selectFolder': async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory'],
        });
        const folder = result.canceled ? undefined : result.filePaths[0];
        if (folder) {
          // Security: the folder picked by the user becomes the only approved root.
          folderAccess.approveRoot(folder);
        }
        return folder;
      } catch (error) {
        log.error('Error selecting folder:', error);
        throw new Error('Failed to open folder selection dialog');
      }
    },

    'dialog:selectFile': async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Audio', extensions: ['wav'] }],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        // Security: the renderer may read the file the user just picked
        folderAccess.grantFile(result.filePaths[0]);
        return result.filePaths[0];
      } catch (error) {
        log.error('Error selecting file:', error);
        throw new Error('Failed to open file selection dialog');
      }
    },

    'backup:selectFile': async () => {
      try {
        const { filePaths, canceled } = await dialog.showOpenDialog({
          title: 'Select Backup File',
          defaultPath: app.getPath('documents'),
          filters: [
            { name: 'JamMan Backup', extensions: ['jamman-backup.zip', 'zip'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });

        if (canceled || filePaths.length === 0) {
          log.info('Backup file selection canceled by user');
          return null;
        }

        // Security: the renderer may read the backup the user just picked
        folderAccess.grantFile(filePaths[0]);
        log.info('Backup file selected:', filePaths[0]);
        return filePaths[0];
      } catch (error) {
        log.error('Error selecting backup file:', error);
        throw new Error(`Failed to select backup file: ${errorMessage(error)}`);
      }
    },
  };
}
