import { FC, useState } from "react";
import { Button } from "reactstrap";

interface Props {
  wavPath: string;
}

const PhrasePlayer: FC<Props> = ({ wavPath }) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  const handlePlay = async () => {
    if (!audio) {
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

  return (
    <>
      {isPlaying ? (
        <Button type="button" color="success" size="sm" onClick={handlePause}>
          Pause
        </Button>
      ) : (
        <Button type="button" color="success" size="sm" onClick={handlePlay}>
          Play
        </Button>
      )}
    </>
  );
};

export default PhrasePlayer;
