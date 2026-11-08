/**
 * Pedal paths through the real IPC layer: the channels that understand them
 * route to the pedal, every other channel refuses them with a clear message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => import('../test-utils/electronMock.js'));
vi.mock('electron-log', () => import('../test-utils/logMock.js'));
vi.mock('electron-updater', () => import('../test-utils/updaterMock.js'));

import { startApp, type AppHarness } from '../test-utils/appHarness.js';
import { wavDurationFromHeader } from './audio.js';
import { wavBytes } from '../test-utils/fakePedal.js';

const SD = 'jamman-pedal://sd';
const WAV = `${SD}/Patch01/PhraseA/phrase.wav`;

let app: AppHarness | undefined;

afterEach(() => {
  app?.cleanup();
  app = undefined;
});

describe('pedal paths over IPC', () => {
  it('reports no pedal until one is connected', async () => {
    app = await startApp();
    expect(await app.invoke('pedal:status')).toBeNull();
    await expect(app.invoke('patches:read', SD)).rejects.toThrow(/No pedal is connected/);
    expect(await app.invoke('phrase:getAudioURL', WAV)).toBeNull();
    expect(await app.invoke('audio:validateWav', WAV)).toMatchObject({
      valid: false,
      error: 'The pedal is not connected',
    });
  });

  it('returns no playlists for a pedal bank', async () => {
    app = await startApp();
    expect(await app.invoke('playlists:load', SD)).toEqual({
      version: '2.0',
      playlists: [],
      patches: [],
    });
  });

  it.each([
    ['backup:create', [SD]],
    ['backup:restore', ['/tmp/x.zip', SD, 'merge']],
    ['playlists:create', [SD, 'Set']],
  ])('%s refuses a pedal path', async (channel, args) => {
    app = await startApp();
    await expect(app.invoke(channel, ...args)).rejects.toThrow(
      /not available for a pedal connected over USB yet/,
    );
  });

  it.each([
    ['patches:create', [{ basePath: SD, directory: 'Patch01', phrases: [] }]],
    ['patches:update', [{ basePath: SD, directory: 'Patch01', phrases: [] }]],
    ['patches:delete', [SD, 'Patch01']],
    ['patches:deleteBatch', [SD, ['Patch01']]],
    ['patches:reorder', [SD, ['Patch01']]],
  ])('%s goes to the pedal', async (channel, args) => {
    app = await startApp();
    await expect(app.invoke(channel, ...args)).rejects.toThrow(/No pedal is connected/);
  });

  it('refuses a WAV from the computer that the user did not pick', async () => {
    app = await startApp();
    const phrases = [
      {
        name: 'PhraseA',
        wavPath: '/etc/secret.wav',
        beatsPerMinute: 120,
        beatsPerMeasure: 4,
        isLoop: true,
        isReversed: false,
      },
    ];
    for (const channel of ['patches:create', 'patches:update']) {
      const error = await app
        .invoke(channel, { basePath: SD, directory: 'Patch01', phrases })
        .catch(e => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toMatch(/No pedal is connected/);
    }
  });

  it('answers undo requests for a pedal bank with a result, not an error', async () => {
    app = await startApp();
    expect(
      await app.invoke('undo:createSnapshot', SD, { kind: 'patches', patches: ['Patch01'] }),
    ).toMatchObject({ ok: false, code: 'FAILED', message: expect.stringMatching(/No pedal/) });
    expect(await app.invoke('undo:restoreSnapshot', 'pedal-x', SD, 'add')).toMatchObject({
      ok: false,
    });
    expect(
      await app.invoke('undo:createSnapshot', 'jamman-pedal://usr', { kind: 'all' }),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    await app.invoke('undo:discardSnapshot', 'pedal-unknown'); // never throws
  });

  it('rejects a malformed pedal folder', async () => {
    app = await startApp();
    await expect(app.invoke('patches:read', 'jamman-pedal://usr')).rejects.toThrow(
      /Invalid pedal folder path/,
    );
  });
});

describe('wavDurationFromHeader', () => {
  it('measures the data chunk, not the bytes at hand', () => {
    // 4 seconds of 16-bit stereo 44.1 kHz, but only the header is passed.
    const header = wavBytes(44100 * 4 * 4).subarray(0, 44);
    expect(wavDurationFromHeader(header)).toBe(4);
  });

  it('skips chunks before data', () => {
    const wav = wavBytes(44100 * 4);
    const list = Buffer.concat([
      Buffer.from('LIST', 'ascii'),
      Buffer.from([3, 0, 0, 0, 1, 2, 3, 0]),
    ]);
    const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36, 44)]);
    expect(wavDurationFromHeader(withList)).toBe(1);
  });

  it('returns undefined for something that is not a WAV', () => {
    expect(wavDurationFromHeader(Buffer.from('not a wav at all'))).toBeUndefined();
  });
});
