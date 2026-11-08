/**
 * The JamMan connected over USB, as the main process reports it.
 *
 * `pedal` follows the `pedal:changed` events (connect, disconnect, SD card
 * inserted or removed); `subscribe` wires them once at startup.
 */
import { create } from 'zustand';
import type { PedalInfo, PedalProgress } from '@app/preload/ipc-contract';

interface PedalStore {
  pedal: PedalInfo | null;
  connecting: boolean;
  /** Progress of the upload running on the pedal, or null. */
  progress: PedalProgress | null;
  /** Finds the pedal on USB and connects. Throws with a message for the user when it fails. */
  connect: () => Promise<PedalInfo>;
  disconnect: () => Promise<void>;
  /** Starts following pedal events. Returns the unsubscribe function. */
  subscribe: () => () => void;
}

export const usePedalStore = create<PedalStore>(set => ({
  pedal: null,
  connecting: false,
  progress: null,

  connect: async () => {
    set({ connecting: true });
    try {
      const pedal = await window.electronAPI.connectPedal();
      set({ pedal });
      return pedal;
    } finally {
      set({ connecting: false });
    }
  },

  disconnect: async () => {
    await window.electronAPI.disconnectPedal();
    set({ pedal: null });
  },

  subscribe: () => {
    const unsubscribeChanges = window.electronAPI.onPedalChanged(pedal =>
      set(pedal ? { pedal } : { pedal, progress: null }),
    );
    const unsubscribeProgress = window.electronAPI.onPedalProgress(progress => set({ progress }));
    // Pick up a connection made before this window loaded (e.g. after a reload).
    window.electronAPI
      .getPedalStatus()
      .then(pedal => set({ pedal }))
      .catch(() => undefined);
    return () => {
      unsubscribeChanges();
      unsubscribeProgress();
    };
  },
}));
