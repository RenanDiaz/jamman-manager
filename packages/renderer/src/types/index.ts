export interface Patch {
  dir: string;
  data: PatchData;
  phrases: Phrase[];
}

interface PatchData {
  JamManPatch: JamManPatch;
}

export enum RhythmType {
  Silence = 'Silence',
  WoodBlocks = 'WoodBlocks',
  Sticks = 'Sticks',
  Click = 'Click',
  AlternativeKickAndHighHat = 'AlternativeKickAndHighHat',
  StudioKickAndHighHat = 'StudioKickAndHighHat',
  TechnoKickAndHighHat = 'TechnoKickAndHighHat',
  Cowbell = 'Cowbell',
  Conga = 'Conga',
  Tambourine = 'Tambourine',
}

export enum StopMode {
  StopInstantly = 'StopInstantly',
  StopAtEndOfLoop = 'StopAtEndOfLoop',
  FadeOut = 'FadeOut',
}

interface JamManPatch {
  $: PatchHeader;
  PatchName: string[];
  RhythmType: RhythmType[];
  StopMode: StopMode[];
  SettingsVersion: string[];
  ID: string[];
  OriginID: string[];
  Metadata: string[];
}

interface PatchHeader {
  xmlns: string;
  device: string;
  version: string;
}

interface Phrase {
  dir: string;
  data: PhraseData;
  wavPath: string;
}

interface PhraseData {
  JamManPhrase: JamManPhrase;
}

interface JamManPhrase {
  $: PhraseHeader;
  BeatsPerMinute: string[];
  BeatsPerMeasure: string[];
  BpmValidated: string[];
  IsLoop: string[];
  IsReversed: string[];
  SettingsVersion: string[];
  AudioVersion: string[];
  ID: string[];
  OriginID: string[];
  Metadata: string[];
}

interface PhraseHeader {
  xmlns: string;
  version: string;
}

export type PhraseForm = {
  name: string;
  wavPath: string;
  tempo: number;
  timeSignature: string;
  loopType: string;
};

export type CreatePatchPayload = {
  basePath: string;
  patchName: string;
  phrases: PhraseForm[];
};
