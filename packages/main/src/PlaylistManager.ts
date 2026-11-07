import * as fs from 'fs';
import * as path from 'path';
import { SecureXMLParser } from './SecureXMLParser.js';
import {
  PLAYLIST_SCHEMA_VERSION,
  collectLegacyPatchDirs,
  migratePlaylistFile,
} from './PlaylistSchema.js';

export interface Playlist {
  id: string;
  name: string;
  patchIds: string[]; // Array of patch IDs (from patch.xml <ID> field) in order
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistData {
  /** Written on save; a file without it is the legacy v1 schema (see PlaylistSchema.ts). */
  schemaVersion?: number;
  version: string;
  playlists: Playlist[];
}

/** A playlist as the renderer sees it: `patches` are the current folder names of its patchIds. */
export type PlaylistWithPatches = Playlist & { patches: string[] };

export type PlaylistDataWithPatches = Omit<PlaylistData, 'playlists'> & {
  playlists: PlaylistWithPatches[];
  /** Deprecated, kept for compatibility (always empty) */
  patches: string[];
};

export class PlaylistManager {
  private static readonly PLAYLIST_FILENAME = '.jamman-playlists.json';
  private static readonly VERSION = '2.0'; // Incremented for ID-based storage

  /** Tail of the write queue per playlist file (see `serialized`). */
  private static readonly writeQueues = new Map<string, Promise<unknown>>();

  /**
   * Runs a read-modify-write on the playlists of `basePath` one at a time. Every mutating
   * method loads the file, changes it and saves it back, so two of them overlapping would
   * both start from the same snapshot and the later save would silently discard the other
   * change. Queuing here (instead of in the IPC handlers) keeps that true no matter who
   * calls the manager. A failing operation does not block the ones queued behind it.
   */
  private static serialized<T>(basePath: string, operation: () => Promise<T>): Promise<T> {
    const key = path.resolve(basePath);
    const previous = this.writeQueues.get(key) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const tail = run.catch(() => undefined);
    this.writeQueues.set(key, tail);
    void tail.then(() => {
      if (this.writeQueues.get(key) === tail) {
        this.writeQueues.delete(key);
      }
    });
    return run;
  }

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
      const xmlContent = fs.readFileSync(patchXmlPath, 'utf-8');
      // Security: Use hardened XML parser to prevent XXE attacks
      const result = await SecureXMLParser.parsePatchXML(xmlContent);
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
  static async loadPlaylists(basePath: string): Promise<PlaylistDataWithPatches> {
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
      const raw: unknown = JSON.parse(content);

      // Migrate older schemas (see PlaylistSchema.ts). Legacy directory-based
      // playlists need their directories resolved to patch IDs first.
      const dirToId = new Map<string, string>();
      for (const dir of collectLegacyPatchDirs(raw)) {
        const id = await this.getPatchId(basePath, dir);
        if (id) {
          dirToId.set(dir, id);
        }
      }
      const { data, migrated } = migratePlaylistFile(raw, dirToId);
      if (migrated) {
        console.log(`Migrating playlists to schemaVersion ${PLAYLIST_SCHEMA_VERSION}...`);
        this.savePlaylists(basePath, data);
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
      const content = JSON.stringify({ ...data, schemaVersion: PLAYLIST_SCHEMA_VERSION }, null, 2);
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
  ): Promise<PlaylistWithPatches> {
    return this.serialized(basePath, async () => {
      const data = await this.loadPlaylists(basePath);

      // Check for duplicate names
      if (data.playlists.some(p => p.name === name)) {
        throw new Error(`Playlist "${name}" already exists`);
      }

      // Convert directory names to IDs
      const patchIds = await this.dirsToIds(basePath, patchDirs);

      const now = new Date().toISOString();
      const playlist: Playlist = {
        id: crypto.randomUUID(),
        name,
        patchIds,
        createdAt: now,
        updatedAt: now,
      };

      // The new playlist has no resolved `patches` yet: it is only added to the stored list
      const stored: Playlist[] = data.playlists;
      stored.push(playlist);
      this.savePlaylists(basePath, data);

      // Return with directory names for frontend: what was stored, not what was requested
      const storedDirs = await this.idsToDirs(basePath, patchIds);
      return {
        ...playlist,
        patches: storedDirs,
      };
    });
  }

  /**
   * Update an existing playlist
   */
  static async updatePlaylist(
    basePath: string,
    playlistId: string,
    updates: { name?: string; patches?: string[] },
  ): Promise<PlaylistWithPatches> {
    return this.serialized(basePath, async () => {
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
      };
    });
  }

  /**
   * Delete a playlist
   */
  static async deletePlaylist(basePath: string, playlistId: string): Promise<void> {
    return this.serialized(basePath, async () => {
      const data = await this.loadPlaylists(basePath);
      const index = data.playlists.findIndex(p => p.id === playlistId);

      if (index === -1) {
        throw new Error(`Playlist not found: ${playlistId}`);
      }

      data.playlists.splice(index, 1);
      this.savePlaylists(basePath, data);
    });
  }

  /**
   * Add patches to a playlist
   */
  static async addPatchesToPlaylist(
    basePath: string,
    playlistId: string,
    patchDirs: string[],
  ): Promise<PlaylistWithPatches> {
    return this.serialized(basePath, async () => {
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
      };
    });
  }

  /**
   * Remove patches from a playlist
   */
  static async removePatchesFromPlaylist(
    basePath: string,
    playlistId: string,
    patchDirs: string[],
  ): Promise<PlaylistWithPatches> {
    return this.serialized(basePath, async () => {
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
      };
    });
  }

  /**
   * Reorder patches within a playlist
   */
  static async reorderPlaylistPatches(
    basePath: string,
    playlistId: string,
    newOrderDirs: string[],
  ): Promise<PlaylistWithPatches> {
    return this.serialized(basePath, async () => {
      const data = await this.loadPlaylists(basePath);
      const playlist = data.playlists.find(p => p.id === playlistId);

      if (!playlist) {
        throw new Error(`Playlist not found: ${playlistId}`);
      }

      // Convert new order to IDs. A directory without a readable ID is dropped here, so a
      // shorter result means the request named something that is not a patch.
      const newOrderIds = await this.dirsToIds(basePath, newOrderDirs);

      // The new order must be an exact permutation of the current one: same length, no
      // repeats, nothing missing and nothing foreign. (Comparing only lengths let [P1, P1]
      // replace [P1, P2] and silently lose P2.)
      const current = new Set(playlist.patchIds);
      const requested = new Set(newOrderIds);
      const isPermutation =
        newOrderIds.length === newOrderDirs.length &&
        newOrderIds.length === playlist.patchIds.length &&
        requested.size === newOrderIds.length &&
        newOrderIds.every(id => current.has(id));

      if (!isPermutation) {
        throw new Error('Invalid patch order: it must contain every patch of the playlist once');
      }

      playlist.patchIds = newOrderIds;
      playlist.updatedAt = new Date().toISOString();
      this.savePlaylists(basePath, data);

      // Return with directory names
      const dirs = await this.idsToDirs(basePath, playlist.patchIds);
      return {
        ...playlist,
        patches: dirs,
      };
    });
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
    return this.serialized(basePath, async () => {
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
    });
  }
}
