/**
 * Wire format of Greenglass, the protocol the JamMan Stereo speaks over its
 * USB serial port (CDC-ACM). Pure functions: no I/O.
 *
 * Every message is `<u16 msgID><u32 payloadLength><payload>`, little endian.
 * Request payloads start with a `u32` serial number that the response echoes;
 * notifications (`msgID >= 0x8000`) carry none. Strings are `<i32 byteLength><utf8>`.
 *
 * See docs/usb-protocol.md.
 *
 * @module usb/greenglassCodec
 */

export const HEADER_SIZE = 6;
/** Largest payload the pedal accepts. */
export const MAX_PAYLOAD_SIZE = 8178;
/** Largest `count` of one FileReadRequest (MAX_PAYLOAD_SIZE minus the response fields). */
export const MAX_READ_CHUNK = 8162;
/** Largest data block of one FileWriteRequest. */
export const MAX_WRITE_CHUNK = 8158;

export const MessageID = {
  WhoAmIRequest: 0,
  WhoAmIResponse: 1,
  SuccessResponse: 2,
  FailureResponse: 3,
  FileSystemEntryInfoRequest: 4,
  FileSystemEntryInfoResponse: 5,
  FileSystemEntryCreateRequest: 7,
  FileSystemEntryMoveRequest: 8,
  FileSystemEntryDeleteRequest: 9,
  FileOpenRequest: 10,
  FileOpenResponse: 11,
  FileReadRequest: 12,
  FileReadResponse: 13,
  FileWriteRequest: 14,
  FileSeekRequest: 15,
  FileCloseRequest: 16,
  FolderContentsRequest: 17,
  FolderContentsResponse: 18,
  GetPropertiesRequest: 19,
  GetPropertiesResponse: 20,
  PropertyChangedNotification: 0x8006,
} as const;

/** Property IDs up to this one hold an `i32`; higher ones hold a string. */
export const LAST_INT_PROPERTY = 17;

export const PropertyID = {
  FamilyID: 1,
  DeviceID: 2,
  ProtocolVersion: 3,
  FirmwareVersion: 4,
  RemovableMediaIsPresent: 5,
  SampleRate: 6,
  ChannelCount: 7,
  BitDepth: 8,
  KilobytesAvailableOnNand: 10,
  KilobytesCapacityOnNand: 11,
  KilobytesAvailableOnSd: 12,
  KilobytesCapacityOnSd: 13,
  DiskState: 14,
  CurrentBankAndPatch: 15,
  AudioIsDirty: 16,
  SettingsAreDirty: 17,
  Name: 32777,
  Guid: 32778,
  InternalPatchFolderPath: 32779,
  RemovablePatchFolderPath: 32780,
} as const;

export const FileAccess = { Read: 1, Write: 2 } as const;
export const FileMode = { CreateOrTruncate: 0, OpenExisting: 1 } as const;
export const SeekOrigin = { Begin: 0, Current: 1, End: 2 } as const;

export type PropertyValue = number | string;

export type Frame = { id: number; payload: Buffer };

// ==================== Encoding ====================

/** Little-endian byte builder. */
export class PayloadWriter {
  readonly #parts: Buffer[] = [];

  u8(value: number): this {
    this.#parts.push(Buffer.from([value & 0xff]));
    return this;
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  u16(value: number): this {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value);
    this.#parts.push(b);
    return this;
  }

  u32(value: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0);
    this.#parts.push(b);
    return this;
  }

  i32(value: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32LE(value);
    this.#parts.push(b);
    return this;
  }

  i64(value: bigint): this {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(value);
    this.#parts.push(b);
    return this;
  }

  /** `<i32 byteLength><utf8>`; the length counts bytes, not characters. */
  str(value: string): this {
    const bytes = Buffer.from(value, 'utf8');
    return this.i32(bytes.length).bytes(bytes);
  }

  bytes(value: Uint8Array): this {
    this.#parts.push(Buffer.from(value));
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.#parts);
  }
}

/** Wraps a payload into a frame: `<u16 id><u32 length><payload>`. */
export function encodeFrame(id: number, payload: Buffer): Buffer {
  if (payload.length > MAX_PAYLOAD_SIZE) {
    throw new Error(`Payload of ${payload.length} bytes exceeds ${MAX_PAYLOAD_SIZE}`);
  }
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(id, 0);
  header.writeUInt32LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

/** A request frame: the serial number goes first in the payload. */
export function encodeRequest(id: number, serial: number, body: Buffer = Buffer.alloc(0)): Buffer {
  return encodeFrame(id, Buffer.concat([new PayloadWriter().u32(serial).build(), body]));
}

// ==================== Decoding ====================

/** Little-endian reader that throws when it runs past the end. */
export class PayloadReader {
  #offset = 0;

  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.#offset;
  }

  #take(n: number): Buffer {
    if (n < 0 || this.#offset + n > this.buf.length) {
      throw new Error(`Truncated Greenglass payload (wanted ${n}, have ${this.remaining})`);
    }
    const out = this.buf.subarray(this.#offset, this.#offset + n);
    this.#offset += n;
    return out;
  }

  u8(): number {
    return this.#take(1).readUInt8(0);
  }
  i8(): number {
    return this.#take(1).readInt8(0);
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u16(): number {
    return this.#take(2).readUInt16LE(0);
  }
  i16(): number {
    return this.#take(2).readInt16LE(0);
  }
  u32(): number {
    return this.#take(4).readUInt32LE(0);
  }
  i32(): number {
    return this.#take(4).readInt32LE(0);
  }
  i64(): bigint {
    return this.#take(8).readBigInt64LE(0);
  }
  str(): string {
    return this.#take(this.i32()).toString('utf8');
  }
  bytes(n: number): Buffer {
    return Buffer.from(this.#take(n));
  }
}

/**
 * Splits a byte stream into frames. Feed it whatever the serial port delivers;
 * it returns every complete frame and keeps the remainder.
 */
export class FrameParser {
  #buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): Frame[] {
    this.#buffer =
      this.#buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.#buffer, chunk]);
    const frames: Frame[] = [];
    while (this.#buffer.length >= HEADER_SIZE) {
      const id = this.#buffer.readUInt16LE(0);
      const length = this.#buffer.readUInt32LE(2);
      if (length > MAX_PAYLOAD_SIZE) {
        // Nothing valid can follow a corrupt header; drop the buffer.
        this.#buffer = Buffer.alloc(0);
        throw new Error(`Corrupt Greenglass frame header (length ${length})`);
      }
      if (this.#buffer.length < HEADER_SIZE + length) {
        break;
      }
      frames.push({
        id,
        payload: Buffer.from(this.#buffer.subarray(HEADER_SIZE, HEADER_SIZE + length)),
      });
      this.#buffer = this.#buffer.subarray(HEADER_SIZE + length);
    }
    return frames;
  }

  reset(): void {
    this.#buffer = Buffer.alloc(0);
  }
}

export function isNotification(id: number): boolean {
  return id >= 0x8000;
}

/** Reads a property value: `i32` up to LAST_INT_PROPERTY, string after. */
export function readPropertyValue(reader: PayloadReader, property: number): PropertyValue {
  return property <= LAST_INT_PROPERTY ? reader.i32() : reader.str();
}

export type WhoAmI = {
  familyId: number;
  productId: number;
  /** BCD, e.g. `0x1300` = 1.3.0.0. */
  softwareVersion: number;
  guid: string;
  name: string;
};

export function decodeWhoAmI(r: PayloadReader): WhoAmI {
  const familyId = r.u16();
  const productId = r.u16();
  r.u16(); // unused
  const softwareVersion = r.u16();
  return { familyId, productId, softwareVersion, guid: r.str(), name: r.str() };
}

export function decodeProperties(r: PayloadReader): Map<number, PropertyValue> {
  const props = new Map<number, PropertyValue>();
  const ints = r.i16();
  for (let i = 0; i < ints; i++) {
    const id = r.u16();
    props.set(id, r.i32());
  }
  const strings = r.i16();
  for (let i = 0; i < strings; i++) {
    const id = r.u16();
    props.set(id, r.str());
  }
  return props;
}

export type FolderContents = { files: string[]; folders: string[] };

export function decodeFolderContents(r: PayloadReader): FolderContents {
  const files = Array.from({ length: r.i32() }, () => r.str());
  const folders = Array.from({ length: r.i32() }, () => r.str());
  return { files, folders };
}

export type EntryInfo = {
  isFolder: boolean;
  path: string;
  exists: boolean;
  size: number;
  modified: Date;
};

function readTimestamp(r: PayloadReader): Date {
  const year = r.i16();
  const month = r.i8();
  const day = r.i8();
  const hour = r.i8();
  const minute = r.i8();
  return new Date(Date.UTC(year, month, day, hour, minute));
}

export function decodeEntryInfo(r: PayloadReader): EntryInfo {
  const isFolder = r.bool();
  const path = r.str();
  const exists = r.bool();
  const size = Number(r.i64());
  r.bool(); // read-only
  r.bool(); // hidden
  readTimestamp(r); // creation
  const modified = readTimestamp(r);
  readTimestamp(r); // last access
  return { isFolder, path, exists, size, modified };
}

export type PropertyChange = { property: number; value: PropertyValue };

export function decodePropertyChanged(r: PayloadReader): PropertyChange {
  const pathLength = r.u8();
  for (let i = 0; i < pathLength; i++) r.u16();
  const property = r.u16();
  return { property, value: readPropertyValue(r, property) };
}

/** `0x1300` → `1.3.0.0`. */
export function formatBcdVersion(bcd: number): string {
  return [12, 8, 4, 0].map(shift => (bcd >> shift) & 0xf).join('.');
}
