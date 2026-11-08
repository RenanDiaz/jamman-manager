import { beforeEach, describe, expect, it } from 'vitest';
import type { PedalInfo } from '@app/preload/ipc-contract';
import { confirmPedalWrite, usePedalGuardStore } from './usePedalGuardStore';
import { usePedalStore } from './usePedalStore';

const SD = 'jamman-pedal://sd';

function pedal(live: Partial<PedalInfo['live']> = {}): PedalInfo {
  return {
    name: 'JamMan Stereo',
    firmwareVersion: '1.3.0.0',
    guid: 'g',
    banks: [
      {
        id: 'internal',
        path: 'jamman-pedal://internal',
        available: true,
        capacityBytes: 1,
        freeBytes: 1,
      },
      { id: 'sd', path: SD, available: true, capacityBytes: 1, freeBytes: 1 },
    ],
    live: {
      bank: 'sd',
      patch: 'Patch07',
      busy: false,
      audioDirty: false,
      settingsDirty: false,
      ...live,
    },
    buttons: { left: 'UndoRedo', middle: 'Reverse', right: 'Tempo' },
    buttonCommands: ['UndoRedo', 'Reverse', 'Tempo'],
  };
}

/** Starts the check, answers the question it asks (if any) and returns the result. */
async function decide(folder: string | null, dirs: string[] | 'all', answer: boolean) {
  const pending = confirmPedalWrite(folder, dirs);
  const asked = usePedalGuardStore.getState().question;
  if (asked) usePedalGuardStore.getState().answer(answer);
  return { asked, ok: await pending };
}

beforeEach(() => {
  usePedalStore.setState({ pedal: pedal() });
  usePedalGuardStore.setState({ question: null, resolve: null });
});

describe('confirmPedalWrite', () => {
  it('does not ask for a card folder or a patch the pedal is not using', async () => {
    expect(await decide('/Volumes/JAMMAN/JamManStereo', ['Patch07'], false)).toEqual({
      asked: null,
      ok: true,
    });
    expect(await decide(SD, ['Patch03'], false)).toEqual({ asked: null, ok: true });
    expect(await decide('jamman-pedal://internal', ['Patch07'], false)).toEqual({
      asked: null,
      ok: true,
    });
  });

  it('asks before changing the loaded patch, and follows the answer', async () => {
    const declined = await decide(SD, ['Patch07'], false);
    expect(declined.ok).toBe(false);
    expect(declined.asked?.title).toBe('The pedal has an unsaved loop or is using this patch');
    expect(declined.asked?.details[0]).toMatch(/Patch07 is loaded on the pedal/);

    expect((await decide(SD, 'all', true)).ok).toBe(true);
  });

  it('asks when the pedal holds something unsaved, even for another patch', async () => {
    usePedalStore.setState({ pedal: pedal({ audioDirty: true }) });
    const result = await decide(SD, ['Patch03'], true);
    expect(result.ok).toBe(true);
    expect(result.asked?.details).toEqual([expect.stringMatching(/recording that is not saved/)]);
  });

  it('warns that reloading discards an unsaved recording on the loaded patch', async () => {
    usePedalStore.setState({ pedal: pedal({ audioDirty: true, settingsDirty: true }) });
    const { asked } = await decide(SD, ['Patch07'], false);
    expect(asked?.details).toHaveLength(3);
    expect(asked?.details[1]).toMatch(/discards it/);
  });

  it('treats a new question as declining the one still open', async () => {
    const first = confirmPedalWrite(SD, ['Patch07']);
    const second = confirmPedalWrite(SD, ['Patch07']);
    usePedalGuardStore.getState().answer(true);
    expect(await first).toBe(false);
    expect(await second).toBe(true);
  });
});
