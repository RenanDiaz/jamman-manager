/**
 * The JamMan connected over USB: connection lifecycle, its banks (internal
 * memory and SD), reading patches live from the device, and serving phrase
 * audio with a local cache of the WAVs already downloaded.
 *
 * Nothing is mirrored: patches are read from the pedal each time, and the
 * only local state is the WAV cache under `cacheRoot/<pedal guid>/<bank>/`.
 * A cached WAV is used only while the pedal still reports the same size and
 * modification time for it.
 *
 * @module usb/PedalManager
 */
import { EventEmitter } from 'node:events';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type {
  PatchForm,
  PatchRecord,
  PedalBankId,
  PedalBankInfo,
  PedalInfo,
  PhraseRecord,
  SnapshotRestoreMode,
  SnapshotRestoreResult,
  SnapshotScope,
  UndoSnapshotInfo,
} from '@app/preload/ipc-contract';
import { SecureXMLParser } from '../SecureXMLParser.js';
import {
  GreenglassClient,
  GreenglassConnectionError,
  GreenglassRequestError,
  type GreenglassClientOptions,
  type GreenglassTransport,
} from './GreenglassClient.js';
import {
  formatBcdVersion,
  MAX_READ_CHUNK,
  PropertyID,
  type PropertyValue,
} from './greenglassCodec.js';
import { PedalEditor, type PedalProgress } from './PedalEditor.js';
import { createWriteGuard, PLAYLISTS_FILE } from './PedalFiles.js';
import { bankPath, PATCH_DIR_RE, PHRASE_DIR_RE, wavPath, type PedalWavRef } from './pedalPaths.js';

/** Family ID every JamMan reports in WhoAmI. */
const JAMMAN_FAMILY_ID = 93;

export type PedalManagerLogger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

export type PedalManagerDeps = {
  findPorts: () => Promise<string[]>;
  openTransport: (portPath: string) => Promise<GreenglassTransport>;
  /** Where downloaded WAVs are kept (one folder per pedal). */
  cacheRoot: string;
  /** Where temporary folders for backups and restores are made (default: next to the cache). */
  workRoot?: string;
  log: PedalManagerLogger;
  clientOptions?: GreenglassClientOptions;
  fs?: typeof nodeFs.promises;
};

/** Facts about one remote WAV, used to decide whether the cached copy is current. */
type RemoteWav = { remotePath: string; size: number; modified: number };

type Connection = {
  client: GreenglassClient;
  info: PedalInfo;
  properties: Map<number, PropertyValue>;
  editor: PedalEditor;
};

type ManagerEvents = {
  change: [PedalInfo | null];
  /** Progress of a long change (an upload); null when the change is over. */
  progress: [PedalProgress | null];
};

/** The user canceled a long operation (a download or an upload). */
export class PedalCanceledError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'PedalCanceledError';
  }
}

/** How much of a bank's audio is in the local cache. */
export type PedalAudioStatus = {
  files: number;
  totalBytes: number;
  cachedFiles: number;
  cachedBytes: number;
};

type BankWav = { ref: PedalWavRef; remote: RemoteWav };

export class PedalNotConnectedError extends Error {
  constructor() {
    super('No pedal is connected over USB');
    this.name = 'PedalNotConnectedError';
  }
}

export class PedalManager extends EventEmitter<ManagerEvents> {
  readonly #deps: PedalManagerDeps;
  readonly #fs: typeof nodeFs.promises;
  #connection: Connection | null = null;
  #connecting: Promise<PedalInfo> | null = null;
  /** Size in bytes of each bank, from the last time its patches were read. */
  readonly #bankBytes = new Map<PedalBankId, number>();
  /** Operations that change the pedal run one after another, never interleaved. */
  #exclusive: Promise<unknown> = Promise.resolve();
  /** Set by `cancel()`; the long operation running checks it between blocks. */
  #canceled = false;

  constructor(deps: PedalManagerDeps) {
    super();
    this.#deps = deps;
    this.#fs = deps.fs ?? nodeFs.promises;
  }

  status(): PedalInfo | null {
    return this.#connection?.info ?? null;
  }

  // ==================== Connection ====================

  /** Connects to the first JamMan found on USB, or returns the current connection. */
  async connect(): Promise<PedalInfo> {
    if (this.#connection) return this.#connection.info;
    this.#connecting ??= this.#connect().finally(() => {
      this.#connecting = null;
    });
    return this.#connecting;
  }

  async #connect(): Promise<PedalInfo> {
    const ports = await this.#deps.findPorts();
    if (ports.length === 0) {
      throw new Error(
        'No JamMan found on USB. Check that the pedal is on and connected with a USB cable.',
      );
    }

    const portPath = ports[0];
    const transport = await this.#deps.openTransport(portPath);
    const client = new GreenglassClient(transport, this.#deps.clientOptions);

    try {
      await client.resync();
      const who = await client.whoAmI();
      if (who.familyId !== JAMMAN_FAMILY_ID) {
        throw new Error(`The device on ${portPath} is not a JamMan (family ${who.familyId})`);
      }
      const properties = await client.getProperties();
      const bankRoots = [PropertyID.InternalPatchFolderPath, PropertyID.RemovablePatchFolderPath]
        .map(id => properties.get(id))
        .filter((root): root is string => typeof root === 'string' && root.startsWith('/'))
        .map(root => (root.endsWith('/') ? root : `${root}/`));
      const connection = {
        client,
        properties,
        info: buildInfo(who.name, formatBcdVersion(who.softwareVersion), who.guid, properties),
      } as Connection;
      connection.editor = new PedalEditor(
        client,
        bank => this.#bankRoot(connection, bank),
        createWriteGuard(bankRoots),
        this.#deps.log,
        {
          readLocalFile: path => this.#fs.readFile(path),
          onProgress: progress => {
            // Throwing here stops an upload between blocks; the editor cleans up.
            this.#throwIfCanceled();
            this.emit('progress', progress);
          },
        },
      );
      // Undo data from an earlier session can never be used: the history lived in the renderer.
      await connection.editor
        .purgeUndoData(connection.info.banks.filter(b => b.available).map(b => b.id))
        .catch(error => this.#deps.log.warn('Could not purge old undo data on the pedal:', error));
      this.#connection = connection;
      this.#bankBytes.clear();

      client.on('property', ({ property, value }) => {
        if (this.#connection !== connection) return;
        connection.properties.set(property, value);
        if (BANK_PROPERTIES.has(property)) {
          connection.info = buildInfo(
            connection.info.name,
            connection.info.firmwareVersion,
            connection.info.guid,
            connection.properties,
          );
          this.emit('change', connection.info);
        }
      });
      client.on('close', error => {
        if (this.#connection !== connection) return;
        this.#connection = null;
        this.#deps.log.info('Pedal disconnected:', error?.message ?? 'closed');
        this.emit('change', null);
      });

      this.#deps.log.info(
        `Connected to ${connection.info.name} (firmware ${connection.info.firmwareVersion}) on ${portPath}`,
      );
      this.emit('change', connection.info);
      return connection.info;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const connection = this.#connection;
    if (!connection) return;
    // No undo snapshot survives the connection: free the audio parked for them now
    // (the internal memory is small). Whatever is left is purged on the next connect.
    const banks = connection.info.banks.filter(b => b.available).map(b => b.id);
    await this.#change(editor => editor.purgeUndoData(banks)).catch(error =>
      this.#deps.log.warn('Could not purge undo data before disconnecting:', error),
    );
    // The client's close event clears #connection and emits the change.
    await connection.client.close();
  }

  #requireConnection(): Connection {
    if (!this.#connection) throw new PedalNotConnectedError();
    return this.#connection;
  }

  /** The folder of a bank on the pedal's file system, ending in `/`. */
  #bankRoot(connection: Connection, bank: PedalBankId): string {
    const bankInfo = connection.info.banks.find(b => b.id === bank);
    if (!bankInfo?.available) {
      throw new Error(bank === 'sd' ? 'There is no SD card in the pedal' : 'Bank not available');
    }
    const property =
      bank === 'sd' ? PropertyID.RemovablePatchFolderPath : PropertyID.InternalPatchFolderPath;
    const root = connection.properties.get(property);
    if (typeof root !== 'string' || !root.startsWith('/')) {
      throw new Error(`The pedal did not report the ${bank} folder`);
    }
    return root.endsWith('/') ? root : `${root}/`;
  }

  // ==================== Patches ====================

  /** Reads every patch of a bank from the pedal: folder listings and XML files, no audio. */
  async readPatches(bank: PedalBankId): Promise<PatchRecord[]> {
    const connection = this.#requireConnection();
    const { client } = connection;
    const root = this.#bankRoot(connection, bank);
    const { log } = this.#deps;

    let patchDirs: string[];
    try {
      patchDirs = (await client.folderContents(root)).folders.filter(d => PATCH_DIR_RE.test(d));
    } catch (error) {
      if (error instanceof GreenglassRequestError) {
        log.warn(`Pedal bank folder ${root} could not be listed:`, error.message);
        this.#bankBytes.set(bank, 0);
        return [];
      }
      throw error;
    }
    patchDirs.sort();

    const patches: PatchRecord[] = [];
    let totalBytes = 0;

    // Requests run one at a time on the wire anyway; reading sequentially keeps errors attributable.
    for (const dir of patchDirs) {
      try {
        const contents = await client.folderContents(`${root}${dir}/`);
        if (!contents.files.includes('patch.xml')) {
          log.warn(`Skipping ${dir} on the pedal: patch.xml not found`);
          continue;
        }
        const patchXml = await client.readFile(`${root}${dir}/patch.xml`);
        totalBytes += patchXml.length;
        const data = await SecureXMLParser.parsePatchXML(patchXml.toString('utf8'));

        const phrases: PhraseRecord[] = [];
        for (const phraseDir of contents.folders.filter(d => PHRASE_DIR_RE.test(d)).sort()) {
          const phraseRoot = `${root}${dir}/${phraseDir}/`;
          try {
            const phraseXml = await client.readFile(`${phraseRoot}phrase.xml`);
            const wav = await client.entryInfo(`${phraseRoot}phrase.wav`, false);
            totalBytes += phraseXml.length + (wav.exists ? wav.size : 0);
            phrases.push({
              dir: phraseDir,
              data: await SecureXMLParser.parsePhraseXML(phraseXml.toString('utf8')),
              wavPath: wavPath(bank, dir, phraseDir),
            });
          } catch (error) {
            if (isConnectionError(error)) throw error;
            log.warn(`Skipping phrase ${dir}/${phraseDir} on the pedal:`, errorText(error));
          }
        }

        patches.push({ dir, data, phrases });
      } catch (error) {
        if (isConnectionError(error)) throw error;
        log.warn(`Skipping patch ${dir} on the pedal:`, errorText(error));
      }
    }

    this.#bankBytes.set(bank, totalBytes);
    log.info(`Read ${patches.length} patches from the pedal's ${bank} bank`);
    return patches;
  }

  /** The patch folders of a bank. */
  listPatchDirs(bank: PedalBankId): Promise<string[]> {
    return this.#requireConnection().editor.listPatchDirs(bank);
  }

  /** Bytes used by a bank's patches, as counted by the last `readPatches`. */
  async bankSize(bank: PedalBankId): Promise<number> {
    this.#requireConnection();
    const known = this.#bankBytes.get(bank);
    if (known !== undefined) return known;
    await this.readPatches(bank);
    return this.#bankBytes.get(bank) ?? 0;
  }

  // ==================== Changes ====================

  /** Runs `fn` with the editor, after every earlier change has finished. */
  #change<T>(fn: (editor: PedalEditor, connection: Connection) => Promise<T>): Promise<T> {
    const run = async () => {
      const connection = this.#requireConnection();
      this.#canceled = false;
      try {
        return await fn(connection.editor, connection);
      } finally {
        await this.#forgetCachedAudio(connection, connection.editor.takeTouched());
      }
    };
    const result = this.#exclusive.then(run, run);
    this.#exclusive = result.catch(() => undefined);
    return result.finally(() => {
      this.#bankBytes.clear();
      this.emit('progress', null);
    });
  }

  /** Stops the long operation that is running (download or upload), if any. */
  cancel(): void {
    this.#canceled = true;
  }

  #throwIfCanceled(): void {
    if (this.#canceled) throw new PedalCanceledError();
  }

  /** Drops the cached audio of patches the app just changed (see `PedalEditor.takeTouched`). */
  async #forgetCachedAudio(connection: Connection, touched: string[]): Promise<void> {
    for (const entry of touched) {
      const [bank, dir] = entry.split('/');
      const folder = path.join(this.#cacheFolder(connection), bank, dir);
      await this.#fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  createPatch(bank: PedalBankId, form: PatchForm): Promise<void> {
    return this.#change(editor => editor.createPatch(bank, form));
  }

  updatePatch(bank: PedalBankId, form: PatchForm): Promise<void> {
    return this.#change(editor => editor.updatePatch(bank, form));
  }

  deletePatches(bank: PedalBankId, dirs: string[]): Promise<{ deleted: string[]; failed: number }> {
    return this.#change(editor => editor.deletePatches(bank, dirs));
  }

  reorderPatches(bank: PedalBankId, newOrder: string[]): Promise<void> {
    return this.#change(editor => editor.reorderPatches(bank, newOrder));
  }

  createSnapshot(bank: PedalBankId, scope: SnapshotScope): Promise<UndoSnapshotInfo> {
    return this.#change(editor => editor.createSnapshot(bank, scope));
  }

  restoreSnapshot(
    id: string,
    bank: PedalBankId,
    mode: SnapshotRestoreMode,
    only?: string[],
  ): Promise<SnapshotRestoreResult> {
    return this.#change(editor => editor.restoreSnapshot(id, bank, mode, only));
  }

  /** Never throws: without a connection there is nothing to delete (the next connect purges it). */
  async discardSnapshot(id: string): Promise<void> {
    if (!this.#connection) return;
    await this.#change(editor => editor.discardSnapshot(id)).catch(() => undefined);
  }

  // ==================== Whole banks: download, backup, restore ====================

  /** Every phrase WAV of a bank (or of some of its patches), with what the pedal reports for it. */
  async #bankWavs(connection: Connection, bank: PedalBankId, dirs?: string[]): Promise<BankWav[]> {
    const root = this.#bankRoot(connection, bank);
    const patchDirs = dirs ?? (await connection.editor.listPatchDirs(bank));
    const wavs: BankWav[] = [];
    for (const patch of patchDirs) {
      if (!PATCH_DIR_RE.test(patch)) throw new Error(`Invalid patch directory name: ${patch}`);
      let contents;
      try {
        contents = await connection.client.folderContents(`${root}${patch}/`);
      } catch (error) {
        if (error instanceof GreenglassRequestError) continue;
        throw error;
      }
      for (const phrase of contents.folders.filter(d => PHRASE_DIR_RE.test(d)).sort()) {
        const ref = { bank, patch, phrase };
        try {
          wavs.push({ ref, remote: await this.#remoteWav(connection, ref) });
        } catch (error) {
          if (!(error instanceof GreenglassRequestError)) throw error;
        }
      }
    }
    return wavs;
  }

  /** How much of a bank's audio is already cached here. Reads no audio. */
  async audioStatus(bank: PedalBankId, dirs?: string[]): Promise<PedalAudioStatus> {
    const connection = this.#requireConnection();
    const status: PedalAudioStatus = { files: 0, totalBytes: 0, cachedFiles: 0, cachedBytes: 0 };
    for (const { ref, remote } of await this.#bankWavs(connection, bank, dirs)) {
      status.files++;
      status.totalBytes += remote.size;
      if (await this.#cachedCopy(connection, ref, remote)) {
        status.cachedFiles++;
        status.cachedBytes += remote.size;
      }
    }
    return status;
  }

  /**
   * Downloads a WAV into the cache. The copy is kept only when complete, so a
   * canceled download leaves nothing behind and the next attempt starts over
   * for that file (finished files are kept: a bank download resumes).
   */
  async #download(
    connection: Connection,
    { ref, remote }: BankWav,
    onBytes: (count: number) => void,
  ): Promise<string> {
    const cached = await this.#cachedCopy(connection, ref, remote);
    if (cached) return cached;

    const { client } = connection;
    const paths = this.#cachePaths(connection, ref);
    await this.#fs.mkdir(path.dirname(paths.file), { recursive: true });
    await this.#fs.rm(paths.meta, { force: true });
    const out = await this.#fs.open(paths.partial, 'w');
    const { handle } = await client.openForRead(remote.remotePath);
    let complete = false;
    try {
      let done = 0;
      while (done < remote.size) {
        this.#throwIfCanceled();
        const chunk = await client.read(handle, Math.min(MAX_READ_CHUNK, remote.size - done));
        if (chunk.length === 0) throw new Error('The file on the pedal is shorter than reported');
        await out.write(chunk);
        done += chunk.length;
        onBytes(chunk.length);
      }
      complete = true;
    } finally {
      await out.close().catch(() => undefined);
      if (client.isOpen) await client.closeFile(handle).catch(() => undefined);
      if (complete) {
        await this.#fs.rename(paths.partial, paths.file);
        await this.#fs.writeFile(
          paths.meta,
          JSON.stringify({ size: remote.size, modified: remote.modified }),
        );
      } else {
        await this.#fs.rm(paths.partial, { force: true });
      }
    }
    return paths.file;
  }

  /** Downloads every WAV that is not cached yet, reporting progress over all of them. */
  async #downloadAll(
    connection: Connection,
    wavs: BankWav[],
    label: string,
  ): Promise<Map<BankWav, string>> {
    const files = new Map<BankWav, string>();
    const missing: BankWav[] = [];
    for (const wav of wavs) {
      const cached = await this.#cachedCopy(connection, wav.ref, wav.remote);
      if (cached) files.set(wav, cached);
      else missing.push(wav);
    }
    const total = missing.reduce((sum, wav) => sum + wav.remote.size, 0);
    let done = 0;
    if (missing.length > 0) this.emit('progress', { label, done, total });
    for (const wav of missing) {
      files.set(
        wav,
        await this.#download(connection, wav, count => {
          done += count;
          this.emit('progress', { label, done, total });
        }),
      );
    }
    return files;
  }

  /** Downloads a bank's audio into the cache: playback and backups no longer wait on USB. */
  downloadAudio(bank: PedalBankId): Promise<PedalAudioStatus> {
    return this.#change(async (_editor, connection) => {
      const wavs = await this.#bankWavs(connection, bank);
      await this.#downloadAll(connection, wavs, 'Downloading audio');
      return {
        files: wavs.length,
        totalBytes: wavs.reduce((sum, w) => sum + w.remote.size, 0),
        cachedFiles: wavs.length,
        cachedBytes: wavs.reduce((sum, w) => sum + w.remote.size, 0),
      };
    });
  }

  /** Runs `fn` with a fresh local folder that is deleted afterwards. */
  async withLocalWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const root = this.#deps.workRoot ?? path.join(path.dirname(this.#deps.cacheRoot), 'pedal-work');
    await this.#fs.mkdir(root, { recursive: true });
    const dir = await this.#fs.mkdtemp(path.join(root, 'job-'));
    try {
      return await fn(dir);
    } finally {
      await this.#fs.rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Copies patches of a bank into a local folder laid out like a card, for a
   * backup. WAVs come from the cache (downloaded first when missing) and are
   * hard-linked when possible. Returns the patch folders written.
   */
  exportBank(
    bank: PedalBankId,
    dirs: string[] | undefined,
    includePlaylists: boolean,
    target: string,
  ): Promise<string[]> {
    return this.#change(async (editor, connection) => {
      const { client } = connection;
      const root = this.#bankRoot(connection, bank);
      const patchDirs = dirs && dirs.length > 0 ? dirs : await editor.listPatchDirs(bank);
      const wavs = await this.#bankWavs(connection, bank, patchDirs);
      const cached = await this.#downloadAll(connection, wavs, 'Downloading audio for the backup');

      const exported: string[] = [];
      for (const dir of patchDirs) {
        this.#throwIfCanceled();
        let contents;
        try {
          contents = await client.folderContents(`${root}${dir}/`);
        } catch (error) {
          if (error instanceof GreenglassRequestError) continue;
          throw error;
        }
        if (!contents.files.includes('patch.xml')) continue;
        const local = path.join(target, dir);
        await this.#fs.mkdir(local, { recursive: true });
        await this.#fs.writeFile(
          path.join(local, 'patch.xml'),
          await client.readFile(`${root}${dir}/patch.xml`),
        );
        for (const phrase of contents.folders.filter(d => PHRASE_DIR_RE.test(d))) {
          await this.#fs.mkdir(path.join(local, phrase), { recursive: true });
          try {
            const xml = await client.readFile(`${root}${dir}/${phrase}/phrase.xml`);
            await this.#fs.writeFile(path.join(local, phrase, 'phrase.xml'), xml);
          } catch (error) {
            if (!(error instanceof GreenglassRequestError)) throw error;
          }
          const wav = wavs.find(w => w.ref.patch === dir && w.ref.phrase === phrase);
          const source = wav && cached.get(wav);
          if (source) {
            const destination = path.join(local, phrase, 'phrase.wav');
            await this.#fs
              .link(source, destination)
              .catch(() => this.#fs.copyFile(source, destination));
          }
        }
        exported.push(dir);
      }

      if (includePlaylists) {
        const playlists = await editor.readPlaylists(bank);
        if (playlists) await this.#fs.writeFile(path.join(target, PLAYLISTS_FILE), playlists);
      }
      return exported;
    });
  }

  /**
   * Uploads patches laid out like a card in a local folder (a restored backup)
   * into a bank. With `replaceAll` every patch on the pedal is deleted first
   * (WAVs an undo snapshot needs are parked, as for any delete). The folder's
   * playlists file, if any, replaces the bank's.
   */
  importPatches(
    bank: PedalBankId,
    source: string,
    dirs: string[],
    replaceAll: boolean,
  ): Promise<void> {
    return this.#change(async editor => {
      if (replaceAll) await editor.deletePatches(bank, await editor.listPatchDirs(bank));
      for (const dir of dirs) {
        this.#throwIfCanceled();
        if (!PATCH_DIR_RE.test(dir)) throw new Error(`Invalid patch directory name: ${dir}`);
        const local = path.join(source, dir);
        const entries = await this.#fs.readdir(local, { withFileTypes: true });
        const phrases = [];
        for (const entry of entries.filter(e => e.isDirectory() && PHRASE_DIR_RE.test(e.name))) {
          const xmlPath = path.join(local, entry.name, 'phrase.xml');
          const wavPath = path.join(local, entry.name, 'phrase.wav');
          phrases.push({
            name: entry.name,
            xml: await this.#fs.readFile(xmlPath).catch(() => null),
            wavPath: await this.#fs.access(wavPath).then(
              () => wavPath,
              () => null,
            ),
          });
        }
        await editor.uploadPatch(bank, dir, {
          patchXml: await this.#fs.readFile(path.join(local, 'patch.xml')),
          phrases,
        });
      }
      const playlists = await this.#fs
        .readFile(path.join(source, PLAYLISTS_FILE))
        .catch(() => null);
      if (playlists) await editor.writePlaylists(bank, playlists);
    });
  }

  // ==================== Audio ====================

  async #remoteWav(connection: Connection, ref: PedalWavRef): Promise<RemoteWav> {
    const remotePath = `${this.#bankRoot(connection, ref.bank)}${ref.patch}/${ref.phrase}/phrase.wav`;
    const info = await connection.client.entryInfo(remotePath, false);
    if (!info.exists) {
      throw new GreenglassRequestError('No such file or directory');
    }
    return { remotePath, size: info.size, modified: info.modified.getTime() };
  }

  #cacheFolder(connection: Connection): string {
    // The guid comes from the device: keep only characters that are safe in a folder name.
    const pedalFolder = connection.info.guid.replace(/[^0-9a-zA-Z-]/g, '') || 'unknown';
    return path.join(this.#deps.cacheRoot, pedalFolder);
  }

  #cachePaths(connection: Connection, ref: PedalWavRef) {
    const file = path.join(
      this.#cacheFolder(connection),
      ref.bank,
      ref.patch,
      ref.phrase,
      'phrase.wav',
    );
    return { file, meta: `${file}.json`, partial: `${file}.part` };
  }

  /** The cached copy of a WAV, if it matches what the pedal reports now. */
  async #cachedCopy(connection: Connection, ref: PedalWavRef, remote: RemoteWav) {
    const paths = this.#cachePaths(connection, ref);
    try {
      const meta = JSON.parse(await this.#fs.readFile(paths.meta, 'utf8')) as Partial<RemoteWav>;
      const stats = await this.#fs.stat(paths.file);
      if (
        meta.size === remote.size &&
        meta.modified === remote.modified &&
        stats.size === remote.size
      ) {
        return paths.file;
      }
    } catch {
      // No cache, or unreadable: download again.
    }
    return null;
  }

  /** Size of a phrase WAV on the pedal. */
  async wavSize(ref: PedalWavRef): Promise<number> {
    const connection = this.#requireConnection();
    return (await this.#remoteWav(connection, ref)).size;
  }

  /** The first `count` bytes of a WAV (enough to read its format), plus its size. */
  async readWavHead(ref: PedalWavRef, count: number): Promise<{ head: Buffer; size: number }> {
    const connection = this.#requireConnection();
    const remote = await this.#remoteWav(connection, ref);
    const cached = await this.#cachedCopy(connection, ref, remote);
    if (cached) {
      const handle = await this.#fs.open(cached, 'r');
      try {
        const head = Buffer.alloc(Math.min(count, remote.size));
        await handle.read(head, 0, head.length, 0);
        return { head, size: remote.size };
      } finally {
        await handle.close();
      }
    }

    const { client } = connection;
    const { handle } = await client.openForRead(remote.remotePath);
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (total < Math.min(count, remote.size)) {
        const chunk = await client.read(handle, Math.min(count, remote.size) - total);
        if (chunk.length === 0) break;
        chunks.push(chunk);
        total += chunk.length;
      }
    } finally {
      await client.closeFile(handle).catch(() => undefined);
    }
    return { head: Buffer.concat(chunks, total), size: remote.size };
  }

  /**
   * A stream of bytes `[start, end]` of a WAV for the `jamman://` protocol, and
   * the file size. Served from the cache when it is current; otherwise read
   * from the pedal, and when the whole file is requested it is written to the
   * cache on the way.
   *
   * `range` null means "the whole file".
   */
  async openWavStream(
    ref: PedalWavRef,
    pickRange: (size: number) => { start: number; end: number } | null | 'unsatisfiable',
  ): Promise<
    | { size: number; range: 'unsatisfiable' }
    | {
        size: number;
        range: { start: number; end: number } | null;
        stream: ReadableStream<Uint8Array> | null;
      }
  > {
    const connection = this.#requireConnection();
    const remote = await this.#remoteWav(connection, ref);
    const range = pickRange(remote.size);
    if (range === 'unsatisfiable') return { size: remote.size, range };
    if (remote.size === 0) return { size: 0, range, stream: null };

    const { start, end } = range ?? { start: 0, end: remote.size - 1 };
    const cached = await this.#cachedCopy(connection, ref, remote);
    if (cached) {
      const stream = Readable.toWeb(
        nodeFs.createReadStream(cached, { start, end }),
      ) as ReadableStream<Uint8Array>;
      return { size: remote.size, range, stream };
    }

    const fillCache = start === 0 && end === remote.size - 1;
    return {
      size: remote.size,
      range,
      stream: this.#deviceStream(connection, ref, remote, start, end, fillCache),
    };
  }

  #deviceStream(
    connection: Connection,
    ref: PedalWavRef,
    remote: RemoteWav,
    start: number,
    end: number,
    fillCache: boolean,
  ): ReadableStream<Uint8Array> {
    const { client } = connection;
    const fs = this.#fs;
    const log = this.#deps.log;
    const paths = this.#cachePaths(connection, ref);
    let handle: bigint | null = null;
    let position = start;
    let cacheFile: nodeFs.promises.FileHandle | null = null;

    const release = async (keepCache: boolean) => {
      const fileHandle = handle;
      handle = null;
      if (fileHandle !== null && client.isOpen) {
        await client.closeFile(fileHandle).catch(() => undefined);
      }
      if (cacheFile) {
        const file = cacheFile;
        cacheFile = null;
        await file.close().catch(() => undefined);
        try {
          if (keepCache) {
            await fs.rename(paths.partial, paths.file);
            await fs.writeFile(
              paths.meta,
              JSON.stringify({ size: remote.size, modified: remote.modified }),
            );
          } else {
            await fs.rm(paths.partial, { force: true });
          }
        } catch (error) {
          log.warn('Could not update the pedal audio cache:', error);
        }
      }
    };

    return new ReadableStream<Uint8Array>({
      start: async () => {
        const opened = await client.openForRead(remote.remotePath);
        handle = opened.handle;
        if (start > 0) await client.seek(handle, start);
        if (fillCache) {
          try {
            await fs.mkdir(path.dirname(paths.file), { recursive: true });
            await fs.rm(paths.meta, { force: true });
            cacheFile = await fs.open(paths.partial, 'w');
          } catch (error) {
            log.warn('Pedal audio will not be cached:', error);
            cacheFile = null;
          }
        }
      },
      pull: async controller => {
        try {
          if (handle === null || position > end) {
            await release(position > end);
            controller.close();
            return;
          }
          const chunk = await client.read(handle, Math.min(MAX_READ_CHUNK, end - position + 1));
          if (chunk.length === 0) {
            // The file is shorter than reported: do not keep a truncated copy.
            await release(false);
            controller.close();
            return;
          }
          position += chunk.length;
          if (cacheFile) await cacheFile.write(chunk);
          controller.enqueue(new Uint8Array(chunk));
          if (position > end) {
            await release(true);
            controller.close();
          }
        } catch (error) {
          await release(false);
          controller.error(error);
        }
      },
      cancel: async () => {
        await release(false);
      },
    });
  }

  /** The whole WAV, from the cache when current (downloading it there otherwise). */
  async readWav(ref: PedalWavRef): Promise<Buffer> {
    const opened = await this.openWavStream(ref, () => null);
    if (opened.range === 'unsatisfiable' || !opened.stream) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    for await (const chunk of Readable.fromWeb(
      opened.stream as import('node:stream/web').ReadableStream,
    )) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
}

const BANK_PROPERTIES = new Set<number>([
  PropertyID.RemovableMediaIsPresent,
  PropertyID.KilobytesAvailableOnNand,
  PropertyID.KilobytesCapacityOnNand,
  PropertyID.KilobytesAvailableOnSd,
  PropertyID.KilobytesCapacityOnSd,
]);

function intProperty(properties: Map<number, PropertyValue>, id: number): number {
  const value = properties.get(id);
  return typeof value === 'number' ? value : 0;
}

function buildInfo(
  name: string,
  firmwareVersion: string,
  guid: string,
  properties: Map<number, PropertyValue>,
): PedalInfo {
  const kb = (id: number) => intProperty(properties, id) * 1024;
  const banks: PedalBankInfo[] = [
    {
      id: 'internal',
      path: bankPath('internal'),
      available: true,
      capacityBytes: kb(PropertyID.KilobytesCapacityOnNand),
      freeBytes: kb(PropertyID.KilobytesAvailableOnNand),
    },
    {
      id: 'sd',
      path: bankPath('sd'),
      available: intProperty(properties, PropertyID.RemovableMediaIsPresent) === 1,
      capacityBytes: kb(PropertyID.KilobytesCapacityOnSd),
      freeBytes: kb(PropertyID.KilobytesAvailableOnSd),
    },
  ];
  return { name, firmwareVersion, guid, banks };
}

/**
 * Whether an error means the pedal is gone. Anything else while reading one
 * patch (a FailureResponse, a malformed XML) only skips that patch or phrase.
 */
function isConnectionError(error: unknown): boolean {
  return error instanceof GreenglassConnectionError || error instanceof PedalNotConnectedError;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
