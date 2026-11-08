/**
 * Playlists stored in `.jamman-playlists.json` in the SD folder (or in the bank
 * folder of a pedal over USB), and their export as a printable setlist.
 *
 * Channels: `playlists:load|create|update|delete|addPatches|removePatches|reorderPatches|export`.
 *
 * @module ipc/playlists
 */
import * as path from 'node:path';
import type {
  IpcHandlers,
  Playlist as PlaylistView,
  PlaylistData as PlaylistDataView,
} from '@app/preload/ipc-contract';
import { SecureXMLParser } from '../SecureXMLParser.js';
import type { IpcDeps } from './deps.js';
import { ipcError } from './errors.js';
import { isPedalPath, parseBankPath } from '../usb/pedalPaths.js';
import type { PlaylistBase } from '../PlaylistManager.js';

export type PlaylistChannel =
  | 'playlists:load'
  | 'playlists:create'
  | 'playlists:update'
  | 'playlists:delete'
  | 'playlists:addPatches'
  | 'playlists:removePatches'
  | 'playlists:reorderPatches'
  | 'playlists:export';

/**
 * PlaylistManager returns every playlist with `patches` (its patch IDs
 * resolved to folder names), but its declared types leave that field out.
 * These narrow its results to what it really returns.
 */
const asView = (playlist: object) => playlist as PlaylistView;
const asDataView = (data: object) => data as PlaylistDataView;

export function createPlaylistHandlers({
  fs,
  log,
  dialog,
  app,
  folderAccess,
  playlistManager,
  pedal,
}: Pick<
  IpcDeps,
  'fs' | 'log' | 'dialog' | 'app' | 'folderAccess' | 'playlistManager' | 'pedal'
>): IpcHandlers<PlaylistChannel> {
  /**
   * Where the playlists of `basePath` live: the approved card folder
   * (Security: only that one), or a pedal bank over USB.
   */
  const resolveBase = (basePath: string): PlaylistBase => {
    if (isPedalPath(basePath)) {
      const bank = parseBankPath(basePath);
      if (!bank) throw new Error('Invalid pedal folder path');
      return pedal.playlistStore(bank);
    }
    folderAccess.assertRoot(basePath);
    return basePath;
  };

  /** Patch name of each folder, or '' when it cannot be read. */
  const readPatchName = async (basePath: string, patchDir: string) => {
    const patchXmlPath = path.join(basePath, patchDir, 'patch.xml');
    if (!fs.existsSync(patchXmlPath)) {
      return { dir: patchDir, name: '' };
    }
    try {
      const xmlContent = fs.readFileSync(patchXmlPath, 'utf-8');
      // Security: Use hardened XML parser to prevent XXE attacks
      const result = await SecureXMLParser.parsePatchXML(xmlContent);
      return { dir: patchDir, name: result.JamManPatch?.PatchName?.[0] || '' };
    } catch {
      return { dir: patchDir, name: '' };
    }
  };

  return {
    'playlists:load': async basePath => {
      const base = resolveBase(basePath);
      try {
        log.info('Loading playlists:', basePath);
        const data = asDataView(await playlistManager.loadPlaylists(base));
        log.info('Playlists loaded:', data.playlists.length);
        return data;
      } catch (error) {
        throw ipcError(log, 'Error loading playlists:', 'Failed to load playlists', error);
      }
    },

    'playlists:create': async (basePath, name, patches) => {
      const base = resolveBase(basePath);
      try {
        log.info('Creating playlist:', { basePath, name, patchCount: patches?.length });
        const playlist = asView(await playlistManager.createPlaylist(base, name, patches));
        log.info('Playlist created:', playlist.id);
        return playlist;
      } catch (error) {
        throw ipcError(log, 'Error creating playlist:', 'Failed to create playlist', error);
      }
    },

    'playlists:update': async (basePath, playlistId, updates) => {
      const base = resolveBase(basePath);
      try {
        log.info('Updating playlist:', { basePath, playlistId, updates });
        const playlist = asView(await playlistManager.updatePlaylist(base, playlistId, updates));
        log.info('Playlist updated:', playlist.id);
        return playlist;
      } catch (error) {
        throw ipcError(log, 'Error updating playlist:', 'Failed to update playlist', error);
      }
    },

    'playlists:delete': async (basePath, playlistId) => {
      const base = resolveBase(basePath);
      try {
        log.info('Deleting playlist:', { basePath, playlistId });
        await playlistManager.deletePlaylist(base, playlistId);
        log.info('Playlist deleted:', playlistId);
        return { success: true } as const;
      } catch (error) {
        throw ipcError(log, 'Error deleting playlist:', 'Failed to delete playlist', error);
      }
    },

    'playlists:addPatches': async (basePath, playlistId, patchDirs) => {
      const base = resolveBase(basePath);
      try {
        log.info('Adding patches to playlist:', {
          basePath,
          playlistId,
          patchCount: patchDirs.length,
        });
        const playlist = asView(
          await playlistManager.addPatchesToPlaylist(base, playlistId, patchDirs),
        );
        log.info('Patches added to playlist:', playlist.id);
        return playlist;
      } catch (error) {
        throw ipcError(
          log,
          'Error adding patches to playlist:',
          'Failed to add patches to playlist',
          error,
        );
      }
    },

    'playlists:removePatches': async (basePath, playlistId, patchDirs) => {
      const base = resolveBase(basePath);
      try {
        log.info('Removing patches from playlist:', {
          basePath,
          playlistId,
          patchCount: patchDirs.length,
        });
        const playlist = asView(
          await playlistManager.removePatchesFromPlaylist(base, playlistId, patchDirs),
        );
        log.info('Patches removed from playlist:', playlist.id);
        return playlist;
      } catch (error) {
        throw ipcError(
          log,
          'Error removing patches from playlist:',
          'Failed to remove patches from playlist',
          error,
        );
      }
    },

    'playlists:reorderPatches': async (basePath, playlistId, newOrder) => {
      const base = resolveBase(basePath);
      try {
        log.info('Reordering patches in playlist:', {
          basePath,
          playlistId,
          patchCount: newOrder.length,
        });
        const playlist = asView(
          await playlistManager.reorderPlaylistPatches(base, playlistId, newOrder),
        );
        log.info('Playlist patches reordered:', playlist.id);
        return playlist;
      } catch (error) {
        throw ipcError(
          log,
          'Error reordering playlist patches:',
          'Failed to reorder playlist patches',
          error,
        );
      }
    },

    'playlists:export': async (basePath, playlistId) => {
      const base = resolveBase(basePath);
      try {
        log.info('Exporting playlist:', { basePath, playlistId });

        const data = asDataView(await playlistManager.loadPlaylists(base));
        const playlist = data.playlists.find(p => p.id === playlistId);
        if (!playlist) {
          throw new Error(`Playlist not found: ${playlistId}`);
        }

        const { filePath, canceled } = await dialog.showSaveDialog({
          title: 'Export Playlist as Setlist',
          defaultPath: path.join(app.getPath('documents'), `${playlist.name}-setlist.txt`),
          filters: [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (canceled || !filePath) {
          log.info('Playlist export canceled by user');
          return { success: false, canceled: true } as const;
        }

        const patches = await Promise.all(
          (playlist.patches || []).map(async patchDir => {
            const bank = parseBankPath(basePath);
            return bank
              ? { dir: patchDir, name: await pedal.patchName(bank, patchDir) }
              : readPatchName(basePath, patchDir);
          }),
        );

        let content = `${playlist.name}\n`;
        content += `${'='.repeat(playlist.name.length)}\n\n`;
        content += `Created: ${new Date().toLocaleString()}\n`;
        content += `Patches: ${patches.length}\n\n`;
        content += `Setlist:\n`;
        content += `--------\n\n`;
        patches.forEach((patch, index) => {
          const num = String(index + 1).padStart(2, '0');
          content += `${num}. ${patch.dir}`;
          if (patch.name) {
            content += ` - ${patch.name}`;
          }
          content += `\n`;
        });
        content += `\n\nGenerated by JamMan Manager\n`;

        fs.writeFileSync(filePath, content, 'utf-8');

        log.info('Playlist exported successfully:', filePath);
        return { success: true, filePath } as const;
      } catch (error) {
        throw ipcError(log, 'Error exporting playlist:', 'Failed to export playlist', error);
      }
    },
  };
}
