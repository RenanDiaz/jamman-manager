/**
 * Request/response client for Greenglass over any byte transport.
 *
 * - One request in flight at a time: the pedal's parser has no way to resync,
 *   so requests are queued and each one waits for its response (or times out).
 * - A timeout or a corrupt frame means the stream can no longer be trusted:
 *   the client closes itself and every pending and later request fails.
 * - Notifications (`msgID >= 0x8000`) can arrive at any moment and are emitted
 *   as events.
 *
 * @module usb/GreenglassClient
 */
import { EventEmitter } from 'node:events';
import {
  decodeEntryInfo,
  decodeFolderContents,
  decodeProperties,
  decodePropertyChanged,
  decodeWhoAmI,
  encodeRequest,
  FileAccess,
  FileMode,
  FrameParser,
  isNotification,
  MAX_READ_CHUNK,
  MAX_WRITE_CHUNK,
  MessageID,
  PayloadReader,
  PayloadWriter,
  SeekOrigin,
  type EntryInfo,
  type FolderContents,
  type Frame,
  type PropertyChange,
  type PropertyValue,
  type WhoAmI,
} from './greenglassCodec.js';

/** A byte pipe to the pedal. `write` resolves once every byte has been handed to the OS. */
export interface GreenglassTransport {
  write(data: Buffer): Promise<void>;
  close(): Promise<void>;
  onData(listener: (chunk: Buffer) => void): void;
  onClose(listener: (error?: Error) => void): void;
}

/** The pedal answered with a FailureResponse. The connection is still usable. */
export class GreenglassRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GreenglassRequestError';
  }
}

/** The connection is gone (unplugged, timed out, corrupt stream or closed). */
export class GreenglassConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GreenglassConnectionError';
  }
}

export type GreenglassClientOptions = {
  /** How long to wait for each response. */
  requestTimeoutMs?: number;
};

type Pending = {
  serial: number;
  resolve: (frame: Frame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ClientEvents = {
  property: [PropertyChange];
  close: [Error | undefined];
};

export class GreenglassClient extends EventEmitter<ClientEvents> {
  readonly #transport: GreenglassTransport;
  readonly #parser = new FrameParser();
  readonly #timeoutMs: number;
  #nextSerial = 1;
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #closedError: Error | null = null;
  /** Set by `close()`: no new request may start while the current one finishes. */
  #closing = false;
  /** While set, incoming bytes are dropped (see `discardStaleInput`). */
  #discarding = false;
  #lastDataAt = 0;

  constructor(transport: GreenglassTransport, options: GreenglassClientOptions = {}) {
    super();
    this.#transport = transport;
    this.#timeoutMs = options.requestTimeoutMs ?? 5000;
    transport.onData(chunk => this.#onData(chunk));
    transport.onClose(error =>
      this.#fail(new GreenglassConnectionError('The pedal was disconnected', { cause: error })),
    );
  }

  get isOpen(): boolean {
    return this.#closedError === null;
  }

  /**
   * Closes the connection. The request on the wire (if any) is allowed to
   * finish first, up to `waitMs`: closing the port in the middle of a response
   * leaves the rest of it in the pedal's output, and the next connection would
   * read it as garbage.
   */
  async close({ waitMs = 1000 }: { waitMs?: number } = {}): Promise<void> {
    if (this.#closedError) return;
    this.#closing = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.#queue,
      new Promise(resolve => {
        timer = setTimeout(resolve, waitMs);
      }),
    ]);
    clearTimeout(timer);
    this.#fail(new GreenglassConnectionError('Connection closed'));
  }

  /**
   * Drops whatever the pedal is sending until the line has been quiet for
   * `quietMs` (or `maxMs` passed). Call it before the first request: when the
   * port is opened the pedal sends notifications, and after an interrupted
   * session it may still be sending the rest of an old response.
   */
  async discardStaleInput({ quietMs = 150, maxMs = 2000 } = {}): Promise<void> {
    this.#discarding = true;
    const started = Date.now();
    this.#lastDataAt = started;
    try {
      while (Date.now() - this.#lastDataAt < quietMs && Date.now() - started < maxMs) {
        await new Promise(resolve => setTimeout(resolve, Math.min(quietMs, 50)));
      }
    } finally {
      this.#discarding = false;
      this.#parser.reset();
    }
  }

  // ==================== Requests ====================

  async whoAmI(): Promise<WhoAmI> {
    return decodeWhoAmI(await this.#request(MessageID.WhoAmIRequest, MessageID.WhoAmIResponse));
  }

  async getProperties(): Promise<Map<number, PropertyValue>> {
    const body = new PayloadWriter().u8(0).build(); // empty property path
    return decodeProperties(
      await this.#request(MessageID.GetPropertiesRequest, MessageID.GetPropertiesResponse, body),
    );
  }

  async folderContents(path: string): Promise<FolderContents> {
    const body = new PayloadWriter().str(path).build();
    return decodeFolderContents(
      await this.#request(MessageID.FolderContentsRequest, MessageID.FolderContentsResponse, body),
    );
  }

  async entryInfo(path: string, isFolder: boolean): Promise<EntryInfo> {
    const body = new PayloadWriter().bool(isFolder).str(path).build();
    return decodeEntryInfo(
      await this.#request(
        MessageID.FileSystemEntryInfoRequest,
        MessageID.FileSystemEntryInfoResponse,
        body,
      ),
    );
  }

  /** Opens a file for reading. Always pair with `closeFile`. */
  async openForRead(path: string): Promise<{ handle: bigint; size: number }> {
    const body = new PayloadWriter()
      .str(path)
      .u8(FileAccess.Read)
      .u8(FileMode.OpenExisting)
      .build();
    const r = await this.#request(MessageID.FileOpenRequest, MessageID.FileOpenResponse, body);
    return { handle: r.i64(), size: Number(r.i64()) };
  }

  /** Reads up to `count` bytes (at most MAX_READ_CHUNK). An empty buffer means end of file. */
  async read(handle: bigint, count: number): Promise<Buffer> {
    const body = new PayloadWriter().i64(handle).i32(Math.min(count, MAX_READ_CHUNK)).build();
    const r = await this.#request(MessageID.FileReadRequest, MessageID.FileReadResponse, body);
    r.i64(); // handle
    return r.bytes(r.i32());
  }

  async seek(handle: bigint, offset: number): Promise<void> {
    const body = new PayloadWriter().i64(handle).i64(BigInt(offset)).u8(SeekOrigin.Begin).build();
    await this.#request(MessageID.FileSeekRequest, MessageID.SuccessResponse, body);
  }

  async closeFile(handle: bigint): Promise<void> {
    const body = new PayloadWriter().i64(handle).build();
    await this.#request(MessageID.FileCloseRequest, MessageID.SuccessResponse, body);
  }

  /** Reads a whole file. Closes the handle even when a read fails. */
  async readFile(path: string): Promise<Buffer> {
    const { handle, size } = await this.openForRead(path);
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (total < size) {
        const chunk = await this.read(handle, size - total);
        if (chunk.length === 0) break;
        chunks.push(chunk);
        total += chunk.length;
      }
    } finally {
      await this.#closeQuietly(handle);
    }
    return Buffer.concat(chunks, total);
  }

  // ==================== Writes ====================
  // The pedal moves files reliably but cannot move a folder that contains
  // folders ("The folder could not be copied"), so there is no folder move
  // here: callers move the files and recreate the folders (see PedalFiles).

  /** Creates a folder. Fails when it exists and `overwriteExisting` is false. */
  async createFolder(path: string, overwriteExisting = false): Promise<void> {
    const body = new PayloadWriter().bool(true).str(path).bool(overwriteExisting).build();
    await this.#request(MessageID.FileSystemEntryCreateRequest, MessageID.SuccessResponse, body);
  }

  /** Deletes a file, or a folder (with everything in it when `recursive`). Never to a trash. */
  async delete(path: string, isFolder: boolean, recursive = false): Promise<void> {
    const body = new PayloadWriter()
      .bool(isFolder)
      .str(path)
      .bool(recursive)
      .bool(false) // move to trash: the pedal has none
      .build();
    await this.#request(MessageID.FileSystemEntryDeleteRequest, MessageID.SuccessResponse, body);
  }

  /** Moves (renames) a file, also across folders of the same medium. Instant: no data is copied. */
  async moveFile(source: string, target: string, overwriteExisting = false): Promise<void> {
    const body = new PayloadWriter()
      .bool(false)
      .str(source)
      .str(target)
      .bool(false) // keep original
      .bool(overwriteExisting)
      .build();
    await this.#request(MessageID.FileSystemEntryMoveRequest, MessageID.SuccessResponse, body);
  }

  /** Creates or truncates a file and writes `data` to it. Closes the handle even when a write fails. */
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const open = new PayloadWriter()
      .str(path)
      .u8(FileAccess.Write)
      .u8(FileMode.CreateOrTruncate)
      .build();
    const r = await this.#request(MessageID.FileOpenRequest, MessageID.FileOpenResponse, open);
    const handle = r.i64();
    try {
      for (let offset = 0; offset < data.length; offset += MAX_WRITE_CHUNK) {
        const chunk = data.subarray(offset, offset + MAX_WRITE_CHUNK);
        const body = new PayloadWriter().i64(handle).i32(chunk.length).bytes(chunk).build();
        await this.#request(MessageID.FileWriteRequest, MessageID.SuccessResponse, body);
      }
    } catch (error) {
      await this.#closeQuietly(handle);
      throw error;
    }
    await this.closeFile(handle);
  }

  /** Closes a handle without masking the error that made the caller stop. */
  async #closeQuietly(handle: bigint): Promise<void> {
    if (!this.isOpen) return;
    try {
      await this.closeFile(handle);
    } catch {
      // The original error matters more; a broken connection is already reported.
    }
  }

  // ==================== Plumbing ====================

  /**
   * Queues one request and resolves with a reader positioned after the echoed
   * serial number of the expected response.
   */
  #request(id: number, expectedResponse: number, body?: Buffer): Promise<PayloadReader> {
    const run = async (): Promise<PayloadReader> => {
      if (this.#closedError) throw this.#closedError;
      if (this.#closing) throw new GreenglassConnectionError('Connection closed');

      const serial = this.#nextSerial;
      this.#nextSerial = (this.#nextSerial + 1) >>> 0;

      const response = new Promise<Frame>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.#fail(
            new GreenglassConnectionError(
              `The pedal did not answer request ${id} within ${this.#timeoutMs} ms`,
            ),
          );
        }, this.#timeoutMs);
        this.#pending = { serial, resolve, reject, timer };
      });

      try {
        await this.#transport.write(encodeRequest(id, serial, body));
      } catch (error) {
        this.#fail(new GreenglassConnectionError('Could not write to the pedal', { cause: error }));
      }

      const frame = await response;
      const reader = new PayloadReader(frame.payload);
      reader.u32(); // serial, already matched
      if (frame.id === MessageID.FailureResponse) {
        throw new GreenglassRequestError(reader.str());
      }
      if (frame.id !== expectedResponse) {
        throw new GreenglassRequestError(
          `Unexpected response ${frame.id} to request ${id} (expected ${expectedResponse})`,
        );
      }
      return reader;
    };

    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #onData(chunk: Buffer): void {
    if (this.#discarding) {
      this.#lastDataAt = Date.now();
      return;
    }
    let frames: Frame[];
    try {
      frames = this.#parser.push(chunk);
    } catch (error) {
      this.#fail(new GreenglassConnectionError('Corrupt data from the pedal', { cause: error }));
      return;
    }

    for (const frame of frames) {
      if (isNotification(frame.id)) {
        this.#onNotification(frame);
        continue;
      }
      const pending = this.#pending;
      if (frame.payload.length < 4) continue;
      const serial = frame.payload.readUInt32LE(0);
      if (pending && pending.serial === serial) {
        clearTimeout(pending.timer);
        this.#pending = null;
        pending.resolve(frame);
      }
      // A response for a serial nobody waits for (e.g. after a timeout) is dropped.
    }
  }

  #onNotification(frame: Frame): void {
    if (frame.id !== MessageID.PropertyChangedNotification) return;
    try {
      this.emit('property', decodePropertyChanged(new PayloadReader(frame.payload)));
    } catch {
      // Malformed notification: ignore it, responses are what matter.
    }
  }

  #fail(error: Error): void {
    if (this.#closedError) return;
    this.#closedError = error;
    const pending = this.#pending;
    this.#pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#parser.reset();
    this.#transport.close().catch(() => undefined);
    this.emit('close', error);
  }
}
