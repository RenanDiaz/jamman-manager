import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PatchRestore, PatchRestoreError } from './PatchRestore';

let tmp: string;
let base: string;
let snaps: string;
let restore: PatchRestore;

const write = (rel: string, content: string | Buffer) => {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const read = (rel: string) => fs.readFileSync(path.join(base, rel));
const exists = (rel: string) => fs.existsSync(path.join(base, rel));

/** A patch with two phrases, each with xml + binary audio */
const makePatch = (dir: string, tag: string) => {
  write(`${dir}/patch.xml`, `<patch>${tag}</patch>`);
  write(`${dir}/PhraseA/phrase.xml`, `<phrase>A-${tag}</phrase>`);
  write(`${dir}/PhraseA/phrase.wav`, Buffer.from([0, 1, 2, 3, tag.length]));
  write(`${dir}/PhraseB/phrase.xml`, `<phrase>B-${tag}</phrase>`);
  write(`${dir}/PhraseB/phrase.wav`, Buffer.from([9, 8, 7, tag.length]));
};

const patchDirsOnDisk = () =>
  fs
    .readdirSync(base)
    .filter(d => /^Patch\d{2}$/.test(d))
    .sort();

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-restore-'));
  base = path.join(tmp, 'sd');
  snaps = path.join(tmp, 'snapshots');
  fs.mkdirSync(base);
  restore = new PatchRestore({ snapshotRoot: snaps });
  makePatch('Patch01', 'one');
  makePatch('Patch02', 'two');
  makePatch('Patch03', 'three');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('PatchRestore.createSnapshot', () => {
  it('copies the patch with phrases and audio outside the JamMan folder', async () => {
    const info = await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch02'] });
    expect(info.patches).toEqual(['Patch02']);
    expect(info.sizeBytes).toBeGreaterThan(0);
    const copied = path.join(snaps, info.id, 'data', 'Patch02', 'PhraseA', 'phrase.wav');
    expect(fs.existsSync(copied)).toBe(true);
    expect(fs.readdirSync(base).some(d => d.includes('snapshot'))).toBe(false);
  });

  it('rejects invalid directory names (no path traversal)', async () => {
    await expect(
      restore.createSnapshot(base, { kind: 'patches', patches: ['../etc'] }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects missing patches and empty lists', async () => {
    await expect(
      restore.createSnapshot(base, { kind: 'patches', patches: ['Patch09'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      restore.createSnapshot(base, { kind: 'patches', patches: [] }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('refuses snapshots over the size limit and leaves nothing behind', async () => {
    const small = new PatchRestore({ snapshotRoot: snaps, maxSnapshotBytes: 10 });
    await expect(small.createSnapshot(base, { kind: 'all' })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    expect(fs.existsSync(snaps) ? fs.readdirSync(snaps) : []).toEqual([]);
  });

  it('rejects relative or missing folders', async () => {
    await expect(restore.createSnapshot('relative/path', { kind: 'all' })).rejects.toBeInstanceOf(
      PatchRestoreError,
    );
    await expect(
      restore.createSnapshot(path.join(tmp, 'nope'), { kind: 'all' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PatchRestore.restoreSnapshot (add) - undo of delete', () => {
  it('brings a deleted patch back with its phrases and audio, byte for byte', async () => {
    const original = read('Patch02/PhraseA/phrase.wav');
    const info = await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch02'] });
    fs.rmSync(path.join(base, 'Patch02'), { recursive: true });

    const result = await restore.restoreSnapshot(info.id, base, 'add');

    expect(result.restored).toEqual(['Patch02']);
    expect(read('Patch02/patch.xml').toString()).toBe('<patch>two</patch>');
    expect(read('Patch02/PhraseA/phrase.wav').equals(original)).toBe(true);
    expect(read('Patch02/PhraseB/phrase.xml').toString()).toBe('<phrase>B-two</phrase>');
  });

  it('restores several patches of a batch delete', async () => {
    const info = await restore.createSnapshot(base, {
      kind: 'patches',
      patches: ['Patch01', 'Patch03'],
    });
    fs.rmSync(path.join(base, 'Patch01'), { recursive: true });
    fs.rmSync(path.join(base, 'Patch03'), { recursive: true });

    await restore.restoreSnapshot(info.id, base, 'add');

    expect(patchDirsOnDisk()).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(read('Patch03/PhraseB/phrase.wav').length).toBe(4);
  });

  it('can be restored more than once (undo, redo-delete, undo again)', async () => {
    const info = await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch01'] });
    for (let i = 0; i < 2; i++) {
      fs.rmSync(path.join(base, 'Patch01'), { recursive: true });
      await restore.restoreSnapshot(info.id, base, 'add');
      expect(exists('Patch01/PhraseA/phrase.wav')).toBe(true);
    }
  });

  it('fails without touching anything when a slot was taken in the meantime', async () => {
    const info = await restore.createSnapshot(base, {
      kind: 'patches',
      patches: ['Patch01', 'Patch03'],
    });
    fs.rmSync(path.join(base, 'Patch01'), { recursive: true });
    fs.rmSync(path.join(base, 'Patch03'), { recursive: true });
    makePatch('Patch03', 'new-occupant');

    await expect(restore.restoreSnapshot(info.id, base, 'add')).rejects.toMatchObject({
      code: 'SLOT_OCCUPIED',
    });

    expect(exists('Patch01')).toBe(false); // not partially restored
    expect(read('Patch03/patch.xml').toString()).toBe('<patch>new-occupant</patch>');
  });

  it('leaves no staging directories behind', async () => {
    const info = await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch02'] });
    fs.rmSync(path.join(base, 'Patch02'), { recursive: true });
    await restore.restoreSnapshot(info.id, base, 'add');
    expect(fs.readdirSync(base).filter(d => d.startsWith('__'))).toEqual([]);
  });
});

describe('PatchRestore.restoreSnapshot (replace) - undo of edit', () => {
  it('reverts an edited patch, including overwritten audio and removed phrases', async () => {
    const before = await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch02'] });
    const originalWav = read('Patch02/PhraseA/phrase.wav');

    // Simulate an edit: new xml, overwritten wav, phrase B removed, phrase C added
    write('Patch02/patch.xml', '<patch>edited</patch>');
    write('Patch02/PhraseA/phrase.wav', Buffer.from([42]));
    fs.rmSync(path.join(base, 'Patch02/PhraseB'), { recursive: true });
    write('Patch02/PhraseC/phrase.xml', '<phrase>C</phrase>');
    const after = await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch02'] });

    await restore.restoreSnapshot(before.id, base, 'replace'); // undo
    expect(read('Patch02/patch.xml').toString()).toBe('<patch>two</patch>');
    expect(read('Patch02/PhraseA/phrase.wav').equals(originalWav)).toBe(true);
    expect(exists('Patch02/PhraseB/phrase.wav')).toBe(true);
    expect(exists('Patch02/PhraseC')).toBe(false);

    await restore.restoreSnapshot(after.id, base, 'replace'); // redo
    expect(read('Patch02/patch.xml').toString()).toBe('<patch>edited</patch>');
    expect(read('Patch02/PhraseA/phrase.wav')[0]).toBe(42);
    expect(exists('Patch02/PhraseB')).toBe(false);
    expect(exists('Patch02/PhraseC/phrase.xml')).toBe(true);
    expect(fs.readdirSync(base).filter(d => d.startsWith('__'))).toEqual([]);
  });

  it('does not touch other patches', async () => {
    const info = await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch02'] });
    write('Patch01/patch.xml', '<patch>changed-later</patch>');
    await restore.restoreSnapshot(info.id, base, 'replace');
    expect(read('Patch01/patch.xml').toString()).toBe('<patch>changed-later</patch>');
  });
});

describe('PatchRestore.restoreSnapshot (replace, all) - undo of backup restore', () => {
  it('reverts a replace-mode restore: removes new patches, brings back old ones and playlists', async () => {
    write('.jamman-playlists.json', '{"playlists":["before"]}');
    const before = await restore.createSnapshot(base, { kind: 'all' });
    expect(before.patches).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(before.hasPlaylists).toBe(true);

    // Simulate "replace" restore from a backup with different content
    for (const d of patchDirsOnDisk()) fs.rmSync(path.join(base, d), { recursive: true });
    makePatch('Patch01', 'from-backup');
    makePatch('Patch07', 'from-backup-7');
    write('.jamman-playlists.json', '{"playlists":["after"]}');
    const after = await restore.createSnapshot(base, { kind: 'all' });

    const undone = await restore.restoreSnapshot(before.id, base, 'replace');
    expect(undone.removed).toEqual(['Patch07']);
    expect(patchDirsOnDisk()).toEqual(['Patch01', 'Patch02', 'Patch03']);
    expect(read('Patch01/patch.xml').toString()).toBe('<patch>one</patch>');
    expect(read('Patch03/PhraseA/phrase.wav').length).toBe(5);
    expect(read('.jamman-playlists.json').toString()).toBe('{"playlists":["before"]}');

    await restore.restoreSnapshot(after.id, base, 'replace'); // redo
    expect(patchDirsOnDisk()).toEqual(['Patch01', 'Patch07']);
    expect(read('Patch01/patch.xml').toString()).toBe('<patch>from-backup</patch>');
    expect(read('.jamman-playlists.json').toString()).toBe('{"playlists":["after"]}');
    expect(fs.readdirSync(base).filter(d => d.startsWith('__'))).toEqual([]);
  });

  it('removes a playlists file that did not exist at snapshot time', async () => {
    const before = await restore.createSnapshot(base, { kind: 'all' });
    expect(before.hasPlaylists).toBe(false);
    write('.jamman-playlists.json', '{"playlists":["new"]}');
    await restore.restoreSnapshot(before.id, base, 'replace');
    expect(exists('.jamman-playlists.json')).toBe(false);
  });

  it('merge-mode restore (new patches added) is undone by removing only those', async () => {
    const before = await restore.createSnapshot(base, { kind: 'all' });
    makePatch('Patch04', 'merged-in');
    await restore.restoreSnapshot(before.id, base, 'replace');
    expect(patchDirsOnDisk()).toEqual(['Patch01', 'Patch02', 'Patch03']);
  });
});

describe('PatchRestore safety and lifecycle', () => {
  it('refuses to restore into a different folder', async () => {
    const info = await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch01'] });
    const other = path.join(tmp, 'other');
    fs.mkdirSync(other);
    await expect(restore.restoreSnapshot(info.id, other, 'add')).rejects.toMatchObject({
      code: 'WRONG_FOLDER',
    });
  });

  it('rejects malformed snapshot ids and unknown snapshots', async () => {
    await expect(restore.restoreSnapshot('../..', base, 'add')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(
      restore.restoreSnapshot('00000000-0000-4000-8000-000000000000', base, 'add'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(restore.discardSnapshot('../..')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('discardSnapshot removes the data and makes restore fail with NOT_FOUND', async () => {
    const info = await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch01'] });
    await restore.discardSnapshot(info.id);
    expect(fs.existsSync(path.join(snaps, info.id))).toBe(false);
    await expect(restore.restoreSnapshot(info.id, base, 'add')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(restore.discardSnapshot(info.id)).resolves.toBeUndefined();
  });

  it('purgeAll removes every snapshot', async () => {
    await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch01'] });
    await restore.createSnapshot(base, { kind: 'patches', patches: ['Patch02'] });
    await restore.purgeAll();
    expect(fs.readdirSync(snaps)).toEqual([]);
  });

  it('runs restore under the injected lock keyed by the folder', async () => {
    const keys: string[] = [];
    const locked = new PatchRestore({
      snapshotRoot: snaps,
      withLock: async (key, fn) => {
        keys.push(key);
        return fn();
      },
    });
    const info = await locked.createSnapshot(base, { kind: 'patches', patches: ['Patch01'] });
    fs.rmSync(path.join(base, 'Patch01'), { recursive: true });
    await locked.restoreSnapshot(info.id, base, 'add');
    expect(keys).toEqual([base]);
  });
});
