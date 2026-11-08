/**
 * Validates a phrase WAV and loads it into the footer player, then plays it.
 * Extracted unchanged from PhrasePlayer so a patch row can play its first phrase too.
 */
import { useCallback } from 'react';
import { toast } from 'react-toastify';
import { useAudioPlayerStore } from '../store/useAudioPlayerStore';

export interface PlayPhraseArgs {
  wavPath: string;
  patchDir: string;
  patchName: string;
  phraseName: string;
}

export const usePlayPhrase = () => {
  const loadAudio = useAudioPlayerStore(state => state.loadAudio);
  const play = useAudioPlayerStore(state => state.play);

  return useCallback(
    async ({ wavPath, patchDir, patchName, phraseName }: PlayPhraseArgs) => {
      try {
        // Validate WAV file and get metadata
        const validation = await window.electronAPI.validateWav(wavPath);

        if (validation.canAttemptPlayback === false) {
          console.error(`Cannot play WAV file ${wavPath}:`, validation.error);
          toast.error(`Cannot play audio: ${validation.error}`);
          return;
        }

        // Load audio into footer player
        loadAudio({
          wavPath,
          patchDir,
          patchName,
          phraseName,
          duration: validation.duration ?? null,
          fileSizeBytes: validation.fileSizeBytes ?? null,
        });

        // Auto-play after loading
        play();

        // Show warnings if any
        if (!validation.valid && validation.warning) {
          console.warn(`WAV validation warning for ${wavPath}:`, validation.warning);
          toast.warning(validation.warning, { autoClose: 3000 });
        }
      } catch (error) {
        console.error('Error loading audio:', error);
        toast.error('Failed to load audio');
      }
    },
    [loadAudio, play],
  );
};
