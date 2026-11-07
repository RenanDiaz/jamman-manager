/**
 * Renderer-side types. The data that crosses IPC is declared once, in the IPC
 * contract (packages/preload/src/ipc-contract.ts); these are aliases of it.
 */
import type {
  PatchRecord,
  PhraseRecord,
  Playlist as IpcPlaylist,
  PlaylistData as IpcPlaylistData,
} from '@app/preload/ipc-contract';

/** A patch folder of the SD, as `readPatches` returns it. */
export type Patch = PatchRecord;
export type Phrase = PhraseRecord;
export type Playlist = IpcPlaylist;
export type PlaylistData = IpcPlaylistData;

/** Values the PatchForm offers for `<RhythmType>` and `<StopMode>`. */
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
