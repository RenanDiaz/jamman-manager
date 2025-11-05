/**
 * Audio Player Store - Global Audio Playback State
 *
 * Manages the global footer audio player state. Only one audio file
 * can be playing at a time across the entire application.
 *
 * Features:
 * - Single audio context for all playback
 * - Track currently playing phrase with patch context
 * - Playback state (playing, paused, stopped)
 * - Current time and duration tracking
 * - Volume control
 *
 * @module useAudioPlayerStore
 */

import { create } from 'zustand';

/**
 * Information about the currently loaded audio
 */
interface AudioInfo {
  /** Path to the WAV file */
  wavPath: string;
  /** Patch directory name (e.g., "Patch01") */
  patchDir: string;
  /** Patch name */
  patchName: string;
  /** Phrase name */
  phraseName: string;
  /** Audio duration in seconds */
  duration: number | null;
  /** File size in bytes */
  fileSizeBytes: number | null;
}

/**
 * Audio player store interface
 */
interface AudioPlayerStore {
  // ==================== State ====================

  /** Currently loaded audio info */
  audioInfo: AudioInfo | null;

  /** Whether audio is currently playing */
  isPlaying: boolean;

  /** Whether player is loading audio */
  isLoading: boolean;

  /** Current playback time in seconds */
  currentTime: number;

  /** Audio volume (0.0 to 1.0) */
  volume: number;

  /** Whether player is minimized */
  isMinimized: boolean;

  // ==================== Actions ====================

  /**
   * Loads a new audio file
   * @param info - Audio information
   */
  loadAudio: (info: AudioInfo) => void;

  /**
   * Starts or resumes playback
   */
  play: () => void;

  /**
   * Pauses playback
   */
  pause: () => void;

  /**
   * Stops playback and resets position
   */
  stop: () => void;

  /**
   * Seeks to a specific time
   * @param time - Time in seconds
   */
  seek: (time: number) => void;

  /**
   * Sets the volume
   * @param volume - Volume level (0.0 to 1.0)
   */
  setVolume: (volume: number) => void;

  /**
   * Sets loading state
   * @param loading - Whether player is loading
   */
  setLoading: (loading: boolean) => void;

  /**
   * Updates current playback time
   * @param time - Current time in seconds
   */
  setCurrentTime: (time: number) => void;

  /**
   * Updates duration
   * @param duration - Duration in seconds
   */
  setDuration: (duration: number) => void;

  /**
   * Toggles minimized state
   */
  toggleMinimized: () => void;

  /**
   * Closes the player and clears audio
   */
  close: () => void;
}

export const useAudioPlayerStore = create<AudioPlayerStore>(set => ({
  // Initial state
  audioInfo: null,
  isPlaying: false,
  isLoading: false,
  currentTime: 0,
  volume: 0.8,
  isMinimized: false,

  // Actions
  loadAudio: (info: AudioInfo) => {
    set({
      audioInfo: info,
      isPlaying: false,
      isLoading: true,
      currentTime: 0,
      isMinimized: false,
    });
  },

  play: () => {
    set({ isPlaying: true });
  },

  pause: () => {
    set({ isPlaying: false });
  },

  stop: () => {
    set({ isPlaying: false, currentTime: 0 });
  },

  seek: (time: number) => {
    set({ currentTime: time });
  },

  setVolume: (volume: number) => {
    // Clamp volume between 0 and 1
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ volume: clampedVolume });
  },

  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  setCurrentTime: (time: number) => {
    set({ currentTime: time });
  },

  setDuration: (duration: number) => {
    set(state => ({
      audioInfo: state.audioInfo
        ? {
            ...state.audioInfo,
            duration,
          }
        : null,
    }));
  },

  toggleMinimized: () => {
    set(state => ({ isMinimized: !state.isMinimized }));
  },

  close: () => {
    set({
      audioInfo: null,
      isPlaying: false,
      isLoading: false,
      currentTime: 0,
    });
  },
}));
