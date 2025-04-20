import { FC, useState } from "react";
import { ButtonGroup } from "reactstrap";
import { ImageButton } from "../../utils/Common";
import { PauseIcon, PlayIcon, StopIcon } from "../../utils/Images";

interface Props {
  wavPath: string;
}

const PhrasePlayer: FC<Props> = ({ wavPath }) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  const handlePlay = async () => {
    if (!audio) {
      const validation = await window.electronAPI.validateWav(wavPath);
      if (!validation.valid) {
        alert(`Invalid WAV file:\n${validation.error}`);
        setAudio(null);
        return;
      }
      const url = await window.electronAPI.getAudioURL(wavPath);
      const audio = new Audio(url);
      audio.play();
      setAudio(audio);
      audio.onended = () => {
        setIsPlaying(false);
      };
      audio.onplay = () => {
        setIsPlaying(true);
      };
      audio.onerror = () => {
        setIsPlaying(false);
        setAudio(null);
        alert("Error playing audio");
        console.error("Error playing audio:", audio.error);
      };
    } else {
      audio.play();
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
      {isPlaying ? (
        <ImageButton
          type="button"
          title="Pause"
          className="btn px-1"
          onClick={handlePause}
        >
          <PauseIcon />
        </ImageButton>
      ) : (
        <ImageButton
          type="button"
          title="Play"
          className="btn px-1"
          onClick={handlePlay}
        >
          <PlayIcon />
        </ImageButton>
      )}
      <ImageButton
        type="button"
        title="Stop"
        className="btn px-1"
        onClick={handleStop}
      >
        <StopIcon />
      </ImageButton>
    </ButtonGroup>
  );
};

export default PhrasePlayer;
