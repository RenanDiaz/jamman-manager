import { FC, useEffect, useRef, useState } from 'react';
import { ButtonGroup, Spinner } from 'reactstrap';
import { toast } from 'react-toastify';
import { ImageButton } from '../../utils/Common';
import { PauseIcon, PlayIcon, StopIcon } from '../../utils/Images';

interface Props {
  wavPath: string;
}

const MAX_RETRIES = 2;

const PhrasePlayer: FC<Props> = ({ wavPath }) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const retryCountRef = useRef(0);

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

  const createAudioElement = async (retryAttempt = 0): Promise<HTMLAudioElement | null> => {
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
        setIsPlaying(false);
      };

      newAudio.onplay = () => {
        setIsPlaying(true);
        setIsLoading(false);
      };

      newAudio.oncanplay = () => {
        setIsLoading(false);
      };

      newAudio.onerror = async event => {
        const error = newAudio.error;
        const errorMessage = error
          ? `MediaError code ${error.code}: ${error.message || 'Unknown error'}`
          : 'Unknown playback error';

        console.error('Audio playback error:', errorMessage, event);

        setIsPlaying(false);
        setIsLoading(false);

        // Retry logic
        if (retryAttempt < MAX_RETRIES) {
          console.log(`Retrying audio load (attempt ${retryAttempt + 1}/${MAX_RETRIES})...`);
          retryCountRef.current = retryAttempt + 1;

          // Clean up failed audio
          newAudio.src = '';
          newAudio.load();

          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 500));

          // Retry
          const retriedAudio = await createAudioElement(retryAttempt + 1);
          if (retriedAudio) {
            setAudio(retriedAudio);
            await retriedAudio.play();
          }
        } else {
          // Max retries exceeded
          setAudio(null);
          retryCountRef.current = 0;
          toast.error(
            `Failed to play audio after ${MAX_RETRIES} attempts. ${error?.code === 4 ? 'The file format may not be supported.' : ''}`,
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
    if (!audio) {
      const newAudio = await createAudioElement();
      if (newAudio) {
        setAudio(newAudio);
        try {
          await newAudio.play();
        } catch (error) {
          console.error('Error playing audio:', error);
          setIsLoading(false);
        }
      }
    } else {
      try {
        await audio.play();
      } catch (error) {
        console.error('Error resuming audio:', error);
        toast.error('Failed to resume playback');
      }
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
