/**
 * Folder access policy
 *
 * The main process decides which paths the renderer may touch. The renderer
 * never grants itself access by sending a path: access is granted only by a
 * native dialog that the main process opened and the user answered.
 *
 * - **Approved root** – the JamMan SD folder chosen in `dialog:selectFolder`.
 *   Only one at a time. It is persisted in `userData` so the renderer's
 *   "auto-load last folder" keeps working after a restart: on startup the
 *   renderer sends the folder it remembers, and the main process accepts it
 *   only if it is the same folder the user approved before.
 * - **Granted files** – individual files chosen in `dialog:selectFile` or
 *   `backup:selectFile` (WAVs to import, backup ZIPs). Kept in memory for the
 *   session only.
 *
 * See docs/adr/0001-jamman-protocol.md.
 *
 * @module security/folderAccess
 */

import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { PathValidator } from '../PathValidator.js';

export type FolderAccessFs = {
  readFileSync(p: string, encoding: 'utf-8'): string;
  writeFileSync(p: string, data: string, encoding: 'utf-8'): void;
  renameSync(from: string, to: string): void;
  mkdirSync(p: string, options: { recursive: true }): unknown;
  realpathSync(p: string): string;
};

export type FolderAccessLogger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

export type FolderAccessOptions = {
  /** JSON file where the approved root is persisted (inside `userData`). */
  storeFile: string;
  fs?: FolderAccessFs;
  log?: FolderAccessLogger;
};

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(`Access denied: ${message}`);
    this.name = 'AccessDeniedError';
  }
}

type StoreShape = { version: 1; approvedRoot: string | null };

export class FolderAccess {
  readonly #storeFile: string;
  readonly #fs: FolderAccessFs;
  readonly #log: FolderAccessLogger;
  #root: string | null = null;
  readonly #grantedFiles = new Set<string>();

  constructor({ storeFile, fs = nodeFs, log = console }: FolderAccessOptions) {
    this.#storeFile = storeFile;
    this.#fs = fs;
    this.#log = log;
  }

  /**
   * Loads the persisted root. A missing or malformed store means "no root".
   */
  load(): void {
    try {
      const raw = JSON.parse(
        this.#fs.readFileSync(this.#storeFile, 'utf-8'),
      ) as Partial<StoreShape>;
      const root = raw?.approvedRoot;
      this.#root = typeof root === 'string' && path.isAbsolute(root) ? path.resolve(root) : null;
    } catch {
      this.#root = null;
    }
  }

  /** The approved SD folder, or null. */
  getRoot(): string | null {
    return this.#root;
  }

  /**
   * Approves a folder the user picked in the native dialog and persists it.
   * Must only be called with a path returned by `dialog.showOpenDialog`.
   */
  approveRoot(folder: string): void {
    if (!folder || !path.isAbsolute(folder)) {
      throw new AccessDeniedError('folder must be an absolute path');
    }

    this.#root = path.resolve(folder);
    this.#log.info('Approved JamMan folder:', this.#root);

    const data: StoreShape = { version: 1, approvedRoot: this.#root };
    try {
      this.#fs.mkdirSync(path.dirname(this.#storeFile), { recursive: true });
      const tmp = `${this.#storeFile}.tmp`;
      this.#fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      this.#fs.renameSync(tmp, this.#storeFile);
    } catch (error) {
      // Not fatal: access still works for this session.
      this.#log.warn('Could not persist approved folder:', error);
    }
  }

  /**
   * Grants read access to one file the user picked in a native dialog.
   */
  grantFile(filePath: string): void {
    if (filePath && path.isAbsolute(filePath)) {
      this.#grantedFiles.add(path.resolve(filePath));
    }
  }

  /**
   * Throws unless `folder` is the approved root. Used by handlers that take a
   * `basePath` from the renderer.
   */
  assertRoot(folder: unknown): string {
    if (typeof folder !== 'string' || folder.trim() === '') {
      throw new AccessDeniedError('invalid folder path');
    }
    if (!this.#root) {
      throw new AccessDeniedError('no JamMan folder has been selected');
    }
    const resolved = path.resolve(folder);
    if (resolved !== this.#root) {
      this.#log.warn('Rejected folder that is not the approved one:', resolved);
      throw new AccessDeniedError('folder is not the selected JamMan folder');
    }
    return resolved;
  }

  /**
   * Returns true when `filePath` lies inside the approved root, both lexically
   * and after resolving symlinks. Missing files are checked lexically only (the
   * caller's own existence check rejects them).
   */
  isInsideRoot(filePath: string): boolean {
    if (!this.#root || typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      return false;
    }

    const resolved = path.resolve(filePath);
    if (!PathValidator.isPathSafe(resolved, this.#root)) {
      return false;
    }

    let realFile: string;
    let realRoot: string;
    try {
      realRoot = this.#fs.realpathSync(this.#root);
      realFile = this.#fs.realpathSync(resolved);
    } catch {
      // Does not exist (yet): lexical containment is all we can check.
      return true;
    }
    return PathValidator.isPathSafe(realFile, realRoot);
  }

  /**
   * Throws unless the renderer may read `filePath`: it must be inside the
   * approved root or a file the user picked in a dialog this session, and have
   * one of `extensions`.
   */
  assertReadableFile(filePath: unknown, extensions: string[]): string {
    if (typeof filePath !== 'string' || filePath.trim() === '' || !path.isAbsolute(filePath)) {
      throw new AccessDeniedError('invalid file path');
    }

    const resolved = path.resolve(filePath);
    if (!PathValidator.hasAllowedExtension(resolved, extensions)) {
      throw new AccessDeniedError('file type not allowed');
    }

    if (this.#grantedFiles.has(resolved) || this.isInsideRoot(resolved)) {
      return resolved;
    }

    this.#log.warn('Rejected file outside the approved folder:', resolved);
    throw new AccessDeniedError('file is outside the selected JamMan folder');
  }
}
