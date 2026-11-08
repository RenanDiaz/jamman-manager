/**
 * Footer Player Component
 *
 * The transport panel at the bottom of the main screen. Provides a central
 * place for all audio playback with full controls.
 *
 * Features:
 * - Playback controls (Play/Pause, Stop)
 * - Seek bar
 * - Volume control
 * - Metadata display (patch name, phrase name, duration, file size)
 * - Minimize/maximize functionality
 * - Close button
 */

import { FC, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAudioPlayerStore } from '../../store/useAudioPlayerStore';
import { DisplayWindow, Fader, Legend, Panel, PanelKey, Pill, SevenSegment } from '../../ui';
import { formatTime } from '../../utils/format';
import { PauseIcon, PlayIcon, StopIcon } from '../../utils/Images';
import s from './FooterPlayer.module.css';

/**
 * Formats file size in bytes to human-readable format
 */
const formatFileSize = (bytes: number | null): string => {
  if (bytes === null) return '-- KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const FooterPlayer: FC = () => {
  const {
    audioInfo,
    isPlaying,
    currentTime,
    volume,
    isMinimized,
    play,
    pause,
    stop,
    seek,
    setVolume,
    setCurrentTime,
    setDuration,
    toggleMinimized,
    close,
  } = useAudioPlayerStore();

  const audioRef = useRef<HTMLAudioElement>(null);
  // The resolved URL is kept with the file it belongs to, so it is derived as null as soon as
  // the player closes or switches file, without resetting state inside the effect.
  const [resolved, setResolved] = useState<{ wavPath: string; url: string | null } | null>(null);
  const audioUrl = audioInfo && resolved?.wavPath === audioInfo.wavPath ? resolved.url : null;

  // Load audio when audioInfo changes
  useEffect(() => {
    if (!audioInfo) return;

    const { wavPath } = audioInfo;
    let cancelled = false;
    (async () => {
      try {
        const url = await window.electronAPI.getAudioURL(wavPath);
        if (!cancelled) setResolved({ wavPath, url });
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading audio URL:', error);
        toast.error('Failed to load audio');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audioInfo]);

  // Update duration when audio loads
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const handleLoadedMetadata = () => {
      // Only update duration if it's a valid finite number
      // Custom protocols may report Infinity, so we keep the metadata duration
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      pause();
      audio.currentTime = 0;
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    // Also check if metadata is already loaded
    if (audio.readyState >= 1 && isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioUrl, setDuration, setCurrentTime, pause]);

  // Sync play/pause with audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    if (isPlaying) {
      audio.play().catch(error => {
        console.error('Error playing audio:', error);
        toast.error('Failed to play audio');
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, audioUrl]);

  // Sync volume with audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  // Handle seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    seek(time);
  };

  // Don't render if no audio loaded
  if (!audioInfo) return null;

  const duration = audioInfo.duration ?? 0;
  const elapsed = formatTime(currentTime);

  return (
    <>
      {/* Hidden audio element */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}

      <Panel as="footer" className={s.footer} aria-label="Player">
        {!isMinimized && (
          <Fader
            className={s.seek}
            min={0}
            max={duration}
            step={0.1}
            value={Math.min(currentTime, duration)}
            onChange={handleSeek}
            aria-label="Position"
            disabled={!audioUrl}
          />
        )}

        <div className={s.row}>
          {/* Left: Track Info */}
          <div className={s.info}>
            <PanelKey
              label={isMinimized ? '▲' : '▼'}
              aria-label={isMinimized ? 'Expand player' : 'Minimize player'}
              title={isMinimized ? 'Expand' : 'Minimize'}
              onClick={toggleMinimized}
            />
            <div className={s.track}>
              <div className={s.name}>{audioInfo.patchName || 'Untitled'}</div>
              <div className={s.where}>
                {audioInfo.patchDir}, {audioInfo.phraseName}
              </div>
            </div>
          </div>

          {/* Center: Playback Controls */}
          <div className={s.transport}>
            <PanelKey label={<StopIcon />} aria-label="Stop" onClick={stop} disabled={!audioUrl} />
            <PanelKey
              label={isPlaying ? <PauseIcon /> : <PlayIcon />}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              aria-pressed={isPlaying}
              onClick={() => (isPlaying ? pause() : play())}
              disabled={!audioUrl}
            />
            <DisplayWindow aria-label={`${elapsed} of ${formatTime(audioInfo.duration)}`}>
              <SevenSegment value={elapsed} height={22} />
            </DisplayWindow>
            {!isMinimized && <span className={s.total}>/ {formatTime(audioInfo.duration)}</span>}
          </div>

          {/* Right: Volume & Metadata */}
          <div className={s.right}>
            {!isMinimized && (
              <Pill title="File size">{formatFileSize(audioInfo.fileSizeBytes)}</Pill>
            )}
            <label className={s.level}>
              <Legend>Level</Legend>
              {!isMinimized && (
                <Fader
                  min={0}
                  max={100}
                  value={Math.round(volume * 100)}
                  onChange={e => setVolume(parseInt(e.target.value) / 100)}
                  aria-label="Volume"
                />
              )}
              <span className={s.volume}>{Math.round(volume * 100)}%</span>
            </label>

            {/* Close Button */}
            <PanelKey label="✕" aria-label="Close player" title="Close" onClick={close} />
          </div>
        </div>
      </Panel>
    </>
  );
};
