/**
 * Changes to a pedal's patches over USB: edit (XML only), delete, reorder,
 * and the undo snapshots that let the renderer take those back.
 *
 * Undo without moving audio over the cable:
 * - A snapshot keeps a local copy of the patch's XML files (a few KB). That is
 *   enough to undo an edit, which never touches audio here.
 * - Deleting a patch that a snapshot protects moves its folder into that
 *   snapshot's slot in the work area on the same medium
 *   (`<medium>/.jamman-manager/undo/<snapshot>/PatchNN/`) instead of deleting
 *   it. Undo moves it back; the slot then waits in case the delete is redone.
 * - Discarding a snapshot deletes its slot for good. Slots left from an
 *   earlier session are unreachable (the undo history lives in the renderer's
 *   memory) and are purged on connect.
 *
 * @module usb/PedalEditor
 */
import { randomUUID } from 'node:crypto';
import type {
  PatchForm,
  PedalBankId,
  SnapshotRestoreMode,
  SnapshotRestoreResult,
  SnapshotScope,
  UndoSnapshotInfo,
} from '@app/preload/ipc-contract';
import { buildPatchXml, buildPhraseXml } from '../patchXml.js';
import { PatchRestoreError } from '../PatchRestore.js';
import { SecureXMLParser } from '../SecureXMLParser.js';
import {
  GreenglassConnectionError,
  GreenglassRequestError,
  type GreenglassClient,
} from './GreenglassClient.js';
import { PedalFiles, workRootFor } from './PedalFiles.js';
import { bankPath, PATCH_DIR_RE, PHRASE_DIR_RE, wavPath } from './pedalPaths.js';

export type PedalEditorLogger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

type SlotState =
  /** The patch was never deleted under this snapshot. */
  | 'none'
  /** Its folder is parked in the snapshot's slot on the pedal. */
  | 'trashed'
  /** It was parked and undo moved it back: a redone delete parks it here again. */
  | 'restored';

type SnapshotPatch = {
  /** XML files of the patch, by path relative to the patch folder. */
  xml: Map<string, Buffer>;
  state: SlotState;
};

type PedalSnapshot = {
  id: string;
  bank: PedalBankId;
  createdAt: number;
  patches: Map<string, SnapshotPatch>;
};

export const PEDAL_SNAPSHOT_PREFIX = 'pedal-';

const patchFolderName = (position: number) => `Patch${String(position).padStart(2, '0')}`;

export class PedalEditor {
  readonly #files: PedalFiles;
  readonly #snapshots = new Map<string, PedalSnapshot>();

  constructor(
    private readonly client: GreenglassClient,
    /** Bank folder on the pedal, ending in `/`; throws when the bank is not available. */
    private readonly bankRoot: (bank: PedalBankId) => string,
    guard: (path: string) => void,
    private readonly log: PedalEditorLogger,
  ) {
    this.#files = new PedalFiles(client, guard);
  }

  #patchFolder(bank: PedalBankId, dir: string): string {
    if (!PATCH_DIR_RE.test(dir)) throw new Error(`Invalid patch directory name: ${dir}`);
    return `${this.bankRoot(bank)}${dir}/`;
  }

  #undoRoot(bank: PedalBankId): string {
    return `${workRootFor(this.bankRoot(bank))}undo/`;
  }

  #slotFolder(snapshot: PedalSnapshot, dir: string): string {
    return `${this.#undoRoot(snapshot.bank)}${snapshot.id}/${dir}/`;
  }

  // ==================== Edit ====================

  /**
   * Rewrites patch.xml and the phrase.xml files. Audio is not touched: the
   * form must list exactly the phrases on the pedal, each with its own WAV.
   */
  async updatePatch(bank: PedalBankId, form: PatchForm): Promise<void> {
    const folder = this.#patchFolder(bank, form.directory);
    let contents;
    try {
      contents = await this.client.folderContents(folder);
    } catch (error) {
      if (error instanceof GreenglassRequestError) {
        throw new Error(`Patch directory ${form.directory} does not exist`, { cause: error });
      }
      throw error;
    }

    const onPedal = contents.folders.filter(d => PHRASE_DIR_RE.test(d)).sort();
    const inForm = (form.phrases ?? []).map(p => p.name).sort();
    const sameAudio = (form.phrases ?? []).every(
      p => p.wavPath === wavPath(bank, form.directory, p.name),
    );
    if (onPedal.join() !== inForm.join() || !sameAudio) {
      throw new Error(
        'Adding, replacing or removing phrases is not available for a pedal connected over USB yet',
      );
    }

    const patchXml = buildPatchXml({
      patchName: form.patchName,
      rhythmType: form.rhythmType,
      stopMode: form.stopMode,
      settingsVersion: Number(form.settingsVersion || '0') + 1,
      id: form.patchID || randomUUID(),
      originId: form.patchOriginID || randomUUID(),
    });

    // Keep each phrase's IDs, read from its current phrase.xml.
    const phraseXmls = new Map<string, string>();
    for (const phrase of form.phrases) {
      let id: string = randomUUID();
      let originId: string = randomUUID();
      try {
        const current = await this.client.readFile(`${folder}${phrase.name}/phrase.xml`);
        const parsed = await SecureXMLParser.parsePhraseXML(current.toString('utf8'));
        id = parsed.JamManPhrase?.ID?.[0] ?? id;
        originId = parsed.JamManPhrase?.OriginID?.[0] ?? originId;
      } catch (error) {
        // A missing or malformed phrase.xml gets new IDs; a lost connection stops the edit.
        if (error instanceof GreenglassConnectionError) throw error;
      }
      phraseXmls.set(phrase.name, buildPhraseXml(phrase, id, originId));
    }

    await this.#files.writeFileAtomic(`${folder}patch.xml`, Buffer.from(patchXml, 'utf8'));
    for (const [name, xml] of phraseXmls) {
      await this.#files.writeFileAtomic(`${folder}${name}/phrase.xml`, Buffer.from(xml, 'utf8'));
    }
    this.log.info(`Updated ${form.directory} on the pedal's ${bank} bank`);
  }

  // ==================== Delete ====================

  /**
   * Deletes patches. A patch protected by a snapshot is parked in the
   * snapshot's slot (so undo can bring it back); any other is deleted for good.
   */
  async deletePatches(
    bank: PedalBankId,
    dirs: string[],
  ): Promise<{ deleted: string[]; failed: number }> {
    const deleted: string[] = [];
    let failed = 0;
    for (const dir of dirs) {
      const folder = this.#patchFolder(bank, dir);
      if (!(await this.#files.exists(folder, true))) {
        this.log.warn(`Patch not found on the pedal, skipping: ${dir}`);
        failed++;
        continue;
      }
      const snapshot = this.#protectingSnapshot(bank, dir);
      if (snapshot) {
        await this.#files.ensureFolder(workRootFor(this.bankRoot(bank)));
        await this.#files.ensureFolder(this.#undoRoot(bank));
        await this.#files.ensureFolder(`${this.#undoRoot(bank)}${snapshot.id}/`);
        await this.#files.moveTree(folder, this.#slotFolder(snapshot, dir));
        snapshot.patches.get(dir)!.state = 'trashed';
      } else {
        await this.#files.removeTree(folder);
      }
      deleted.push(dir);
    }
    this.log.info(`Deleted ${deleted.length} patches from the pedal's ${bank} bank`);
    return { deleted, failed };
  }

  /**
   * The snapshot a delete of `dir` should park the folder in: first one that
   * restored it (a redo), else the newest one taken of it that has no copy yet.
   */
  #protectingSnapshot(bank: PedalBankId, dir: string): PedalSnapshot | null {
    const candidates = [...this.#snapshots.values()]
      .filter(s => s.bank === bank && s.patches.has(dir))
      .sort((a, b) => b.createdAt - a.createdAt);
    return (
      candidates.find(s => s.patches.get(dir)!.state === 'restored') ??
      candidates.find(s => s.patches.get(dir)!.state === 'none') ??
      null
    );
  }

  // ==================== Reorder ====================

  /**
   * Renames the patch folders so `newOrder[i]` becomes `Patch{i+1}`.
   *
   * Only folders that change name move, and each moves straight to its new
   * name as soon as that name is free; a folder goes through the work area
   * only to break a cycle (A→B→A). Every step lands on a free name, so a
   * failure is undone by replaying the steps backwards.
   */
  async reorderPatches(bank: PedalBankId, newOrder: string[]): Promise<void> {
    const root = this.bankRoot(bank);
    for (const dir of newOrder) {
      if (!(await this.#files.exists(this.#patchFolder(bank, dir), true))) {
        throw new Error(`Patch folder not found: ${dir}`);
      }
    }

    const staging = `${workRootFor(root)}reorder/`;
    if (await this.#files.exists(staging, true)) {
      const left = await this.#files.listTree(staging);
      if (left.files.length > 0) {
        throw new Error(
          'An earlier reorder on this pedal was interrupted: its patches are still in .jamman-manager/reorder',
        );
      }
      await this.#files.removeTree(staging);
    }

    // Where each folder that must move is now, keyed by the name it must end with.
    const pending = new Map<string, string>();
    newOrder.forEach((original, i) => {
      const target = patchFolderName(i + 1);
      if (original !== target) pending.set(target, `${root}${original}/`);
    });
    if (pending.size === 0) return;

    const steps: Array<{ from: string; to: string }> = [];
    const step = async (from: string, to: string) => {
      await this.#files.moveTree(from, to);
      steps.push({ from, to });
    };
    /** A target name is busy while some pending folder still sits there. */
    const busy = (target: string) => [...pending.values()].includes(`${root}${target}/`);

    try {
      while (pending.size > 0) {
        const ready = [...pending].find(([target]) => !busy(target));
        if (ready) {
          const [target, from] = ready;
          await step(from, `${root}${target}/`);
          pending.delete(target);
          continue;
        }
        // Every remaining target is taken by another pending folder: a cycle.
        // Park one of them so the rest can follow.
        const [target, from] = pending.entries().next().value!;
        await this.#files.ensureFolder(workRootFor(root));
        await this.#files.ensureFolder(staging);
        const parked = `${staging}${from.slice(root.length)}`;
        await step(from, parked);
        pending.set(target, parked);
      }
      if (await this.#files.exists(staging, true)) await this.#files.removeTree(staging);
      this.log.info(
        `Reordered ${newOrder.length} patches on the pedal's ${bank} bank (${steps.length} moves)`,
      );
    } catch (error) {
      for (const { from, to } of steps.reverse()) {
        try {
          await this.#files.moveTree(to, from);
        } catch (rollbackError) {
          this.log.warn(`Failed to move ${to} back to ${from}:`, rollbackError);
        }
      }
      throw new Error(
        `Failed to reorder patches: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  // ==================== Undo snapshots ====================

  async createSnapshot(bank: PedalBankId, scope: SnapshotScope): Promise<UndoSnapshotInfo> {
    if (scope?.kind !== 'patches') {
      throw new PatchRestoreError('FAILED', 'This action cannot be undone over USB yet');
    }
    if (!Array.isArray(scope.patches) || scope.patches.length === 0) {
      throw new PatchRestoreError('INVALID_ARGUMENT', 'No patches to snapshot');
    }

    const snapshot: PedalSnapshot = {
      id: `${PEDAL_SNAPSHOT_PREFIX}${randomUUID()}`,
      bank,
      createdAt: Date.now(),
      patches: new Map(),
    };
    let sizeBytes = 0;
    for (const dir of scope.patches) {
      if (!PATCH_DIR_RE.test(dir)) {
        throw new PatchRestoreError('INVALID_ARGUMENT', `Invalid patch directory name: ${dir}`);
      }
      const folder = this.#patchFolder(bank, dir);
      let contents;
      try {
        contents = await this.client.folderContents(folder);
      } catch (error) {
        if (error instanceof GreenglassRequestError) {
          throw new PatchRestoreError('NOT_FOUND', `Patch not found: ${dir}`);
        }
        throw error;
      }
      const xml = new Map<string, Buffer>();
      if (contents.files.includes('patch.xml')) {
        xml.set('patch.xml', await this.client.readFile(`${folder}patch.xml`));
      }
      for (const phrase of contents.folders.filter(d => PHRASE_DIR_RE.test(d))) {
        try {
          xml.set(
            `${phrase}/phrase.xml`,
            await this.client.readFile(`${folder}${phrase}/phrase.xml`),
          );
        } catch (error) {
          if (!(error instanceof GreenglassRequestError)) throw error;
        }
      }
      for (const data of xml.values()) sizeBytes += data.length;
      snapshot.patches.set(dir, { xml, state: 'none' });
    }

    this.#snapshots.set(snapshot.id, snapshot);
    return {
      id: snapshot.id,
      basePath: bankPath(bank),
      scope: 'patches',
      patches: [...snapshot.patches.keys()],
      hasPlaylists: false,
      sizeBytes,
      createdAt: snapshot.createdAt,
    };
  }

  /**
   * `add` brings back deleted patches (their folders come out of the slot);
   * `replace` writes the saved XML over the patch as it is now.
   */
  async restoreSnapshot(
    id: string,
    bank: PedalBankId,
    mode: SnapshotRestoreMode,
    only?: string[],
  ): Promise<SnapshotRestoreResult> {
    const snapshot = this.#snapshots.get(id);
    if (!snapshot) throw new PatchRestoreError('NOT_FOUND', 'Undo data no longer exists');
    if (snapshot.bank !== bank) {
      throw new PatchRestoreError(
        'WRONG_FOLDER',
        'This undo state belongs to a different JamMan folder',
      );
    }
    if (mode !== 'add' && mode !== 'replace') {
      throw new PatchRestoreError('INVALID_ARGUMENT', `Unknown restore mode: ${String(mode)}`);
    }

    let dirs = [...snapshot.patches.keys()];
    if (only !== undefined) {
      if (!Array.isArray(only))
        throw new PatchRestoreError('INVALID_ARGUMENT', 'Invalid patch list');
      for (const dir of only) {
        if (!snapshot.patches.has(dir)) {
          throw new PatchRestoreError('NOT_FOUND', `${dir} is not part of this snapshot`);
        }
      }
      dirs = dirs.filter(d => only.includes(d));
    }

    if (mode === 'add') {
      const occupied: string[] = [];
      for (const dir of dirs) {
        if (snapshot.patches.get(dir)!.state !== 'trashed') {
          throw new PatchRestoreError('NOT_FOUND', 'Undo data no longer exists');
        }
        if (await this.#files.exists(this.#patchFolder(bank, dir), true)) occupied.push(dir);
      }
      if (occupied.length > 0) {
        throw new PatchRestoreError(
          'SLOT_OCCUPIED',
          `Cannot restore: ${occupied.join(', ')} ${occupied.length === 1 ? 'is' : 'are'} now in use`,
        );
      }
      for (const dir of dirs) {
        try {
          await this.#files.moveTree(this.#slotFolder(snapshot, dir), this.#patchFolder(bank, dir));
        } catch (error) {
          throw new PatchRestoreError('FAILED', `Could not restore ${dir}: ${errorText(error)}`);
        }
        snapshot.patches.get(dir)!.state = 'restored';
      }
      await this.#tidyUndoFolders(snapshot);
      return { restored: dirs, removed: [] };
    }

    for (const dir of dirs) {
      const folder = this.#patchFolder(bank, dir);
      if (!(await this.#files.exists(folder, true))) {
        throw new PatchRestoreError('NOT_FOUND', `Patch not found: ${dir}`);
      }
      try {
        for (const [relative, data] of snapshot.patches.get(dir)!.xml) {
          await this.#files.writeFileAtomic(`${folder}${relative}`, data);
        }
      } catch (error) {
        throw new PatchRestoreError('FAILED', `Could not restore ${dir}: ${errorText(error)}`);
      }
    }
    return { restored: dirs, removed: [] };
  }

  /**
   * Removes the snapshot's folder once nothing is parked in it, and the bank's
   * undo folder once no snapshot parks anything (a redo recreates them).
   * Only ever deletes empty folders. Never throws.
   */
  async #tidyUndoFolders(snapshot: PedalSnapshot): Promise<void> {
    const parks = (s: PedalSnapshot) => [...s.patches.values()].some(p => p.state === 'trashed');
    if (parks(snapshot)) return;
    const client = this.client;
    try {
      const folder = `${this.#undoRoot(snapshot.bank)}${snapshot.id}/`;
      if (await this.#files.exists(folder, true)) await client.delete(folder, true, false);
      const others = [...this.#snapshots.values()].some(s => s.bank === snapshot.bank && parks(s));
      if (!others && (await this.#files.exists(this.#undoRoot(snapshot.bank), true))) {
        await client.delete(this.#undoRoot(snapshot.bank), true, false);
      }
    } catch (error) {
      this.log.warn('Could not tidy the undo folders on the pedal:', error);
    }
  }

  /** Forgets a snapshot and deletes its parked folders. Never throws. */
  async discardSnapshot(id: string): Promise<void> {
    const snapshot = this.#snapshots.get(id);
    if (!snapshot) return;
    this.#snapshots.delete(id);
    if (![...snapshot.patches.values()].some(p => p.state === 'trashed')) return;
    try {
      await this.#files.removeTree(`${this.#undoRoot(snapshot.bank)}${snapshot.id}/`);
    } catch (error) {
      // Not connected any more, or already gone: the purge on connect cleans it.
      this.log.warn(`Could not delete undo data ${id} on the pedal:`, errorText(error));
    }
  }

  /** Deletes undo data left on the pedal by an earlier session. */
  async purgeUndoData(banks: PedalBankId[]): Promise<void> {
    for (const bank of banks) {
      const root = this.#undoRoot(bank);
      if (await this.#files.exists(root, true)) {
        await this.#files.removeTree(root);
        this.log.info(`Purged old undo data on the pedal's ${bank} bank`);
      }
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
