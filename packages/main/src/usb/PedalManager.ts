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
  PatchRecord,
  PedalBankId,
  PedalBankInfo,
  PedalInfo,
  PhraseRecord,
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
};

type ManagerEvents = { change: [PedalInfo | null] };

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
      await client.discardStaleInput();
      const who = await client.whoAmI();
      if (who.familyId !== JAMMAN_FAMILY_ID) {
        throw new Error(`The device on ${portPath} is not a JamMan (family ${who.familyId})`);
      }
      const properties = await client.getProperties();
      const connection: Connection = {
        client,
        properties,
        info: buildInfo(who.name, formatBcdVersion(who.softwareVersion), who.guid, properties),
      };
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

  /** Bytes used by a bank's patches, as counted by the last `readPatches`. */
  async bankSize(bank: PedalBankId): Promise<number> {
    this.#requireConnection();
    const known = this.#bankBytes.get(bank);
    if (known !== undefined) return known;
    await this.readPatches(bank);
    return this.#bankBytes.get(bank) ?? 0;
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

  #cachePaths(connection: Connection, ref: PedalWavRef) {
    // The guid comes from the device: keep only characters that are safe in a folder name.
    const pedalFolder = connection.info.guid.replace(/[^0-9a-zA-Z-]/g, '') || 'unknown';
    const file = path.join(
      this.#deps.cacheRoot,
      pedalFolder,
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
