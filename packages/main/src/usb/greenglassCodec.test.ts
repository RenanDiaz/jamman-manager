import { describe, expect, it } from 'vitest';
import {
  decodeEntryInfo,
  decodeFolderContents,
  decodeProperties,
  decodePropertyChanged,
  decodeWhoAmI,
  encodeFrame,
  encodeRequest,
  formatBcdVersion,
  FrameParser,
  isNotification,
  MAX_PAYLOAD_SIZE,
  MessageID,
  PayloadReader,
  PayloadWriter,
  PropertyID,
} from './greenglassCodec.js';

/** The four frames a real JamMan Stereo sent on its own when the port was opened. */
const GREETING = Buffer.from(
  '068007000000000f0063000100' +
    '068007000000000e0001000000' +
    '068007000000000f0001000000' +
    '068007000000000e0000000000',
  'hex',
);

describe('encoding', () => {
  it('encodes a request with its serial first', () => {
    const frame = encodeRequest(MessageID.WhoAmIRequest, 7);
    expect(frame.toString('hex')).toBe('00000400000007000000');
  });

  it('counts string lengths in bytes, not characters', () => {
    const payload = new PayloadWriter().str('canción ñ').build();
    expect(payload.readInt32LE(0)).toBe(Buffer.byteLength('canción ñ'));
    expect(new PayloadReader(payload).str()).toBe('canción ñ');
  });

  it('refuses payloads larger than the pedal accepts', () => {
    expect(() => encodeFrame(14, Buffer.alloc(MAX_PAYLOAD_SIZE + 1))).toThrow(/exceeds/);
    expect(() => encodeFrame(14, Buffer.alloc(MAX_PAYLOAD_SIZE))).not.toThrow();
  });

  it('round-trips every field type', () => {
    const payload = new PayloadWriter()
      .u8(255)
      .bool(true)
      .u16(65535)
      .u32(4294967295)
      .i32(-2)
      .i64(-3n)
      .bytes(Buffer.from([1, 2]))
      .build();
    const r = new PayloadReader(payload);
    expect([r.u8(), r.bool(), r.u16(), r.u32(), r.i32(), r.i64(), r.bytes(2)]).toEqual([
      255,
      true,
      65535,
      4294967295,
      -2,
      -3n,
      Buffer.from([1, 2]),
    ]);
    expect(r.remaining).toBe(0);
  });

  it('throws instead of reading past the end', () => {
    expect(() => new PayloadReader(Buffer.from([1, 2])).u32()).toThrow(/Truncated/);
  });
});

describe('FrameParser', () => {
  it('splits the real greeting into its four notifications', () => {
    const frames = new FrameParser().push(GREETING);
    expect(frames.map(f => f.id)).toEqual([0x8006, 0x8006, 0x8006, 0x8006]);
    expect(frames.every(f => isNotification(f.id))).toBe(true);
    expect(frames.map(f => decodePropertyChanged(new PayloadReader(f.payload)))).toEqual([
      { property: PropertyID.CurrentBankAndPatch, value: 0x00010063 },
      { property: PropertyID.DiskState, value: 1 },
      { property: PropertyID.CurrentBankAndPatch, value: 1 },
      { property: PropertyID.DiskState, value: 0 },
    ]);
  });

  it('reassembles frames delivered one byte at a time', () => {
    const parser = new FrameParser();
    const frames = [...GREETING].flatMap(byte => parser.push(Buffer.from([byte])));
    expect(frames).toHaveLength(4);
  });

  it('keeps a partial frame until the rest arrives', () => {
    const parser = new FrameParser();
    expect(parser.push(GREETING.subarray(0, 10))).toEqual([]);
    expect(parser.push(GREETING.subarray(10, 13))).toHaveLength(1);
  });

  it('rejects a header whose length cannot be valid', () => {
    const parser = new FrameParser();
    expect(() => parser.push(Buffer.from('0100ffffffff', 'hex'))).toThrow(/Corrupt/);
    // The buffer is dropped, so a valid frame afterwards parses.
    expect(parser.push(encodeRequest(1, 1))).toHaveLength(1);
  });
});

describe('decoders', () => {
  it('decodes WhoAmI as the real pedal answers it', () => {
    const payload = new PayloadWriter()
      .u16(93)
      .u16(3)
      .u16(1)
      .u16(0x1300)
      .str('2cacee6c-1dd2-11b2-a18c-23e3633e8a1e')
      .str('JamMan Stereo')
      .build();
    expect(decodeWhoAmI(new PayloadReader(payload))).toEqual({
      familyId: 93,
      productId: 3,
      softwareVersion: 0x1300,
      guid: '2cacee6c-1dd2-11b2-a18c-23e3633e8a1e',
      name: 'JamMan Stereo',
    });
    expect(formatBcdVersion(0x1300)).toBe('1.3.0.0');
  });

  it('decodes integer and string properties', () => {
    const payload = new PayloadWriter()
      .u16(1)
      .u16(PropertyID.SampleRate)
      .i32(44100)
      .u16(1)
      .u16(PropertyID.InternalPatchFolderPath)
      .str('/mnt/nandfs/JamManStereo/')
      .build();
    expect(decodeProperties(new PayloadReader(payload))).toEqual(
      new Map<number, number | string>([
        [PropertyID.SampleRate, 44100],
        [PropertyID.InternalPatchFolderPath, '/mnt/nandfs/JamManStereo/'],
      ]),
    );
  });

  it('decodes folder contents', () => {
    const payload = new PayloadWriter().i32(1).str('patch.xml').i32(1).str('PhraseA').build();
    expect(decodeFolderContents(new PayloadReader(payload))).toEqual({
      files: ['patch.xml'],
      folders: ['PhraseA'],
    });
  });

  it('decodes entry info with a 0-based month', () => {
    const w = new PayloadWriter().bool(false).str('/a.wav').bool(true).i64(1693484n);
    w.bool(false).bool(false);
    for (let i = 0; i < 3; i++) w.u16(2010).u8(2).u8(12).u8(23).u8(37);
    const info = decodeEntryInfo(new PayloadReader(w.build()));
    expect(info).toMatchObject({ isFolder: false, path: '/a.wav', exists: true, size: 1693484 });
    expect(info.modified.toISOString()).toBe('2010-03-12T23:37:00.000Z');
  });
});
