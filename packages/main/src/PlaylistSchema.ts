/**
 * Schema versioning for `.jamman-playlists.json`.
 *
 * Versions:
 * - 1 (legacy): any file without `schemaVersion`. Covers both the old
 *   directory-based format (`version: "1.0"`, playlists with `patches: string[]`)
 *   and the ID-based format (`version: "2.0"`, playlists with `patchIds: string[]`).
 * - 2: ID-based format with an explicit `schemaVersion: 2`.
 *
 * Everything here is pure: reading patch IDs from disk is the caller's job, and the
 * result is passed in as a directory -> patch ID map.
 */

export const PLAYLIST_SCHEMA_VERSION = 2;
export const PLAYLIST_FORMAT_VERSION = '2.0';

export interface StoredPlaylist {
  id: string;
  name: string;
  patchIds: string[];
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface PlaylistFile {
  schemaVersion: number;
  version: string;
  playlists: StoredPlaylist[];
}

export interface PlaylistMigrationResult {
  data: PlaylistFile;
  /** True when the input was in an older schema and was rewritten. */
  migrated: boolean;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

/** Returns the schema version of a parsed playlist file; missing means legacy v1. */
export function getPlaylistSchemaVersion(raw: unknown): number {
  if (!isObject(raw)) {
    throw new Error('Invalid playlist file: expected a JSON object');
  }
  if (raw.schemaVersion === undefined) {
    return 1;
  }
  if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion)) {
    throw new Error('Invalid playlist file: schemaVersion must be an integer');
  }
  return raw.schemaVersion;
}

function legacyPlaylists(raw: unknown): JsonObject[] {
  if (!isObject(raw) || !Array.isArray(raw.playlists)) {
    return [];
  }
  return raw.playlists.filter(isObject);
}

/**
 * Lists the patch directory names referenced by legacy directory-based playlists,
 * so the caller can resolve them to patch IDs before calling `migratePlaylistFile`.
 */
export function collectLegacyPatchDirs(raw: unknown): string[] {
  if (getPlaylistSchemaVersion(raw) >= PLAYLIST_SCHEMA_VERSION) {
    return [];
  }
  const dirs = new Set<string>();
  for (const playlist of legacyPlaylists(raw)) {
    if (!isStringArray(playlist.patchIds) && isStringArray(playlist.patches)) {
      playlist.patches.forEach(dir => dirs.add(dir));
    }
  }
  return [...dirs];
}

function toStoredPlaylist(playlist: JsonObject, patchIds: string[]): StoredPlaylist {
  return {
    ...playlist,
    id: String(playlist.id ?? ''),
    name: String(playlist.name ?? ''),
    patchIds,
    createdAt: String(playlist.createdAt ?? ''),
    updatedAt: String(playlist.updatedAt ?? ''),
  };
}

function migrateV1ToV2(raw: JsonObject, dirToId: ReadonlyMap<string, string>): PlaylistFile {
  const playlists = legacyPlaylists(raw).map(playlist => {
    if (isStringArray(playlist.patchIds)) {
      // ID-based (version 2.0) playlist: already in the current shape.
      return toStoredPlaylist(playlist, [...playlist.patchIds]);
    }
    // Directory-based (version 1.0) playlist: keep only directories that resolve to an ID.
    const { patches, ...rest } = playlist;
    const patchIds = isStringArray(patches)
      ? patches.map(dir => dirToId.get(dir)).filter((id): id is string => id !== undefined)
      : [];
    return toStoredPlaylist(rest, patchIds);
  });

  return {
    schemaVersion: 2,
    version: PLAYLIST_FORMAT_VERSION,
    playlists,
  };
}

/**
 * Migrates a parsed `.jamman-playlists.json` to the current schema.
 *
 * @param raw Parsed JSON content of the file.
 * @param dirToId Patch directory -> patch ID, needed only for directory-based legacy files.
 * @throws If the input is not an object or its schema is newer than this app supports.
 */
export function migratePlaylistFile(
  raw: unknown,
  dirToId: ReadonlyMap<string, string> = new Map(),
): PlaylistMigrationResult {
  const schemaVersion = getPlaylistSchemaVersion(raw);
  const obj = raw as JsonObject;

  if (schemaVersion > PLAYLIST_SCHEMA_VERSION) {
    throw new Error(
      `Playlist file schemaVersion ${schemaVersion} is newer than supported (${PLAYLIST_SCHEMA_VERSION})`,
    );
  }
  if (schemaVersion < 1) {
    throw new Error(`Invalid playlist file schemaVersion: ${schemaVersion}`);
  }

  if (schemaVersion === PLAYLIST_SCHEMA_VERSION) {
    return {
      data: {
        ...obj,
        schemaVersion,
        version: typeof obj.version === 'string' ? obj.version : PLAYLIST_FORMAT_VERSION,
        playlists: legacyPlaylists(obj).map(p =>
          toStoredPlaylist(p, isStringArray(p.patchIds) ? p.patchIds : []),
        ),
      },
      migrated: false,
    };
  }

  // schemaVersion === 1. Future migrations chain here: v2 -> v3, and so on.
  return { data: migrateV1ToV2(obj, dirToId), migrated: true };
}
