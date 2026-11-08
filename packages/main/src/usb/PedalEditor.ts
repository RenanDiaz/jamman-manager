/**
 * Changes to a pedal's patches over USB: create, edit (settings and audio),
 * delete, reorder, and the undo snapshots that let the renderer take those
 * back.
 *
 * Undo without moving audio over the cable:
 * - A snapshot keeps a local copy of the patch's XML files (a few KB) and a
 *   reference to each of its phrase WAVs.
 * - A WAV reference follows the physical file: in its patch folder, renamed
 *   by a reorder, or parked in the work area on the same medium
 *   (`<medium>/.jamman-manager/undo/<id>.wav`).
 * - Before anything destroys a WAV that a snapshot refers to (replacing it,
 *   removing its phrase, deleting its patch), the file is parked instead:
 *   moving a file on the pedal is instant. Restoring a snapshot moves its
 *   WAVs back; whatever they replace is parked in turn, so undo and redo can
 *   swap states as often as needed.
 * - A parked WAV no snapshot refers to any more is deleted. Undo data left
 *   from an earlier session can never be used (the history lives in the
 *   renderer's memory) and is purged on connect.
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
import { bankPath, isPedalPath, PATCH_DIR_RE, PHRASE_DIR_RE, wavPath } from './pedalPaths.js';

export type PedalEditorLogger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

/** Progress of a long step (an upload), for the user. */
export type PedalProgress = { label: string; done: number; total: number };

export type PedalEditorOptions = {
  /** Reads a WAV picked on the computer. The caller has checked the path is allowed. */
  readLocalFile: (path: string) => Promise<Buffer>;
  onProgress?: (progress: PedalProgress) => void;
};

/** A phrase.wav on the pedal that a snapshot may need again. */
type WavRef = {
  id: string;
  bank: PedalBankId;
  /** Absolute path on the pedal: in a patch folder, or in the undo pool when parked. */
  at: string;
  parked: boolean;
};

type SnapshotPatch = {
  /** `patch.xml` and `PhraseX/phrase.xml`, by path relative to the patch folder. */
  xml: Map<string, Buffer>;
  /** The WAV of each phrase folder that had one. */
  wavs: Map<string, WavRef>;
};

type PedalSnapshot = {
  id: string;
  bank: PedalBankId;
  createdAt: number;
  patches: Map<string, SnapshotPatch>;
};

export const PEDAL_SNAPSHOT_PREFIX = 'pedal-';

const patchFolderName = (position: number) => `Patch${String(position).padStart(2, '0')}`;

/** Phrase folders a snapshot knows about: those with a WAV or a phrase.xml. */
function snapshotPhrases(patch: SnapshotPatch): string[] {
  const fromXml = [...patch.xml.keys()]
    .filter(path => path.endsWith('/phrase.xml'))
    .map(path => path.slice(0, path.indexOf('/')));
  return [...new Set([...patch.wavs.keys(), ...fromXml])].sort();
}

export class PedalEditor {
  readonly #files: PedalFiles;
  readonly #snapshots = new Map<string, PedalSnapshot>();
  readonly #refs = new Set<WavRef>();

  constructor(
    private readonly client: GreenglassClient,
    /** Bank folder on the pedal, ending in `/`; throws when the bank is not available. */
    private readonly bankRoot: (bank: PedalBankId) => string,
    guard: (path: string) => void,
    private readonly log: PedalEditorLogger,
    private readonly options: PedalEditorOptions = {
      readLocalFile: () => Promise.reject(new Error('Reading local files is not available')),
    },
  ) {
    this.#files = new PedalFiles(client, guard);
  }

  #patchFolder(bank: PedalBankId, dir: string): string {
    if (!PATCH_DIR_RE.test(dir)) throw new Error(`Invalid patch directory name: ${dir}`);
    return `${this.bankRoot(bank)}${dir}/`;
  }

  #poolRoot(bank: PedalBankId): string {
    return `${workRootFor(this.bankRoot(bank))}undo/`;
  }

  // ==================== Parked WAVs ====================

  #liveRef(path: string): WavRef | undefined {
    for (const ref of this.#refs) if (!ref.parked && ref.at === path) return ref;
    return undefined;
  }

  async #park(ref: WavRef): Promise<void> {
    await this.#files.ensureFolder(workRootFor(this.bankRoot(ref.bank)));
    await this.#files.ensureFolder(this.#poolRoot(ref.bank));
    const target = `${this.#poolRoot(ref.bank)}${ref.id}.wav`;
    await this.#files.moveFile(ref.at, target);
    ref.at = target;
    ref.parked = true;
  }

  async #unpark(ref: WavRef, path: string): Promise<void> {
    await this.#files.moveFile(ref.at, path);
    ref.at = path;
    ref.parked = false;
  }

  /**
   * Gets a WAV out of the way before its path is reused or removed: parked
   * when a snapshot refers to it, deleted otherwise. No-op when there is no file.
   */
  async #clearWav(path: string, exists?: boolean): Promise<void> {
    const ref = this.#liveRef(path);
    if (ref) {
      await this.#park(ref);
      return;
    }
    if (exists ?? (await this.client.entryInfo(path, false)).exists) {
      await this.#files.deleteFile(path);
    }
  }

  /** Moves a patch folder and keeps the references to its WAVs pointing at them. */
  async #moveTree(from: string, to: string): Promise<void> {
    await this.#files.moveTree(from, to);
    for (const ref of this.#refs) {
      if (!ref.parked && ref.at.startsWith(from)) ref.at = to + ref.at.slice(from.length);
    }
  }

  /** Deletes the bank's undo pool once nothing is parked in it. Never throws. */
  async #tidyPool(bank: PedalBankId): Promise<void> {
    if ([...this.#refs].some(ref => ref.bank === bank && ref.parked)) return;
    try {
      if (await this.#files.exists(this.#poolRoot(bank), true)) {
        await this.#files.deleteEmptyFolder(this.#poolRoot(bank));
      }
    } catch (error) {
      this.log.warn('Could not tidy the undo folder on the pedal:', errorText(error));
    }
  }

  // ==================== Create and edit ====================

  /** Uploads a WAV picked on the computer next to its destination (`phrase.wav.tmp`). */
  async #uploadNextTo(target: string, source: string, label: string): Promise<string> {
    const data = await this.options.readLocalFile(source);
    const temp = `${target}.tmp`;
    const report = (done: number) => this.options.onProgress?.({ label, done, total: data.length });
    report(0);
    try {
      await this.#files.writeFile(temp, data, report);
    } catch (error) {
      await this.#files.deleteFile(temp).catch(() => undefined);
      throw error;
    }
    return temp;
  }

  /** The IDs a phrase keeps across edits, read from its current phrase.xml. */
  async #phraseIds(folder: string, phrase: string): Promise<{ id: string; originId: string }> {
    let id: string = randomUUID();
    let originId: string = randomUUID();
    try {
      const current = await this.client.readFile(`${folder}${phrase}/phrase.xml`);
      const parsed = await SecureXMLParser.parsePhraseXML(current.toString('utf8'));
      id = parsed.JamManPhrase?.ID?.[0] ?? id;
      originId = parsed.JamManPhrase?.OriginID?.[0] ?? originId;
    } catch (error) {
      // A missing or malformed phrase.xml gets new IDs; a lost connection stops the edit.
      if (error instanceof GreenglassConnectionError) throw error;
    }
    return { id, originId };
  }

  #checkPhrases(form: PatchForm, ownWav: (phrase: string) => string): void {
    if (!Array.isArray(form.phrases) || form.phrases.length === 0) {
      throw new Error('A patch needs at least one phrase');
    }
    for (const phrase of form.phrases) {
      if (!PHRASE_DIR_RE.test(phrase.name)) throw new Error(`Invalid phrase name: ${phrase.name}`);
      if (isPedalPath(phrase.wavPath) && phrase.wavPath !== ownWav(phrase.name)) {
        throw new Error('A phrase can only take a WAV from the computer');
      }
      if (!phrase.wavPath) throw new Error(`${phrase.name} has no WAV file`);
    }
  }

  /** Creates a patch in an empty slot, uploading each phrase's WAV. */
  async createPatch(bank: PedalBankId, form: PatchForm): Promise<void> {
    const folder = this.#patchFolder(bank, form.directory);
    this.#checkPhrases(form, () => '');
    if (await this.#files.exists(folder, true)) {
      throw new Error(`Failed to create patch: Patch directory ${form.directory} already exists`);
    }

    await this.client.createFolder(folder);
    try {
      for (const phrase of form.phrases) {
        const phraseFolder = `${folder}${phrase.name}/`;
        await this.#files.ensureFolder(phraseFolder);
        const temp = await this.#uploadNextTo(
          `${phraseFolder}phrase.wav`,
          phrase.wavPath,
          `Uploading ${phrase.name}`,
        );
        await this.#files.moveFile(temp, `${phraseFolder}phrase.wav`);
        const xml = buildPhraseXml(phrase, randomUUID(), randomUUID());
        await this.#files.writeFileAtomic(`${phraseFolder}phrase.xml`, Buffer.from(xml));
      }
      // patch.xml last: until it exists the folder is not a patch.
      const patchXml = buildPatchXml({
        patchName: form.patchName,
        rhythmType: form.rhythmType,
        stopMode: form.stopMode,
        settingsVersion: 1,
        id: randomUUID(),
        originId: randomUUID(),
      });
      await this.#files.writeFileAtomic(`${folder}patch.xml`, Buffer.from(patchXml));
    } catch (error) {
      await this.#files
        .removeTree(folder)
        .catch(rollbackError =>
          this.log.warn('Could not remove the half-created patch:', rollbackError),
        );
      throw new Error(`Failed to create patch: ${errorText(error)}`, { cause: error });
    }
    this.log.info(`Created ${form.directory} on the pedal's ${bank} bank`);
  }

  /**
   * Rewrites a patch from the form: settings, phrase settings, and audio. A
   * phrase whose WAV is a file on the computer gets it uploaded (new phrase or
   * replacement); a phrase on the pedal that the form no longer lists is
   * removed. New WAVs are uploaded before anything is changed, so a failed
   * upload leaves the patch as it was.
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
    const ownWav = (phrase: string) => wavPath(bank, form.directory, phrase);
    this.#checkPhrases(form, ownWav);

    const onPedal = contents.folders.filter(d => PHRASE_DIR_RE.test(d));
    const listed = new Set(form.phrases.map(p => p.name));

    // 1. Upload every new WAV next to its destination. Nothing else changes yet.
    const uploads = new Map<string, string>();
    try {
      for (const phrase of form.phrases) {
        if (phrase.wavPath === ownWav(phrase.name)) continue;
        await this.#files.ensureFolder(`${folder}${phrase.name}/`);
        uploads.set(
          phrase.name,
          await this.#uploadNextTo(
            `${folder}${phrase.name}/phrase.wav`,
            phrase.wavPath,
            `Uploading ${phrase.name}`,
          ),
        );
      }
    } catch (error) {
      for (const temp of uploads.values())
        await this.#files.deleteFile(temp).catch(() => undefined);
      throw error;
    }

    // 2. Read the IDs to keep before any phrase.xml is touched.
    const ids = new Map<string, { id: string; originId: string }>();
    for (const phrase of form.phrases)
      ids.set(phrase.name, await this.#phraseIds(folder, phrase.name));

    // 3. Remove the phrases the form no longer lists.
    for (const phrase of onPedal.filter(p => !listed.has(p))) {
      await this.#clearWav(`${folder}${phrase}/phrase.wav`);
      await this.#files.removeTree(`${folder}${phrase}/`);
    }

    // 4. Put the uploaded WAVs in place, parking what they replace.
    for (const [phrase, temp] of uploads) {
      const target = `${folder}${phrase}/phrase.wav`;
      await this.#clearWav(target);
      await this.#files.moveFile(temp, target);
    }

    // 5. The XML files.
    const patchXml = buildPatchXml({
      patchName: form.patchName,
      rhythmType: form.rhythmType,
      stopMode: form.stopMode,
      settingsVersion: Number(form.settingsVersion || '0') + 1,
      id: form.patchID || randomUUID(),
      originId: form.patchOriginID || randomUUID(),
    });
    await this.#files.writeFileAtomic(`${folder}patch.xml`, Buffer.from(patchXml, 'utf8'));
    for (const phrase of form.phrases) {
      const { id, originId } = ids.get(phrase.name)!;
      await this.#files.writeFileAtomic(
        `${folder}${phrase.name}/phrase.xml`,
        Buffer.from(buildPhraseXml(phrase, id, originId), 'utf8'),
      );
    }
    this.log.info(`Updated ${form.directory} on the pedal's ${bank} bank`);
  }

  // ==================== Delete ====================

  /**
   * Deletes patches. WAVs a snapshot refers to are parked first, so undo can
   * bring the patch back; everything else is deleted for good.
   */
  async deletePatches(
    bank: PedalBankId,
    dirs: string[],
  ): Promise<{ deleted: string[]; failed: number }> {
    const deleted: string[] = [];
    let failed = 0;
    for (const dir of dirs) {
      const folder = this.#patchFolder(bank, dir);
      let contents;
      try {
        contents = await this.client.folderContents(folder);
      } catch (error) {
        if (!(error instanceof GreenglassRequestError)) throw error;
        this.log.warn(`Patch not found on the pedal, skipping: ${dir}`);
        failed++;
        continue;
      }
      for (const phrase of contents.folders) {
        const path = `${folder}${phrase}/phrase.wav`;
        if (this.#liveRef(path)) await this.#park(this.#liveRef(path)!);
      }
      await this.#files.removeTree(folder);
      deleted.push(dir);
    }
    this.log.info(`Deleted ${deleted.length} patches from the pedal's ${bank} bank`);
    return { deleted, failed };
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
      await this.#moveTree(from, to);
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
          await this.#moveTree(to, from);
        } catch (rollbackError) {
          this.log.warn(`Failed to move ${to} back to ${from}:`, rollbackError);
        }
      }
      throw new Error(`Failed to reorder patches: ${errorText(error)}`, { cause: error });
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
      const patch: SnapshotPatch = { xml: new Map(), wavs: new Map() };
      if (contents.files.includes('patch.xml')) {
        patch.xml.set('patch.xml', await this.client.readFile(`${folder}patch.xml`));
      }
      for (const phrase of contents.folders.filter(d => PHRASE_DIR_RE.test(d))) {
        try {
          patch.xml.set(
            `${phrase}/phrase.xml`,
            await this.client.readFile(`${folder}${phrase}/phrase.xml`),
          );
        } catch (error) {
          if (!(error instanceof GreenglassRequestError)) throw error;
        }
        const path = `${folder}${phrase}/phrase.wav`;
        if ((await this.client.entryInfo(path, false)).exists) {
          let ref = this.#liveRef(path);
          if (!ref) {
            ref = { id: randomUUID(), bank, at: path, parked: false };
            this.#refs.add(ref);
          }
          patch.wavs.set(phrase, ref);
        }
      }
      for (const data of patch.xml.values()) sizeBytes += data.length;
      snapshot.patches.set(dir, patch);
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
   * `add` brings back deleted patches; `replace` makes an existing patch look
   * like the snapshot again (settings, phrases and audio).
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
      if (!Array.isArray(only)) {
        throw new PatchRestoreError('INVALID_ARGUMENT', 'Invalid patch list');
      }
      for (const dir of only) {
        if (!snapshot.patches.has(dir)) {
          throw new PatchRestoreError('NOT_FOUND', `${dir} is not part of this snapshot`);
        }
      }
      dirs = dirs.filter(d => only.includes(d));
    }

    // Check everything first so a refusal changes nothing.
    for (const dir of dirs) {
      const patch = snapshot.patches.get(dir)!;
      const exists = await this.#files.exists(this.#patchFolder(bank, dir), true);
      if (mode === 'add') {
        if ([...patch.wavs.values()].some(ref => !ref.parked)) {
          throw new PatchRestoreError('NOT_FOUND', 'Undo data no longer exists');
        }
        if (exists) {
          throw new PatchRestoreError('SLOT_OCCUPIED', `Cannot restore: ${dir} is now in use`);
        }
      } else {
        if (!exists) throw new PatchRestoreError('NOT_FOUND', `Patch not found: ${dir}`);
        const folder = this.#patchFolder(bank, dir);
        for (const [phrase, ref] of patch.wavs) {
          if (!ref.parked && ref.at !== `${folder}${phrase}/phrase.wav`) {
            throw new PatchRestoreError('NOT_FOUND', 'Undo data no longer exists');
          }
        }
      }
    }

    try {
      for (const dir of dirs) {
        if (mode === 'add') await this.#restoreDeleted(bank, dir, snapshot.patches.get(dir)!);
        else await this.#restoreInPlace(bank, dir, snapshot.patches.get(dir)!);
      }
    } catch (error) {
      if (error instanceof PatchRestoreError) throw error;
      throw new PatchRestoreError('FAILED', `Could not restore: ${errorText(error)}`);
    } finally {
      await this.#tidyPool(bank);
    }
    return { restored: dirs, removed: [] };
  }

  async #restoreDeleted(bank: PedalBankId, dir: string, patch: SnapshotPatch): Promise<void> {
    const folder = this.#patchFolder(bank, dir);
    const unparked: WavRef[] = [];
    await this.client.createFolder(folder);
    try {
      for (const phrase of snapshotPhrases(patch)) {
        await this.client.createFolder(`${folder}${phrase}/`);
        const ref = patch.wavs.get(phrase);
        if (ref) {
          await this.#unpark(ref, `${folder}${phrase}/phrase.wav`);
          unparked.push(ref);
        }
      }
      await this.#writeXml(folder, patch);
    } catch (error) {
      for (const ref of unparked) await this.#park(ref).catch(() => undefined);
      await this.#files.removeTree(folder).catch(() => undefined);
      throw error;
    }
  }

  async #restoreInPlace(bank: PedalBankId, dir: string, patch: SnapshotPatch): Promise<void> {
    const folder = this.#patchFolder(bank, dir);
    const wanted = snapshotPhrases(patch);
    const current = (await this.client.folderContents(folder)).folders.filter(d =>
      PHRASE_DIR_RE.test(d),
    );

    // Phrases added since the snapshot go away (their WAVs parked if another snapshot needs them).
    for (const phrase of current.filter(p => !wanted.includes(p))) {
      await this.#clearWav(`${folder}${phrase}/phrase.wav`);
      await this.#files.removeTree(`${folder}${phrase}/`);
    }

    for (const phrase of wanted) {
      const target = `${folder}${phrase}/phrase.wav`;
      await this.#files.ensureFolder(`${folder}${phrase}/`);
      const ref = patch.wavs.get(phrase);
      if (ref && !ref.parked) continue; // already the one in place
      await this.#clearWav(target);
      if (ref) await this.#unpark(ref, target);
    }

    await this.#writeXml(folder, patch);
  }

  async #writeXml(folder: string, patch: SnapshotPatch): Promise<void> {
    for (const [relative, data] of patch.xml) {
      await this.#files.writeFileAtomic(`${folder}${relative}`, data);
    }
  }

  /** Forgets a snapshot and deletes the parked WAVs no other snapshot needs. Never throws. */
  async discardSnapshot(id: string): Promise<void> {
    const snapshot = this.#snapshots.get(id);
    if (!snapshot) return;
    this.#snapshots.delete(id);

    const stillNeeded = new Set<WavRef>();
    for (const other of this.#snapshots.values()) {
      for (const patch of other.patches.values())
        for (const ref of patch.wavs.values()) stillNeeded.add(ref);
    }
    for (const patch of snapshot.patches.values()) {
      for (const ref of patch.wavs.values()) {
        if (stillNeeded.has(ref) || !this.#refs.has(ref)) continue;
        this.#refs.delete(ref);
        if (!ref.parked) continue;
        try {
          await this.#files.deleteFile(ref.at);
        } catch (error) {
          // Not connected any more, or already gone: the purge on connect cleans it.
          this.log.warn(`Could not delete undo data ${ref.at} on the pedal:`, errorText(error));
        }
      }
    }
    await this.#tidyPool(snapshot.bank);
  }

  /** Deletes undo data left on the pedal by an earlier session. */
  async purgeUndoData(banks: PedalBankId[]): Promise<void> {
    for (const bank of banks) {
      const root = this.#poolRoot(bank);
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
