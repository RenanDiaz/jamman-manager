import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface Playlist {
  id: string;
  name: string;
  patches: string[]; // Array of patch directory names in order
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistData {
  version: string;
  playlists: Playlist[];
}

export class PlaylistManager {
  private static readonly PLAYLIST_FILENAME = '.jamman-playlists.json';
  private static readonly VERSION = '1.0';

  /**
   * Get the playlist file path for a given base path
   */
  private static getPlaylistPath(basePath: string): string {
    return path.join(basePath, this.PLAYLIST_FILENAME);
  }

  /**
   * Load playlists from disk
   */
  static loadPlaylists(basePath: string): PlaylistData {
    const playlistPath = this.getPlaylistPath(basePath);

    if (!fs.existsSync(playlistPath)) {
      return {
        version: this.VERSION,
        playlists: [],
      };
    }

    try {
      const content = fs.readFileSync(playlistPath, 'utf-8');
      const data: PlaylistData = JSON.parse(content);

      // Validate and migrate if needed
      if (!data.version) {
        data.version = this.VERSION;
      }

      if (!Array.isArray(data.playlists)) {
        data.playlists = [];
      }

      return data;
    } catch (error) {
      console.error('Failed to load playlists:', error);
      return {
        version: this.VERSION,
        playlists: [],
      };
    }
  }

  /**
   * Save playlists to disk
   */
  static savePlaylists(basePath: string, data: PlaylistData): void {
    const playlistPath = this.getPlaylistPath(basePath);

    try {
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(playlistPath, content, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to save playlists: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Create a new playlist
   */
  static createPlaylist(basePath: string, name: string, patches: string[] = []): Playlist {
    const data = this.loadPlaylists(basePath);

    // Check for duplicate names
    if (data.playlists.some(p => p.name === name)) {
      throw new Error(`Playlist "${name}" already exists`);
    }

    const now = new Date().toISOString();
    const playlist: Playlist = {
      id: uuidv4(),
      name,
      patches,
      createdAt: now,
      updatedAt: now,
    };

    data.playlists.push(playlist);
    this.savePlaylists(basePath, data);

    return playlist;
  }

  /**
   * Update an existing playlist
   */
  static updatePlaylist(
    basePath: string,
    playlistId: string,
    updates: { name?: string; patches?: string[] },
  ): Playlist {
    const data = this.loadPlaylists(basePath);
    const playlist = data.playlists.find(p => p.id === playlistId);

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    // Check for duplicate names if renaming
    if (updates.name && updates.name !== playlist.name) {
      if (data.playlists.some(p => p.id !== playlistId && p.name === updates.name)) {
        throw new Error(`Playlist "${updates.name}" already exists`);
      }
      playlist.name = updates.name;
    }

    if (updates.patches !== undefined) {
      playlist.patches = updates.patches;
    }

    playlist.updatedAt = new Date().toISOString();

    this.savePlaylists(basePath, data);

    return playlist;
  }

  /**
   * Delete a playlist
   */
  static deletePlaylist(basePath: string, playlistId: string): void {
    const data = this.loadPlaylists(basePath);
    const index = data.playlists.findIndex(p => p.id === playlistId);

    if (index === -1) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    data.playlists.splice(index, 1);
    this.savePlaylists(basePath, data);
  }

  /**
   * Add patches to a playlist
   */
  static addPatchesToPlaylist(basePath: string, playlistId: string, patchDirs: string[]): Playlist {
    const data = this.loadPlaylists(basePath);
    const playlist = data.playlists.find(p => p.id === playlistId);

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    // Add patches that aren't already in the playlist
    for (const patchDir of patchDirs) {
      if (!playlist.patches.includes(patchDir)) {
        playlist.patches.push(patchDir);
      }
    }

    playlist.updatedAt = new Date().toISOString();

    this.savePlaylists(basePath, data);

    return playlist;
  }

  /**
   * Remove patches from a playlist
   */
  static removePatchesFromPlaylist(
    basePath: string,
    playlistId: string,
    patchDirs: string[],
  ): Playlist {
    const data = this.loadPlaylists(basePath);
    const playlist = data.playlists.find(p => p.id === playlistId);

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    playlist.patches = playlist.patches.filter(p => !patchDirs.includes(p));
    playlist.updatedAt = new Date().toISOString();

    this.savePlaylists(basePath, data);

    return playlist;
  }

  /**
   * Reorder patches within a playlist
   */
  static reorderPlaylistPatches(
    basePath: string,
    playlistId: string,
    newOrder: string[],
  ): Playlist {
    const data = this.loadPlaylists(basePath);
    const playlist = data.playlists.find(p => p.id === playlistId);

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    // Validate that all patches in newOrder are in the playlist
    const validPatches = newOrder.filter(p => playlist.patches.includes(p));

    if (validPatches.length !== playlist.patches.length) {
      throw new Error('Invalid patch order: some patches are missing');
    }

    playlist.patches = validPatches;
    playlist.updatedAt = new Date().toISOString();

    this.savePlaylists(basePath, data);

    return playlist;
  }

  /**
   * Get all patches that are in a specific playlist
   */
  static getPlaylistPatches(basePath: string, playlistId: string): string[] {
    const data = this.loadPlaylists(basePath);
    const playlist = data.playlists.find(p => p.id === playlistId);

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    return playlist.patches;
  }

  /**
   * Clean up deleted patches from all playlists
   * Removes references to patches that no longer exist
   */
  static cleanupDeletedPatches(basePath: string, existingPatchDirs: string[]): void {
    const data = this.loadPlaylists(basePath);
    let modified = false;

    for (const playlist of data.playlists) {
      const originalLength = playlist.patches.length;
      playlist.patches = playlist.patches.filter(p => existingPatchDirs.includes(p));

      if (playlist.patches.length !== originalLength) {
        playlist.updatedAt = new Date().toISOString();
        modified = true;
      }
    }

    if (modified) {
      this.savePlaylists(basePath, data);
    }
  }
}
