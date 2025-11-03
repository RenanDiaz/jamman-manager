import { FC, useEffect, useRef, useState } from 'react';
import { ButtonGroup, Spinner } from 'reactstrap';
import { toast } from 'react-toastify';
import { ImageButton } from '../../utils/Common';
import { PauseIcon, PlayIcon, StopIcon } from '../../utils/Images';

interface Props {
  wavPath: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

const PhrasePlayer: FC<Props> = ({ wavPath }) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const retryCountRef = useRef(0);
  const isRetryingRef = useRef(false);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audio) {
        audio.pause();
        audio.src = '';
        audio.load();
      }
      retryCountRef.current = 0;
      isRetryingRef.current = false;
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

      console.log(
        `Loading audio file: ${wavPath} (attempt ${retryCountRef.current + 1}/${MAX_RETRIES})`,
      );

      // Validate WAV file
      const validation = await window.electronAPI.validateWav(wavPath);

      // Check if we can attempt playback
      if (validation.canAttemptPlayback === false) {
        console.error(`Cannot play WAV file ${wavPath}:`, validation.error);
        toast.error(`Cannot play audio: ${validation.error}`);
        setIsLoading(false);
        return null;
      }

      // Show warnings for files that can't be validated but might work (only on first attempt)
      if (retryCountRef.current === 0) {
        if (!validation.valid && validation.warning) {
          console.warn(`WAV validation warning for ${wavPath}:`, validation.warning);
          toast.warning(validation.warning, { autoClose: 5000 });
        } else if (!validation.valid && validation.error) {
          console.warn(`WAV format issue for ${wavPath}:`, validation.error);
          toast.warning(`${validation.error} - Attempting playback anyway.`, { autoClose: 5000 });
        }
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
        retryCountRef.current = 0;
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

        // Don't retry from the error handler - let handlePlay manage retries
        if (!isRetryingRef.current) {
          retryCountRef.current = 0;
          setAudio(null);
          toast.error(
            `Failed to play audio. ${error?.code === 4 ? 'The file format may not be supported.' : 'Please try again.'}`,
          );
        }
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
        toast.error('Failed to resume playback');
        setIsLoading(false);
      }
      return;
    }

    // Create new audio with retry logic
    isRetryingRef.current = true;
    let playSuccess = false;
    let currentAttemptAudio: HTMLAudioElement | null = null;

    while (retryCountRef.current < MAX_RETRIES && !playSuccess) {
      try {
        // Clean up any previous failed audio from this retry loop
        if (currentAttemptAudio) {
          // Remove event handlers to prevent them from firing during cleanup
          currentAttemptAudio.onplay = null;
          currentAttemptAudio.onerror = null;
          currentAttemptAudio.onended = null;
          currentAttemptAudio.oncanplay = null;
          currentAttemptAudio.pause();
          currentAttemptAudio.src = '';
          currentAttemptAudio.load();
        }

        // Create new audio element
        const newAudio = await createAudioElement();

        if (!newAudio) {
          console.log('Failed to create audio element, stopping retries');
          break;
        }

        currentAttemptAudio = newAudio;
        setAudio(newAudio);

        // Try to play
        console.log(
          `Attempting to play audio (attempt ${retryCountRef.current + 1}/${MAX_RETRIES})`,
        );
        await newAudio.play();

        // If we get here, play succeeded
        playSuccess = true;
        console.log('Audio play succeeded');
      } catch (error) {
        console.error(`Play attempt ${retryCountRef.current + 1} failed:`, error);

        retryCountRef.current++;

        if (retryCountRef.current < MAX_RETRIES) {
          console.log(`Waiting ${RETRY_DELAY_MS}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          console.error('Max retries reached, giving up');
          setAudio(null);
          setIsLoading(false);
          toast.error(
            `Failed to play audio after ${MAX_RETRIES} attempts. The file format may not be supported or the file may be corrupted.`,
          );
        }
      }
    }

    isRetryingRef.current = false;

    // Reset retry count if we succeeded
    if (playSuccess) {
      retryCountRef.current = 0;
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
    // Reset retry count when manually stopping
    retryCountRef.current = 0;
  };

  return (
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
  );
};

export default PhrasePlayer;
