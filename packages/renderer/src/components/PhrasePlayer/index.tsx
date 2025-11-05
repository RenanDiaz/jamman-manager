import { FC, useEffect, useState, memo } from 'react';
import { ButtonGroup, Spinner } from 'reactstrap';
import { toast } from 'react-toastify';
import { ImageButton } from '../../utils/Common';
import { PauseIcon, PlayIcon, StopIcon } from '../../utils/Images';

interface Props {
  wavPath: string;
}

/**
 * Formats duration in seconds to MM:SS format
 */
const formatDuration = (seconds: number | null): string => {
  if (seconds === null || !isFinite(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Formats file size in bytes to human-readable format
 */
const formatFileSize = (bytes: number | null): string => {
  if (bytes === null) return '-- KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const PhrasePlayer: FC<Props> = memo(({ wavPath }) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audio) {
        audio.pause();
        audio.src = '';
        audio.load();
      }
    };
  }, [audio]);

  const createAudioElement = async (): Promise<HTMLAudioElement | null> => {
    try {
      setIsLoading(true);

      // Validate wavPath is not empty
      if (!wavPath || wavPath.trim() === '') {
        console.error('Empty wavPath provided to PhrasePlayer');
        toast.error('Audio file path is missing');
        setIsLoading(false);
        return null;
      }

      console.log(`Loading audio file: ${wavPath}`);

      // Validate WAV file
      const validation = await window.electronAPI.validateWav(wavPath);

      // Check if we can attempt playback
      if (validation.canAttemptPlayback === false) {
        console.error(`Cannot play WAV file ${wavPath}:`, validation.error);
        toast.error(`Cannot play audio: ${validation.error}`);
        setIsLoading(false);
        return null;
      }

      // Store metadata
      if (validation.duration !== undefined) {
        setDuration(validation.duration);
      }
      if (validation.fileSizeBytes !== undefined) {
        setFileSize(validation.fileSizeBytes);
      }

      // Show warnings for files that can't be validated but might work
      if (!validation.valid && validation.warning) {
        console.warn(`WAV validation warning for ${wavPath}:`, validation.warning);
        toast.warning(validation.warning, { autoClose: 5000 });
      } else if (!validation.valid && validation.error) {
        console.warn(`WAV format issue for ${wavPath}:`, validation.error);
        toast.warning(`${validation.error} - Attempting playback anyway.`, { autoClose: 5000 });
      }

      // Get audio URL
      const url = await window.electronAPI.getAudioURL(wavPath);
      console.log(`Audio URL received: ${url}`);

      if (!url || url.trim() === '') {
        console.error(`Empty URL returned for wavPath: ${wavPath}`);
        toast.error('Failed to load audio file - empty URL returned');
        setIsLoading(false);
        return null;
      }

      // Create audio element
      const newAudio = new Audio(url);
      console.log(`Audio element created with src: ${newAudio.src}`);

      // Set up event listeners
      newAudio.onended = () => {
        console.log('Audio playback ended');
        setIsPlaying(false);
      };

      newAudio.onplay = () => {
        console.log('Audio playback started');
        setIsPlaying(true);
        setIsLoading(false);
      };

      newAudio.oncanplay = () => {
        console.log('Audio can play');
        setIsLoading(false);
      };

      newAudio.onerror = () => {
        const error = newAudio.error;
        const errorMessage = error
          ? `MediaError code ${error.code}: ${error.message || 'Unknown error'}`
          : 'Unknown playback error';

        console.error('Audio playback error:', errorMessage);

        setIsPlaying(false);
        setIsLoading(false);
        setAudio(null);

        toast.error(
          `Failed to play audio. ${error?.code === 4 ? 'The file format may not be supported.' : 'Click play to try again.'}`,
        );
      };

      return newAudio;
    } catch (error) {
      console.error('Error creating audio element:', error);
      setIsLoading(false);
      toast.error('Failed to load audio file');
      return null;
    }
  };

  const handlePlay = async () => {
    // If audio exists, just resume playback
    if (audio) {
      try {
        await audio.play();
      } catch (error) {
        console.error('Error resuming audio:', error);
        toast.error('Failed to resume playback. Click play to try again.');
        setIsLoading(false);
      }
      return;
    }

    // Create new audio and play once
    try {
      const newAudio = await createAudioElement();

      if (!newAudio) {
        console.log('Failed to create audio element');
        return;
      }

      setAudio(newAudio);

      console.log('Attempting to play audio');
      await newAudio.play();
      console.log('Audio play succeeded');
    } catch (error) {
      console.error('Play attempt failed:', error);
      setAudio(null);
      setIsLoading(false);
      toast.error('Failed to play audio. Click play to try again.');
    }
  };

  const handlePause = () => {
    if (audio) {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const handleStop = () => {
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      setIsPlaying(false);
    }
  };

  return (
    <div className="d-flex align-items-center gap-2">
      <ButtonGroup>
        {isLoading ? (
          <ImageButton type="button" title="Loading..." className="btn px-1" disabled>
            <Spinner size="sm" />
          </ImageButton>
        ) : isPlaying ? (
          <ImageButton type="button" title="Pause" className="btn px-1" onClick={handlePause}>
            <PauseIcon />
          </ImageButton>
        ) : (
          <ImageButton type="button" title="Play" className="btn px-1" onClick={handlePlay}>
            <PlayIcon />
          </ImageButton>
        )}
        <ImageButton
          type="button"
          title="Stop"
          className="btn px-1"
          onClick={handleStop}
          disabled={isLoading}
        >
          <StopIcon />
        </ImageButton>
      </ButtonGroup>
      {/* Audio metadata */}
      <div className="d-flex gap-2" style={{ fontSize: '0.75rem' }}>
        <span className="text-muted" title="Duration">
          ⏱️ {formatDuration(duration)}
        </span>
        <span className="text-muted" title="File size">
          📦 {formatFileSize(fileSize)}
        </span>
      </div>
    </div>
  );
});

PhrasePlayer.displayName = 'PhrasePlayer';

export default PhrasePlayer;
