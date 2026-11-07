/**
 * Helpers to use the synthetic JamMan SD fixture in tests.
 *
 *   const sd = createTempSd();            // copy of tests/fixtures/jamman-sd in a temp dir
 *   ... exercise real code against sd.path ...
 *   sd.cleanup();
 *
 * See tests/fixtures/README.md.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Pristine, read-only-by-convention copy of the SD. Never write into it from tests. */
export const SD_FIXTURE_DIR = path.join(FIXTURES_DIR, 'jamman-sd');

/** What the fixture contains, so tests don't hard-code it in many places. */
export const SD_FIXTURE_PATCHES = [
  {
    dir: 'Patch01',
    name: 'Rock Groove',
    id: '000000a0-0000-4000-8000-000000000001',
    phrases: ['PhraseA'],
  },
  {
    dir: 'Patch02',
    name: 'Waltz Pair',
    id: '000000a0-0000-4000-8000-000000000002',
    phrases: ['PhraseA', 'PhraseB'],
  },
  {
    dir: 'Patch03',
    name: 'Slow Blues',
    id: '000000a0-0000-4000-8000-000000000003',
    phrases: ['PhraseA'],
  },
] as const;

export interface TempSd {
  /** Absolute path of the temporary SD root (contains PatchNN folders). */
  path: string;
  /** Removes the temporary directory. Safe to call more than once. */
  cleanup: () => void;
}

/** Creates an empty temporary directory. */
export function createTempDir(prefix = 'jamman-test-'): TempSd {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  return {
    path: dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Copies the JamMan SD fixture to a fresh temporary directory.
 * @param source Alternative SD tree to copy (defaults to the bundled synthetic one).
 */
export function createTempSd(source: string = SD_FIXTURE_DIR): TempSd {
  const tmp = createTempDir('jamman-sd-');
  fs.cpSync(source, tmp.path, { recursive: true });
  return tmp;
}
