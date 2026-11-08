import { describe, expect, it } from 'vitest';
import {
  assertNotPedal,
  bankPath,
  isPedalPath,
  parseBankPath,
  parseWavPath,
  PedalNotSupportedError,
  wavPath,
} from './pedalPaths.js';

describe('pedal paths', () => {
  it('builds and parses bank and WAV paths', () => {
    expect(bankPath('sd')).toBe('jamman-pedal://sd');
    expect(parseBankPath('jamman-pedal://sd')).toBe('sd');
    expect(parseBankPath('jamman-pedal://internal/')).toBe('internal');

    const p = wavPath('internal', 'Patch01', 'PhraseA');
    expect(p).toBe('jamman-pedal://internal/Patch01/PhraseA/phrase.wav');
    expect(parseWavPath(p)).toEqual({ bank: 'internal', patch: 'Patch01', phrase: 'PhraseA' });
  });

  it.each([
    'jamman-pedal://sd/../usr/phrase.wav',
    'jamman-pedal://sd/Patch01/../../usr/app',
    'jamman-pedal://sd/Patch1/PhraseA/phrase.wav',
    'jamman-pedal://sd/Patch01/PhraseAB/phrase.wav',
    'jamman-pedal://sd/Patch01/PhraseA/phrase.xml',
    'jamman-pedal://usr/Patch01/PhraseA/phrase.wav',
    'jamman-pedal://sd/Patch01/PhraseA/phrase.wav/',
    '/mnt/sdfs/JamManStereo/Patch01/PhraseA/phrase.wav',
  ])('rejects %s as a phrase WAV', value => {
    expect(parseWavPath(value)).toBeNull();
  });

  it('rejects anything but a bank as a bank path', () => {
    expect(parseBankPath('jamman-pedal://sd/Patch01')).toBeNull();
    expect(parseBankPath('jamman-pedal://usr')).toBeNull();
    expect(parseBankPath(42)).toBeNull();
  });

  it('tells pedal paths from disk paths', () => {
    expect(isPedalPath('jamman-pedal://sd')).toBe(true);
    expect(isPedalPath('/Volumes/JAMMAN/JamManStereo')).toBe(false);
    expect(isPedalPath(undefined)).toBe(false);
    expect(() => assertNotPedal('jamman-pedal://sd', 'Editing')).toThrow(PedalNotSupportedError);
    expect(() => assertNotPedal('/Volumes/JAMMAN', 'Editing')).not.toThrow();
  });
});
