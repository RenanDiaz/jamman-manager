/**
 * Read-only view of a patch record for display. Pulls the xml2js arrays
 * apart once so components don't repeat `?.[0]` lookups.
 */
import { RhythmType, StopMode, type Patch, type Phrase } from '../types';
import { slotNumber } from './format';

export const RHYTHM_ORDER = Object.values(RhythmType);

export const RHYTHM_LABEL: Record<RhythmType, string> = {
  [RhythmType.Silence]: 'Silence',
  [RhythmType.WoodBlocks]: 'Wood blocks',
  [RhythmType.Sticks]: 'Sticks',
  [RhythmType.Click]: 'Click',
  [RhythmType.AlternativeKickAndHighHat]: 'Alt. kick + hat',
  [RhythmType.StudioKickAndHighHat]: 'Studio kick + hat',
  [RhythmType.TechnoKickAndHighHat]: 'Techno kick + hat',
  [RhythmType.Cowbell]: 'Cowbell',
  [RhythmType.Conga]: 'Conga',
  [RhythmType.Tambourine]: 'Tambourine',
};

/** The pedal prints Stop / Finish / Fade next to its stop-mode LEDs. */
export const STOP_MODES: Array<{ mode: StopMode; short: string; description: string }> = [
  { mode: StopMode.StopInstantly, short: 'Stop', description: 'Stops instantly' },
  { mode: StopMode.StopAtEndOfLoop, short: 'Finish', description: 'Finishes the loop' },
  { mode: StopMode.FadeOut, short: 'Fade', description: 'Fades out' },
];

export interface PhraseView {
  dir: string;
  wavPath: string;
  bpm: number | null;
  beatsPerMeasure: string | null;
  isLoop: boolean;
  isReversed: boolean;
}

export interface PatchView {
  dir: string;
  slot: string;
  name: string;
  rhythm: string | null;
  rhythmLabel: string;
  stopMode: string | null;
  stopLabel: string;
  device: string | null;
  id: string | null;
  originId: string | null;
  settingsVersion: string | null;
  phrases: PhraseView[];
}

const toPhraseView = ({ dir, wavPath, data: { JamManPhrase: p } }: Phrase): PhraseView => {
  const bpm = Number(p.BeatsPerMinute?.[0]);
  return {
    dir,
    wavPath,
    bpm: Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm * 10) / 10 : null,
    beatsPerMeasure: p.BeatsPerMeasure?.[0] ?? null,
    isLoop: p.IsLoop?.[0] === '1',
    isReversed: p.IsReversed?.[0] === '1',
  };
};

export const toPatchView = (patch: Patch): PatchView => {
  const p = patch.data.JamManPatch;
  const rhythm = p.RhythmType?.[0] ?? null;
  const stopMode = p.StopMode?.[0] ?? null;
  const stop = STOP_MODES.find(s => s.mode === stopMode);
  return {
    dir: patch.dir,
    slot: slotNumber(patch.dir),
    name: p.PatchName?.[0] ?? '',
    rhythm,
    rhythmLabel: (rhythm && RHYTHM_LABEL[rhythm as RhythmType]) || rhythm || 'No rhythm set',
    stopMode,
    stopLabel: stop?.description ?? stopMode ?? 'No stop mode set',
    device: p.$?.device ?? null,
    id: p.ID?.[0] ?? null,
    originId: p.OriginID?.[0] ?? null,
    settingsVersion: p.SettingsVersion?.[0] ?? null,
    phrases: patch.phrases.map(toPhraseView),
  };
};
