import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AccessDeniedError, FolderAccess } from './folderAccess.js';

const silentLog = { info: () => {}, warn: () => {} };

let tmp: string;
let root: string;
let storeFile: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamman-access-')));
  root = path.join(tmp, 'sd');
  fs.mkdirSync(path.join(root, 'Patch01', 'PhraseA'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Patch01', 'PhraseA', 'phrase.wav'), 'wav');
  fs.mkdirSync(path.join(tmp, 'outside'));
  fs.writeFileSync(path.join(tmp, 'outside', 'loop.wav'), 'wav');
  fs.symlinkSync(path.join(tmp, 'outside', 'loop.wav'), path.join(root, 'escape.wav'));
  storeFile = path.join(tmp, 'userData', 'folder-access.json');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const make = () => new FolderAccess({ storeFile, log: silentLog });

describe('FolderAccess', () => {
  it('has no root until the user approves one', () => {
    const access = make();
    access.load();
    expect(access.getRoot()).toBeNull();
    expect(() => access.assertRoot(root)).toThrow(AccessDeniedError);
  });

  it('persists the approved root so it is still valid after a restart', () => {
    make().approveRoot(root);

    const afterRestart = make();
    afterRestart.load();
    expect(afterRestart.getRoot()).toBe(root);
    expect(afterRestart.assertRoot(root)).toBe(root);
    expect(afterRestart.assertRoot(root + '/')).toBe(root);
  });

  it('rejects any other folder sent by the renderer', () => {
    const access = make();
    access.approveRoot(root);
    expect(() => access.assertRoot(tmp)).toThrow(AccessDeniedError);
    expect(() => access.assertRoot(path.join(root, 'Patch01'))).toThrow(AccessDeniedError);
    expect(() => access.assertRoot('')).toThrow(AccessDeniedError);
    expect(() => access.assertRoot(undefined)).toThrow(AccessDeniedError);
  });

  it('ignores a malformed store', () => {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, '{"approvedRoot": "relative/path"}');
    const access = make();
    access.load();
    expect(access.getRoot()).toBeNull();

    fs.writeFileSync(storeFile, 'not json');
    access.load();
    expect(access.getRoot()).toBeNull();
  });

  it('allows reading WAVs inside the root', () => {
    const access = make();
    access.approveRoot(root);
    const wav = path.join(root, 'Patch01', 'PhraseA', 'phrase.wav');
    expect(access.assertReadableFile(wav, ['.wav'])).toBe(wav);
  });

  it('rejects files outside the root, traversal and symlinks that escape', () => {
    const access = make();
    access.approveRoot(root);
    const outside = path.join(tmp, 'outside', 'loop.wav');
    expect(() => access.assertReadableFile(outside, ['.wav'])).toThrow(AccessDeniedError);
    expect(() => access.assertReadableFile(`${root}/../outside/loop.wav`, ['.wav'])).toThrow(
      AccessDeniedError,
    );
    expect(() => access.assertReadableFile(path.join(root, 'escape.wav'), ['.wav'])).toThrow(
      AccessDeniedError,
    );
  });

  it('rejects the wrong extension and relative paths', () => {
    const access = make();
    access.approveRoot(root);
    expect(() =>
      access.assertReadableFile(path.join(root, 'Patch01', 'patch.xml'), ['.wav']),
    ).toThrow(AccessDeniedError);
    expect(() => access.assertReadableFile('Patch01/PhraseA/phrase.wav', ['.wav'])).toThrow(
      AccessDeniedError,
    );
  });

  it('allows a file outside the root once the user picked it in a dialog', () => {
    const access = make();
    access.approveRoot(root);
    const picked = path.join(tmp, 'outside', 'loop.wav');
    access.grantFile(picked);
    expect(access.assertReadableFile(picked, ['.wav'])).toBe(picked);

    // Granted files are not persisted
    const afterRestart = make();
    afterRestart.load();
    expect(() => afterRestart.assertReadableFile(picked, ['.wav'])).toThrow(AccessDeniedError);
  });
});
