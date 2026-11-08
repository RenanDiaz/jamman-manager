/**
 * Asks before changing a pedal that is using what will change, or that holds
 * something unsaved. `confirmPedalWrite` decides whether to ask; the dialog
 * (PedalWriteConfirm) shows the question this store holds.
 */
import { create } from 'zustand';
import { usePedalStore } from './usePedalStore';
import { isPedalPath } from '../utils/pedal';

export interface PedalWriteQuestion {
  title: string;
  details: string[];
}

interface PedalGuardStore {
  question: PedalWriteQuestion | null;
  resolve: ((ok: boolean) => void) | null;
  ask: (question: PedalWriteQuestion) => Promise<boolean>;
  answer: (ok: boolean) => void;
}

export const usePedalGuardStore = create<PedalGuardStore>((set, get) => ({
  question: null,
  resolve: null,
  ask: question =>
    new Promise<boolean>(resolve => {
      get().resolve?.(false); // a question still open counts as declined
      set({ question, resolve });
    }),
  answer: ok => {
    get().resolve?.(ok);
    set({ question: null, resolve: null });
  },
}));

/** The user declined to change a patch the pedal is using. Not an error to report. */
export class PedalWriteCanceled extends Error {
  constructor() {
    super('Canceled');
    this.name = 'PedalWriteCanceled';
  }
}

/**
 * Before changing `dirs` of `folder` (or the whole bank): when it is a pedal
 * bank and the change touches the patch loaded on the pedal, or the pedal holds
 * an unsaved recording or settings, ask first. Resolves true to go ahead.
 */
export async function confirmPedalWrite(
  folder: string | null,
  dirs: string[] | 'all',
): Promise<boolean> {
  if (!isPedalPath(folder)) return true;
  const pedal = usePedalStore.getState().pedal;
  if (!pedal) return true;
  const bank = pedal.banks.find(b => b.path === folder)?.id;
  const { live } = pedal;
  const touchesLoaded =
    !!live.patch && live.bank === bank && (dirs === 'all' || dirs.includes(live.patch));
  const unsaved = live.audioDirty || live.settingsDirty;
  if (!touchesLoaded && !unsaved) return true;

  const details: string[] = [];
  if (touchesLoaded) {
    details.push(
      `${live.patch} is loaded on the pedal. After the change the pedal stops and loads it again, so it plays the new version.`,
    );
  }
  if (live.audioDirty) {
    details.push(
      touchesLoaded
        ? 'The pedal has a recording that is not saved: reloading the patch discards it. Save it on the pedal first if you want to keep it.'
        : 'The pedal has a recording that is not saved yet. Save it on the pedal first if you want to keep it.',
    );
  }
  if (live.settingsDirty) {
    details.push('The settings of the patch on the pedal changed and are not saved yet.');
  }
  return usePedalGuardStore.getState().ask({
    title: 'The pedal has an unsaved loop or is using this patch',
    details,
  });
}
