import { describe, expect, it } from 'vitest';
import { FAKE_INTERNAL_ROOT, FAKE_SD_ROOT, FakePedal } from '../test-utils/fakePedal.js';
import { GreenglassClient } from './GreenglassClient.js';
import { MessageID } from './greenglassCodec.js';
import {
  createWriteGuard,
  PedalFiles,
  PedalPathNotAllowedError,
  workRootFor,
} from './PedalFiles.js';

const guard = createWriteGuard([FAKE_INTERNAL_ROOT, FAKE_SD_ROOT]);

function setup() {
  const pedal = new FakePedal({
    files: {
      [`${FAKE_SD_ROOT}Patch01/patch.xml`]: '<p/>',
      [`${FAKE_SD_ROOT}Patch01/PhraseA/phrase.xml`]: '<a/>',
      [`${FAKE_SD_ROOT}Patch01/PhraseA/phrase.wav`]: Buffer.alloc(20_000, 7),
      [`${FAKE_SD_ROOT}Patch01/PhraseB/phrase.wav`]: Buffer.alloc(10, 8),
      '/mnt/sdfs/.jamman-manager/keep.txt': 'x',
    },
  });
  const client = new GreenglassClient(pedal.transport, { requestTimeoutMs: 500 });
  return { pedal, client, files: new PedalFiles(client, guard) };
}

describe('write guard', () => {
  it('derives the work area next to the bank folder', () => {
    expect(workRootFor('/mnt/sdfs/JamManStereo/')).toBe('/mnt/sdfs/.jamman-manager/');
    expect(workRootFor('/mnt/nandfs/JamManStereo')).toBe('/mnt/nandfs/.jamman-manager/');
  });

  it.each([
    `${FAKE_SD_ROOT}Patch01/`,
    `${FAKE_SD_ROOT}Patch01/patch.xml.tmp`,
    `${FAKE_INTERNAL_ROOT}Patch99/PhraseA/phrase.xml`,
    '/mnt/sdfs/.jamman-manager/undo/pedal-1/Patch01/',
    '/mnt/nandfs/.jamman-manager/reorder/',
    '/mnt/sdfs/.jamman-manager/',
  ])('allows %s', path => {
    expect(() => guard(path)).not.toThrow();
  });

  it.each([
    '/mnt/nandfs/usr/app',
    '/mnt/nandfs/jamStereo.xml',
    '/mnt/nandfs/boot/',
    FAKE_SD_ROOT,
    `${FAKE_SD_ROOT}Backup/`,
    `${FAKE_SD_ROOT}Patch1/`,
    `${FAKE_SD_ROOT}Patch01/../../usr/`,
    `${FAKE_SD_ROOT}Patch01//x`,
    '/mnt/sdfs/.jamman-manager/../JamManStereo/x',
    'mnt/sdfs/JamManStereo/Patch01/',
  ])('refuses %s', path => {
    expect(() => guard(path)).toThrow(PedalPathNotAllowedError);
  });
});

describe('PedalFiles', () => {
  it('moves a folder with sub-folders by moving its files', async () => {
    const { pedal, files } = setup();
    await files.ensureFolder('/mnt/sdfs/.jamman-manager/undo/');
    await files.moveTree(`${FAKE_SD_ROOT}Patch01/`, '/mnt/sdfs/.jamman-manager/undo/Patch01/');

    expect(pedal.folderExists(`${FAKE_SD_ROOT}Patch01/`)).toBe(false);
    expect(pedal.tree('/mnt/sdfs/.jamman-manager/undo/Patch01/')).toEqual([
      '/mnt/sdfs/.jamman-manager/undo/Patch01/PhraseA/',
      '/mnt/sdfs/.jamman-manager/undo/Patch01/PhraseA/phrase.wav',
      '/mnt/sdfs/.jamman-manager/undo/Patch01/PhraseA/phrase.xml',
      '/mnt/sdfs/.jamman-manager/undo/Patch01/PhraseB/',
      '/mnt/sdfs/.jamman-manager/undo/Patch01/PhraseB/phrase.wav',
      '/mnt/sdfs/.jamman-manager/undo/Patch01/patch.xml',
    ]);
    // No audio crossed the cable: no file was read or written.
    expect(pedal.requests).not.toContain(MessageID.FileReadRequest);
    expect(pedal.requests).not.toContain(MessageID.FileWriteRequest);
  });

  it('refuses to move onto an existing folder', async () => {
    const { pedal, files } = setup();
    pedal.folders.add(`${FAKE_SD_ROOT}Patch02/`);
    await expect(
      files.moveTree(`${FAKE_SD_ROOT}Patch01/`, `${FAKE_SD_ROOT}Patch02/`),
    ).rejects.toThrow(/already exists/);
    expect(pedal.files.has(`${FAKE_SD_ROOT}Patch01/patch.xml`)).toBe(true);
  });

  it('puts the files back when a move fails half way', async () => {
    const { pedal, files } = setup();
    let moves = 0;
    const realWrite = pedal.transport.write;
    pedal.transport.write = async data => {
      if (data.readUInt16LE(0) === MessageID.FileSystemEntryMoveRequest && ++moves === 3) {
        pedal.failures.set(MessageID.FileSystemEntryMoveRequest, 'disk full');
      }
      await realWrite(data);
      pedal.failures.delete(MessageID.FileSystemEntryMoveRequest);
    };
    await expect(
      files.moveTree(`${FAKE_SD_ROOT}Patch01/`, `${FAKE_SD_ROOT}Patch05/`),
    ).rejects.toThrow('disk full');
    expect(pedal.files.has(`${FAKE_SD_ROOT}Patch01/PhraseA/phrase.wav`)).toBe(true);
    expect(pedal.files.has(`${FAKE_SD_ROOT}Patch01/patch.xml`)).toBe(true);
    expect(pedal.folderExists(`${FAKE_SD_ROOT}Patch05/`)).toBe(false);
  });

  it('writes through a temporary file', async () => {
    const { pedal, files } = setup();
    await files.writeFileAtomic(`${FAKE_SD_ROOT}Patch01/patch.xml`, Buffer.from('<new/>'));
    expect(pedal.files.get(`${FAKE_SD_ROOT}Patch01/patch.xml`)?.toString()).toBe('<new/>');
    expect(pedal.files.has(`${FAKE_SD_ROOT}Patch01/patch.xml.tmp`)).toBe(false);
  });

  it('checks the guard before sending anything', async () => {
    const { pedal, files } = setup();
    await expect(files.removeTree('/mnt/nandfs/usr/')).rejects.toBeInstanceOf(
      PedalPathNotAllowedError,
    );
    await expect(
      files.writeFileAtomic('/mnt/nandfs/jamStereo.xml', Buffer.from('x')),
    ).rejects.toBeInstanceOf(PedalPathNotAllowedError);
    expect(pedal.requests).toEqual([]);
  });
});
