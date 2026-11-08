/**
 * An in-memory JamMan that speaks Greenglass over a fake transport, for tests.
 *
 * Files live in a map of absolute paths; folders are implied by the paths.
 * Responses are delivered asynchronously, in chunks of a configurable size,
 * so the client's frame reassembly is exercised too.
 *
 * @module test-utils/fakePedal
 */
import type { GreenglassTransport } from '../usb/GreenglassClient.js';
import {
  encodeFrame,
  FrameParser,
  MessageID,
  PayloadReader,
  PayloadWriter,
  PropertyID,
  type PropertyValue,
} from '../usb/greenglassCodec.js';

export const FAKE_INTERNAL_ROOT = '/mnt/nandfs/JamManStereo/';
export const FAKE_SD_ROOT = '/mnt/sdfs/JamManStereo/';

export type FakePedalOptions = {
  files?: Record<string, Buffer | string>;
  sdPresent?: boolean;
  /** Split every response into chunks of this many bytes (default: whole frames). */
  chunkSize?: number;
};

type OpenFile = { path: string; position: number; write: boolean };

/** `/a/b/` and `/a/b` name the same folder. */
const asFolder = (path: string) => (path.endsWith('/') ? path : `${path}/`);
const parentOf = (path: string) => {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(0, trimmed.lastIndexOf('/') + 1);
};

export function patchXml(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManStereo" version="1">
  <PatchName>${name}</PatchName>
  <RhythmType>Silence</RhythmType>
  <StopMode>StopInstantly</StopMode>
  <SettingsVersion>0</SettingsVersion>
  <ID>id-${name}</ID>
</JamManPatch>`;
}

export function phraseXml(bpm = 120): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<JamManPhrase xmlns="http://schemas.digitech.com/JamMan/Phrase" version="1">
  <BeatsPerMinute>${bpm}</BeatsPerMinute>
  <BeatsPerMeasure>4</BeatsPerMeasure>
  <IsLoop>1</IsLoop>
  <IsReversed>0</IsReversed>
</JamManPhrase>`;
}

/** A minimal 16-bit stereo 44.1 kHz WAV with `dataBytes` of audio (a byte ramp). */
export function wavBytes(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // channels
  header.writeUInt32LE(44100, 24);
  header.writeUInt32LE(44100 * 4, 28); // byte rate
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  const data = Buffer.from(Array.from({ length: dataBytes }, (_, i) => i % 251));
  return Buffer.concat([header, data]);
}

export class FakePedal {
  readonly files = new Map<string, Buffer>();
  /** Every folder, ending in `/` (the ancestors of each file are added automatically). */
  readonly folders = new Set<string>();
  readonly modified = new Map<string, Date>();
  readonly properties = new Map<number, PropertyValue>();
  /** Every request message ID received, in order. */
  readonly requests: number[] = [];
  /** Every file opened for reading, in order. */
  readonly reads: string[] = [];
  /** Every loop engine command received, in order. */
  readonly commands: number[] = [];
  /** When true the pedal stops answering (simulates a desynced or hung pedal). */
  silent = false;
  /** Milliseconds to wait before answering, by request ID (a busy pedal). */
  readonly replyDelay = new Map<number, number>();
  /** Request IDs that get a FailureResponse with this message. */
  readonly failures = new Map<number, string>();
  readonly openFiles = new Map<bigint, OpenFile>();

  readonly #parser = new FrameParser();
  readonly #chunkSize: number;
  #dataListeners: Array<(chunk: Buffer) => void> = [];
  #closeListeners: Array<(error?: Error) => void> = [];
  #nextHandle = 100n;
  #closed = false;

  constructor(options: FakePedalOptions = {}) {
    this.#chunkSize = options.chunkSize ?? Infinity;
    for (const [path, content] of Object.entries(options.files ?? {})) {
      this.setFile(path, content);
    }
    const sd = options.sdPresent ?? true;
    this.properties.set(PropertyID.FamilyID, 93);
    this.properties.set(PropertyID.DeviceID, 3);
    this.properties.set(PropertyID.RemovableMediaIsPresent, sd ? 1 : 0);
    this.properties.set(PropertyID.KilobytesCapacityOnNand, 516608);
    this.properties.set(PropertyID.KilobytesAvailableOnNand, 415096);
    this.properties.set(PropertyID.KilobytesCapacityOnSd, sd ? 31154688 : 0);
    this.properties.set(PropertyID.KilobytesAvailableOnSd, sd ? 26653376 : 0);
    this.properties.set(PropertyID.Name, 'JamMan Stereo');
    this.properties.set(PropertyID.InternalPatchFolderPath, FAKE_INTERNAL_ROOT);
    this.properties.set(PropertyID.RemovablePatchFolderPath, FAKE_SD_ROOT);
    this.properties.set(PropertyID.CurrentBankAndPatch, 1); // internal Patch01
    this.properties.set(PropertyID.DiskState, 0);
    this.properties.set(PropertyID.AudioIsDirty, 0);
    this.properties.set(PropertyID.SettingsAreDirty, 0);
    this.properties.set(PropertyID.LeftButtonCommand, 'UndoRedo');
    this.properties.set(PropertyID.MiddleButtonCommand, 'Reverse');
    this.properties.set(PropertyID.RightButtonCommand, 'Tempo');
    this.properties.set(PropertyID.QueueCurrentBehavior, 'RevertToSaved');
    this.properties.set(PropertyID.QueueEmptyBehavior, 'TransitionIfStopped');
  }

  setFile(path: string, content: Buffer | string, modified = new Date(Date.UTC(2024, 0, 1))) {
    this.files.set(path, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
    this.modified.set(path, modified);
    this.#addAncestors(path);
  }

  #addAncestors(path: string) {
    for (let parent = parentOf(path); parent.length > 1; parent = parentOf(parent)) {
      this.folders.add(parent);
    }
  }

  folderExists(path: string): boolean {
    return this.folders.has(asFolder(path));
  }

  /** Every file and folder path under `folder`, sorted. */
  tree(folder: string): string[] {
    const prefix = asFolder(folder);
    return [...this.files.keys(), ...this.folders]
      .filter(p => p.startsWith(prefix) && p !== prefix)
      .sort();
  }

  readonly transport: GreenglassTransport = {
    write: async data => {
      if (this.#closed) throw new Error('port closed');
      for (const frame of this.#parser.push(data)) {
        this.requests.push(frame.id);
        if (this.silent) continue;
        let reply: Buffer | null;
        try {
          reply = this.#handle(frame.id, new PayloadReader(frame.payload));
        } catch {
          // Like the pedal: an empty WhoAmI (six zero bytes) is answered, and any
          // other malformed request gets a failure when its serial can be read.
          if (frame.id === MessageID.WhoAmIRequest && frame.payload.length === 0) {
            this.#send(encodeFrame(MessageID.WhoAmIResponse, Buffer.alloc(4)));
            continue;
          }
          reply =
            frame.payload.length >= 4
              ? encodeFrame(
                  MessageID.FailureResponse,
                  new PayloadWriter().u32(frame.payload.readUInt32LE(0)).str('Bad request').build(),
                )
              : null;
        }
        if (reply) this.#send(reply, this.replyDelay.get(frame.id) ?? 0);
      }
    },
    close: async () => this.unplug(),
    onData: listener => this.#dataListeners.push(listener),
    onClose: listener => this.#closeListeners.push(listener),
  };

  /** Pushes a PropertyChangedNotification, as the pedal does on its own. */
  notifyProperty(property: number, value: PropertyValue) {
    this.properties.set(property, value);
    const w = new PayloadWriter().u8(0).u16(property);
    if (typeof value === 'number') w.i32(value);
    else w.str(value);
    this.#send(encodeFrame(MessageID.PropertyChangedNotification, w.build()));
  }

  /** The cable is pulled. */
  unplug(error?: Error) {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners) listener(error);
  }

  #send(frame: Buffer, delayMs = 0) {
    const chunks: Buffer[] = [];
    for (let i = 0; i < frame.length; i += Math.min(this.#chunkSize, frame.length)) {
      chunks.push(frame.subarray(i, i + Math.min(this.#chunkSize, frame.length)));
    }
    // Deliver later, like a real port: the client may still be inside write().
    const deliver = () => {
      for (const chunk of chunks) for (const listener of this.#dataListeners) listener(chunk);
    };
    if (delayMs > 0) setTimeout(deliver, delayMs);
    else setImmediate(deliver);
  }

  #folderContents(path: string) {
    const prefix = asFolder(path);
    const files: string[] = [];
    const folders: string[] = [];
    for (const file of this.files.keys()) {
      if (parentOf(file) === prefix) files.push(file.slice(prefix.length));
    }
    for (const folder of this.folders) {
      if (folder !== prefix && parentOf(folder) === prefix) {
        folders.push(folder.slice(prefix.length, -1));
      }
    }
    return { files, folders, exists: this.folders.has(prefix) };
  }

  #removeUnder(folder: string) {
    const prefix = asFolder(folder);
    for (const file of [...this.files.keys()]) if (file.startsWith(prefix)) this.files.delete(file);
    for (const f of [...this.folders]) if (f.startsWith(prefix)) this.folders.delete(f);
  }

  #copyFolder(source: string, target: string) {
    const from = asFolder(source);
    const to = asFolder(target);
    for (const f of [...this.folders]) {
      if (f.startsWith(from)) this.folders.add(to + f.slice(from.length));
    }
    for (const [file, data] of [...this.files]) {
      if (file.startsWith(from)) this.setFile(to + file.slice(from.length), Buffer.from(data));
    }
  }

  #handle(id: number, r: PayloadReader): Buffer | null {
    const serial = r.u32();
    const ok = () =>
      encodeFrame(MessageID.SuccessResponse, new PayloadWriter().u32(serial).build());
    const fail = (message: string) =>
      encodeFrame(MessageID.FailureResponse, new PayloadWriter().u32(serial).str(message).build());

    const injected = this.failures.get(id);
    if (injected) return fail(injected);

    switch (id) {
      case MessageID.WhoAmIRequest:
        return encodeFrame(
          MessageID.WhoAmIResponse,
          new PayloadWriter()
            .u32(serial)
            .u16(93)
            .u16(3)
            .u16(1)
            .u16(0x1300)
            .str('2cacee6c-1dd2-11b2-a18c-23e3633e8a1e')
            .str('JamMan Stereo')
            .build(),
        );
      case MessageID.GetPropertiesRequest: {
        const ints = [...this.properties].filter(([, v]) => typeof v === 'number');
        const strs = [...this.properties].filter(([, v]) => typeof v === 'string');
        const w = new PayloadWriter().u32(serial).u16(ints.length);
        for (const [k, v] of ints) w.u16(k).i32(v as number);
        w.u16(strs.length);
        for (const [k, v] of strs) w.u16(k).str(v as string);
        return encodeFrame(MessageID.GetPropertiesResponse, w.build());
      }
      case MessageID.GetPropertyRequest: {
        for (let n = r.u8(); n > 0; n--) r.u16();
        const id = r.u16();
        const value = this.properties.get(id);
        if (value === undefined) return fail('Unknown property');
        const w = new PayloadWriter().u32(serial).u16(id);
        if (typeof value === 'number') w.i32(value);
        else w.str(value);
        return encodeFrame(MessageID.GetPropertyResponse, w.build());
      }
      case MessageID.SetPropertyRequest: {
        for (let n = r.u8(); n > 0; n--) r.u16();
        const id = r.u16();
        this.properties.set(id, id <= 17 ? r.i32() : r.str());
        return ok();
      }
      case MessageID.IssueCommandRequest: {
        this.commands.push(r.u16());
        return ok();
      }
      case MessageID.FolderContentsRequest: {
        const contents = this.#folderContents(r.str());
        if (!contents.exists) return fail('No such file or directory');
        const w = new PayloadWriter().u32(serial).i32(contents.files.length);
        for (const f of contents.files) w.str(f);
        w.i32(contents.folders.length);
        for (const f of contents.folders) w.str(f);
        return encodeFrame(MessageID.FolderContentsResponse, w.build());
      }
      case MessageID.FileSystemEntryInfoRequest: {
        const isFolder = r.bool();
        const path = r.str();
        const file = this.files.get(path);
        const date = this.modified.get(path) ?? new Date(0);
        const w = new PayloadWriter()
          .u32(serial)
          .bool(isFolder)
          .str(path)
          .bool(isFolder ? this.folderExists(path) : !!file)
          .i64(BigInt(file?.length ?? 0))
          .bool(false)
          .bool(false);
        for (let i = 0; i < 3; i++) {
          w.u16(date.getUTCFullYear())
            .u8(date.getUTCMonth())
            .u8(date.getUTCDate())
            .u8(date.getUTCHours())
            .u8(date.getUTCMinutes());
        }
        return encodeFrame(MessageID.FileSystemEntryInfoResponse, w.build());
      }
      case MessageID.FileOpenRequest: {
        const path = r.str();
        const access = r.u8();
        const mode = r.u8();
        if (access === 2 && mode === 0) {
          if (!this.folderExists(parentOf(path))) return fail('No such file or directory');
          this.setFile(path, Buffer.alloc(0));
        }
        const file = this.files.get(path);
        if (!file) return fail('No such file or directory');
        if (access !== 2) this.reads.push(path);
        const handle = this.#nextHandle++;
        this.openFiles.set(handle, { path, position: 0, write: access === 2 });
        return encodeFrame(
          MessageID.FileOpenResponse,
          new PayloadWriter().u32(serial).i64(handle).i64(BigInt(file.length)).build(),
        );
      }
      case MessageID.FileReadRequest: {
        const handle = r.i64();
        const count = r.i32();
        const open = this.openFiles.get(handle);
        if (!open) return fail('Bad file handle');
        const data = this.files.get(open.path)!.subarray(open.position, open.position + count);
        open.position += data.length;
        return encodeFrame(
          MessageID.FileReadResponse,
          new PayloadWriter().u32(serial).i64(handle).i32(data.length).bytes(data).build(),
        );
      }
      case MessageID.FileWriteRequest: {
        const handle = r.i64();
        const data = r.bytes(r.i32());
        const open = this.openFiles.get(handle);
        if (!open?.write) return fail('Bad file handle');
        const current = this.files.get(open.path)!;
        this.files.set(open.path, Buffer.concat([current.subarray(0, open.position), data]));
        open.position += data.length;
        return ok();
      }
      case MessageID.FileSystemEntryCreateRequest: {
        r.bool(); // is folder: only folders are created this way
        const path = asFolder(r.str());
        const overwrite = r.bool();
        if (this.folders.has(path) && !overwrite) return fail('The folder already exists.');
        if (!this.folderExists(parentOf(path))) return fail('The parent folder does not exist.');
        this.folders.add(path);
        return ok();
      }
      case MessageID.FileSystemEntryDeleteRequest: {
        const isFolder = r.bool();
        const path = r.str();
        const recursive = r.bool();
        if (!isFolder) {
          if (!this.files.delete(path)) return fail('The file does not exist.');
          return ok();
        }
        if (!this.folderExists(path)) return fail('The folder does not exist.');
        if (!recursive && this.tree(path).length > 0) return fail('The folder is not empty.');
        this.#removeUnder(path);
        return ok();
      }
      case MessageID.FileSystemEntryMoveRequest: {
        const isFolder = r.bool();
        const source = r.str();
        const target = r.str();
        const keepOriginal = r.bool();
        const overwrite = r.bool();
        if (!isFolder) {
          const data = this.files.get(source);
          if (!data) return fail('The file or folder does not exist.');
          if (this.files.has(target) && !overwrite) return fail('The file already exists.');
          if (!this.folderExists(parentOf(target))) return fail('The file could not be moved.');
          this.setFile(target, data, this.modified.get(source));
          if (!keepOriginal) this.files.delete(source);
          return ok();
        }
        if (!this.folderExists(source)) return fail('The file or folder does not exist.');
        // Like the real pedal: a folder that contains folders cannot be moved, only copied.
        const hasSubfolders = this.#folderContents(source).folders.length > 0;
        if (!keepOriginal && hasSubfolders) return fail('The folder could not be copied.');
        if (this.folderExists(target) && !overwrite) return fail('The folder already exists.');
        this.#copyFolder(source, target);
        if (!keepOriginal) this.#removeUnder(source);
        return ok();
      }
      case MessageID.FileSeekRequest: {
        const open = this.openFiles.get(r.i64());
        if (!open) return fail('Bad file handle');
        open.position = Number(r.i64());
        return ok();
      }
      case MessageID.FileCloseRequest: {
        if (!this.openFiles.delete(r.i64())) return fail('Bad file handle');
        return ok();
      }
      default:
        return fail(`Unsupported request ${id}`);
    }
  }
}
