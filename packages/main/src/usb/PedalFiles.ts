/**
 * File operations on the pedal built from the protocol's primitives, with a
 * guard on every path that is written, moved or deleted.
 *
 * The guard: the pedal's internal memory also holds its software (`usr/`,
 * `lib/`, `boot/`) and settings (`jamStereo.xml`). Writes may only touch a
 * patch folder of a bank (`<bank root>PatchNN/…`) or the app's own work area
 * on the same medium (`<medium>/.jamman-manager/`). Anything else throws
 * before a request is sent.
 *
 * Folder moves: the pedal cannot move a folder that contains folders (it
 * answers "The folder could not be copied"), but it moves files instantly,
 * also across folders. `moveTree` therefore recreates the folders and moves
 * the files one by one: no audio crosses the cable.
 *
 * Paths of folders end in `/`.
 *
 * @module usb/PedalFiles
 */
import { GreenglassRequestError, type GreenglassClient } from './GreenglassClient.js';

/** The app's work area on a medium, next to the bank folder. */
export const WORK_FOLDER = '.jamman-manager/';

export type PedalTree = {
  /** Sub-folders, relative, each ending in `/`, parents before children. */
  folders: string[];
  /** Files, relative. */
  files: string[];
};

/** A path is refused by the write guard. */
export class PedalPathNotAllowedError extends Error {
  constructor(path: string) {
    super(`Refusing to modify ${path} on the pedal: outside the patch folders`);
    this.name = 'PedalPathNotAllowedError';
  }
}

/** `/mnt/sdfs/JamManStereo/` → `/mnt/sdfs/.jamman-manager/` */
export function workRootFor(bankRoot: string): string {
  const trimmed = bankRoot.replace(/\/+$/, '');
  const parent = trimmed.slice(0, trimmed.lastIndexOf('/') + 1);
  return `${parent}${WORK_FOLDER}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the write guard for a set of bank roots (each ending in `/`).
 * Exported for tests.
 */
export function createWriteGuard(bankRoots: string[]): (path: string) => void {
  const patchAreas = bankRoots.map(root => new RegExp(`^${escapeRegExp(root)}Patch\\d{2}(/.*)?$`));
  const workAreas = bankRoots.map(workRootFor);
  return path => {
    const segments = path.split('/');
    const malformed =
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.includes('\0') ||
      path.includes('\\') ||
      // No empty segment except the trailing one of a folder path, no `.` or `..`
      segments.slice(1, -1).some(s => s === '' || s === '.' || s === '..') ||
      segments.at(-1) === '.' ||
      segments.at(-1) === '..';
    if (malformed) throw new PedalPathNotAllowedError(path);

    const allowed =
      patchAreas.some(re => re.test(path)) || workAreas.some(area => path.startsWith(area));
    if (!allowed) throw new PedalPathNotAllowedError(path);
  };
}

export class PedalFiles {
  constructor(
    private readonly client: GreenglassClient,
    private readonly guard: (path: string) => void,
  ) {}

  async exists(path: string, isFolder: boolean): Promise<boolean> {
    return (await this.client.entryInfo(path, isFolder)).exists;
  }

  /** Everything under a folder, without reading any file. */
  async listTree(folder: string): Promise<PedalTree> {
    const tree: PedalTree = { folders: [], files: [] };
    const walk = async (relative: string) => {
      const contents = await this.client.folderContents(`${folder}${relative}`);
      for (const file of contents.files) tree.files.push(`${relative}${file}`);
      for (const sub of contents.folders) {
        tree.folders.push(`${relative}${sub}/`);
        await walk(`${relative}${sub}/`);
      }
    };
    await walk('');
    return tree;
  }

  /** Creates a folder unless it exists (never with "overwrite", whose meaning on the pedal is unknown). */
  async ensureFolder(path: string): Promise<void> {
    this.guard(path);
    if (!(await this.exists(path, true))) await this.client.createFolder(path);
  }

  /** Writes next to the target and then moves over it, so a cut cable never leaves half a file. */
  async writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
    const temp = `${path}.tmp`;
    this.guard(path);
    this.guard(temp);
    await this.client.writeFile(temp, data);
    await this.client.moveFile(temp, path, true);
  }

  /**
   * Moves a folder with everything in it to `target`, which must not exist.
   * On failure the files already moved go back and the half-built target is removed.
   */
  async moveTree(source: string, target: string): Promise<void> {
    this.guard(source);
    this.guard(target);

    const tree = await this.listTree(source);
    // Without "overwrite" the pedal refuses to create a folder that exists:
    // that is the check that the target is free.
    try {
      await this.client.createFolder(target);
    } catch (error) {
      if (error instanceof GreenglassRequestError) {
        throw new GreenglassRequestError(`${target} already exists or cannot be created`);
      }
      throw error;
    }

    const moved: string[] = [];
    try {
      for (const folder of tree.folders) await this.client.createFolder(`${target}${folder}`);
      for (const file of tree.files) {
        await this.client.moveFile(`${source}${file}`, `${target}${file}`);
        moved.push(file);
      }
    } catch (error) {
      for (const file of moved.reverse()) {
        await this.client.moveFile(`${target}${file}`, `${source}${file}`).catch(() => undefined);
      }
      await this.client.delete(target, true, true).catch(() => undefined);
      throw error;
    }

    // Children first, never recursive: a folder that still holds a file is not deleted.
    for (const folder of [...tree.folders].reverse()) {
      await this.client.delete(`${source}${folder}`, true, false);
    }
    await this.client.delete(source, true, false);
  }

  /** Deletes a folder and everything in it, for good. */
  async removeTree(folder: string): Promise<void> {
    this.guard(folder);
    await this.client.delete(folder, true, true);
  }
}
