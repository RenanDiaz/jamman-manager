/**
 * Phrase Player Button
 *
 * A simple play button that loads audio into the global footer player.
 * Replaces the old inline player with a cleaner, more scalable approach.
 */

import { FC, memo } from 'react';
import { Button } from 'reactstrap';
import { toast } from 'react-toastify';
import { useAudioPlayerStore } from '../../store/useAudioPlayerStore';
import { PlayIcon } from '../../utils/Images';

interface Props {
  wavPath: string;
  patchDir: string;
  patchName: string;
  phraseName: string;
}

const PhrasePlayer: FC<Props> = memo(({ wavPath, patchDir, patchName, phraseName }) => {
  const { audioInfo, loadAudio } = useAudioPlayerStore();

  const handlePlay = async () => {
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

      // Show warnings if any
      if (!validation.valid && validation.warning) {
        console.warn(`WAV validation warning for ${wavPath}:`, validation.warning);
        toast.warning(validation.warning, { autoClose: 3000 });
      }
    } catch (error) {
      console.error('Error loading audio:', error);
      toast.error('Failed to load audio');
    }
  };

  // Check if this phrase is currently loaded
  const isActive = audioInfo?.wavPath === wavPath;

  return (
    <Button
      size="sm"
      color={isActive ? 'primary' : 'secondary'}
      outline={!isActive}
      onClick={handlePlay}
      title={`Play ${phraseName}`}
      className="d-flex align-items-center gap-1"
    >
      <PlayIcon />
      {isActive && (
        <span className="badge bg-light text-dark ms-1" style={{ fontSize: '0.6rem' }}>
          Now Playing
        </span>
      )}
    </Button>
  );
});

PhrasePlayer.displayName = 'PhrasePlayer';

export default PhrasePlayer;
