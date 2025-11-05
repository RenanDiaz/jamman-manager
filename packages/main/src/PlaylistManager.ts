import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface Playlist {
  id: string;
  name: string;
  patchIds: string[]; // Array of patch IDs (from patch.xml <ID> field) in order
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistData {
  version: string;
  playlists: Playlist[];
}

export class PlaylistManager {
  private static readonly PLAYLIST_FILENAME = '.jamman-playlists.json';
  private static readonly VERSION = '2.0'; // Incremented for ID-based storage

  /**
   * Get the playlist file path for a given base path
   */
  private static getPlaylistPath(basePath: string): string {
    return path.join(basePath, this.PLAYLIST_FILENAME);
  }

  /**
   * Get patch ID from a patch directory
   */
  private static async getPatchId(basePath: string, patchDir: string): Promise<string | null> {
    const patchXmlPath = path.join(basePath, patchDir, 'patch.xml');
    if (!fs.existsSync(patchXmlPath)) {
      return null;
    }

    try {
      const xml2js = await import('xml2js');
      const xmlContent = fs.readFileSync(patchXmlPath, 'utf-8');
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlContent);
      return result.JamManPatch?.ID?.[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Get all patches with their IDs (returns map of patchId -> directory)
   */
  private static async getAllPatchIds(basePath: string): Promise<Map<string, string>> {
    const patchMap = new Map<string, string>();

    try {
      const entries = fs.readdirSync(basePath);

      for (const entry of entries) {
        const fullPath = path.join(basePath, entry);
        if (fs.statSync(fullPath).isDirectory() && entry.startsWith('Patch')) {
          const patchId = await this.getPatchId(basePath, entry);
          if (patchId) {
            patchMap.set(patchId, entry);
          }
        }
      }
    } catch (error) {
      console.error('Error reading patch IDs:', error);
    }

    return patchMap;
  }

  /**
   * Convert directory names to patch IDs
   */
  private static async dirsToIds(basePath: string, dirs: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const dir of dirs) {
      const id = await this.getPatchId(basePath, dir);
      if (id) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Convert patch IDs to current directory names
   */
  private static async idsToDirs(basePath: string, ids: string[]): Promise<string[]> {
    const patchMap = await this.getAllPatchIds(basePath);
    return ids.map(id => patchMap.get(id)).filter((dir): dir is string => dir !== undefined);
  }

  /**
   * Load playlists from disk and resolve patch IDs to current directory names
   */
  static async loadPlaylists(basePath: string): Promise<PlaylistData & { patches: any[] }> {
    const playlistPath = this.getPlaylistPath(basePath);

    if (!fs.existsSync(playlistPath)) {
      return {
        version: this.VERSION,
        playlists: [],
        patches: [],
      };
    }

    try {
      const content = fs.readFileSync(playlistPath, 'utf-8');
      const data: any = JSON.parse(content);

      // Migrate from v1 (directory-based) to v2 (ID-based)
      if (!data.version || data.version === '1.0') {
        console.log('Migrating playlists from v1 to v2...');
        for (const playlist of data.playlists || []) {
          if (playlist.patches && !playlist.patchIds) {
            // Convert directory names to IDs
            playlist.patchIds = await this.dirsToIds(basePath, playlist.patches);
            delete playlist.patches;
          }
        }
        data.version = this.VERSION;
        this.savePlaylists(basePath, data);
      }

      // Validate structure
      if (!data.version) {
        data.version = this.VERSION;
      }

      if (!Array.isArray(data.playlists)) {
        data.playlists = [];
      }

      // Resolve patch IDs to current directory names for each playlist
      const playlistsWithDirs = await Promise.all(
        data.playlists.map(async (playlist: Playlist) => {
          const dirs = await this.idsToDirs(basePath, playlist.patchIds || []);
          return {
            ...playlist,
            patches: dirs, // For frontend compatibility
          };
        }),
      );

      return {
        version: data.version,
        playlists: playlistsWithDirs,
        patches: [], // Deprecated, kept for compatibility
      };
    } catch (error) {
      console.error('Failed to load playlists:', error);
      return {
        version: this.VERSION,
        playlists: [],
        patches: [],
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
  static async createPlaylist(
    basePath: string,
    name: string,
    patchDirs: string[] = [],
  ): Promise<Playlist> {
    const data = await this.loadPlaylists(basePath);

    // Check for duplicate names
    if (data.playlists.some(p => p.name === name)) {
      throw new Error(`Playlist "${name}" already exists`);
    }

    // Convert directory names to IDs
    const patchIds = await this.dirsToIds(basePath, patchDirs);

    const now = new Date().toISOString();
    const playlist: Playlist = {
      id: uuidv4(),
      name,
      patchIds,
      createdAt: now,
      updatedAt: now,
    };

    data.playlists.push(playlist);
    this.savePlaylists(basePath, data);

    // Return with directory names for frontend
    return {
      ...playlist,
      patches: patchDirs,
    } as any;
  }

  /**
   * Update an existing playlist
   */
  static async updatePlaylist(
    basePath: string,
    playlistId: string,
    updates: { name?: string; patches?: string[] },
  ): Promise<Playlist> {
    const data = await this.loadPlaylists(basePath);
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
      playlist.patchIds = await this.dirsToIds(basePath, updates.patches);
    }

    playlist.updatedAt = new Date().toISOString();

    this.savePlaylists(basePath, data);

    // Return with directory names
    const dirs = await this.idsToDirs(basePath, playlist.patchIds);
    return {
      ...playlist,
      patches: dirs,
    } as any;
  }

  /**
   * Delete a playlist
   */
  static async deletePlaylist(basePath: string, playlistId: string): Promise<void> {
    const data = await this.loadPlaylists(basePath);
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
  static async addPatchesToPlaylist(
    basePath: string,
    playlistId: string,
    patchDirs: string[],
  ): Promise<Playlist> {
    const data = await this.loadPlaylists(basePath);
    const playlist = data.playlists.find(p => p.id === playlistId);

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    // Convert dirs to IDs and add patches that aren't already in the playlist
    const idsToAdd = await this.dirsToIds(basePath, patchDirs);
    for (const id of idsToAdd) {
      if (!playlist.patchIds.includes(id)) {
        playlist.patchIds.push(id);
      }
    }

    playlist.updatedAt = new Date().toISOString();
    this.savePlaylists(basePath, data);

    // Return with directory names
    const dirs = await this.idsToDirs(basePath, playlist.patchIds);
    return {
      ...playlist,
      patches: dirs,
    } as any;
  }

  /**
   * Remove patches from a playlist
   */
  static async removePatchesFromPlaylist(
    basePath: string,
    playlistId: string,
    patchDirs: string[],
  ): Promise<Playlist> {
    const data = await this.loadPlaylists(basePath);
    const playlist = data.playlists.find(p => p.id === playlistId);

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    // Convert dirs to IDs and remove them
    const idsToRemove = await this.dirsToIds(basePath, patchDirs);
    playlist.patchIds = playlist.patchIds.filter(id => !idsToRemove.includes(id));
    playlist.updatedAt = new Date().toISOString();
    this.savePlaylists(basePath, data);

    // Return with directory names
    const dirs = await this.idsToDirs(basePath, playlist.patchIds);
    return {
      ...playlist,
      patches: dirs,
    } as any;
  }

  /**
   * Reorder patches within a playlist
   */
  static async reorderPlaylistPatches(
    basePath: string,
    playlistId: string,
    newOrderDirs: string[],
  ): Promise<Playlist> {
    const data = await this.loadPlaylists(basePath);
    const playlist = data.playlists.find(p => p.id === playlistId);

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    // Convert new order to IDs
    const newOrderIds = await this.dirsToIds(basePath, newOrderDirs);

    // Validate that all patches in newOrder are in the playlist
    const validIds = newOrderIds.filter(id => playlist.patchIds.includes(id));

    if (validIds.length !== playlist.patchIds.length) {
      throw new Error('Invalid patch order: some patches are missing');
    }

    playlist.patchIds = validIds;
    playlist.updatedAt = new Date().toISOString();
    this.savePlaylists(basePath, data);

    // Return with directory names
    const dirs = await this.idsToDirs(basePath, playlist.patchIds);
    return {
      ...playlist,
      patches: dirs,
    } as any;
  }

  /**
   * Get all patches that are in a specific playlist
   */
  static async getPlaylistPatches(basePath: string, playlistId: string): Promise<string[]> {
    const data = await this.loadPlaylists(basePath);
    const playlist = data.playlists.find(p => p.id === playlistId);

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    return await this.idsToDirs(basePath, playlist.patchIds);
  }

  /**
   * Clean up deleted patches from all playlists
   * Removes references to patches that no longer exist
   */
  static async cleanupDeletedPatches(basePath: string, existingPatchDirs: string[]): Promise<void> {
    const data = await this.loadPlaylists(basePath);
    const existingIds = await this.dirsToIds(basePath, existingPatchDirs);
    let modified = false;

    for (const playlist of data.playlists) {
      const originalLength = playlist.patchIds.length;
      playlist.patchIds = playlist.patchIds.filter(id => existingIds.includes(id));

      if (playlist.patchIds.length !== originalLength) {
        playlist.updatedAt = new Date().toISOString();
        modified = true;
      }
    }

    if (modified) {
      this.savePlaylists(basePath, data);
    }
  }
}
