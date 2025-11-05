/**
 * Footer Player Component
 *
 * A persistent audio player that appears at the bottom of the screen
 * (YouTube Music style). Provides a central place for all audio playback
 * with full controls.
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
import { Button } from 'reactstrap';
import { toast } from 'react-toastify';
import { useAudioPlayerStore } from '../../store/useAudioPlayerStore';
import { PauseIcon, PlayIcon, StopIcon } from '../../utils/Images';

/**
 * Formats duration in seconds to MM:SS format
 */
const formatTime = (seconds: number | null): string => {
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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Load audio when audioInfo changes
  useEffect(() => {
    if (!audioInfo) {
      setAudioUrl(null);
      return;
    }

    // Get audio URL
    (async () => {
      try {
        const url = await window.electronAPI.getAudioURL(audioInfo.wavPath);
        setAudioUrl(url);
      } catch (error) {
        console.error('Error loading audio URL:', error);
        toast.error('Failed to load audio');
      }
    })();
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

  return (
    <>
      {/* Hidden audio element */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#181818',
          borderTop: '1px solid #282828',
          zIndex: 1000,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          height: isMinimized ? '72px' : '120px',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
        }}
      >
        <div className="h-100 d-flex flex-column">
          {/* Seek Bar - Always on top */}
          {!isMinimized && (
            <div style={{ padding: '0 16px', paddingTop: '8px' }}>
              <input
                type="range"
                className="form-range"
                min="0"
                max={audioInfo.duration || 0}
                step="0.1"
                value={currentTime}
                onChange={handleSeek}
                style={{
                  width: '100%',
                  height: '4px',
                  cursor: 'pointer',
                }}
              />
            </div>
          )}

          {/* Main Content */}
          <div className="flex-grow-1 d-flex align-items-center px-4">
            <div className="d-flex align-items-center justify-content-between w-100">
              {/* Left: Track Info */}
              <div
                className="d-flex align-items-center gap-3"
                style={{ minWidth: 0, flex: '0 1 30%' }}
              >
                <Button
                  size="sm"
                  color="link"
                  className="text-white p-0"
                  onClick={toggleMinimized}
                  title={isMinimized ? 'Expand' : 'Minimize'}
                  style={{
                    opacity: 0.6,
                    fontSize: '1.2rem',
                    transition: 'opacity 0.2s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
                >
                  {isMinimized ? '▲' : '▼'}
                </Button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    className="text-truncate fw-semibold"
                    style={{ fontSize: '0.9rem', color: '#fff', marginBottom: '2px' }}
                  >
                    {audioInfo.patchName}
                  </div>
                  <div className="text-truncate" style={{ fontSize: '0.75rem', color: '#b3b3b3' }}>
                    {audioInfo.patchDir} → {audioInfo.phraseName}
                  </div>
                </div>
              </div>

              {/* Center: Playback Controls */}
              <div
                className="d-flex flex-column align-items-center gap-2"
                style={{ flex: '0 1 40%' }}
              >
                <div className="d-flex align-items-center gap-2">
                  {/* Stop Button */}
                  <button
                    onClick={stop}
                    disabled={!audioUrl}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#b3b3b3',
                      cursor: audioUrl ? 'pointer' : 'not-allowed',
                      padding: '8px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s',
                      opacity: audioUrl ? 1 : 0.3,
                    }}
                    onMouseEnter={e => {
                      if (audioUrl) {
                        e.currentTarget.style.color = '#fff';
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                      }
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = '#b3b3b3';
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <StopIcon />
                  </button>

                  {/* Play/Pause Button */}
                  <button
                    onClick={() => (isPlaying ? pause() : play())}
                    disabled={!audioUrl}
                    style={{
                      background: '#fff',
                      border: 'none',
                      color: '#000',
                      cursor: audioUrl ? 'pointer' : 'not-allowed',
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s',
                      opacity: audioUrl ? 1 : 0.3,
                    }}
                    onMouseEnter={e => {
                      if (audioUrl) e.currentTarget.style.transform = 'scale(1.06)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>
                </div>

                {/* Time Display */}
                {!isMinimized && (
                  <div style={{ fontSize: '0.75rem', color: '#b3b3b3', whiteSpace: 'nowrap' }}>
                    {formatTime(currentTime)} / {formatTime(audioInfo.duration)}
                  </div>
                )}
              </div>

              {/* Right: Volume & Metadata */}
              <div
                className="d-flex align-items-center justify-content-end gap-3"
                style={{ flex: '0 1 30%' }}
              >
                {!isMinimized && (
                  <>
                    <span
                      className="badge bg-dark"
                      style={{ fontSize: '0.7rem', color: '#b3b3b3' }}
                    >
                      ⏱️ {formatTime(audioInfo.duration)}
                    </span>
                    <span
                      className="badge bg-dark"
                      style={{ fontSize: '0.7rem', color: '#b3b3b3' }}
                    >
                      📦 {formatFileSize(audioInfo.fileSizeBytes)}
                    </span>
                  </>
                )}

                {/* Volume Control */}
                <div className="d-flex align-items-center gap-2">
                  <span style={{ fontSize: '1.1rem', opacity: 0.7 }}>🔊</span>
                  {!isMinimized && (
                    <>
                      <input
                        type="range"
                        className="form-range"
                        min="0"
                        max="100"
                        value={volume * 100}
                        onChange={e => setVolume(parseInt(e.target.value) / 100)}
                        style={{ width: '80px', height: '4px', cursor: 'pointer' }}
                      />
                      <span
                        style={{
                          fontSize: '0.75rem',
                          color: '#b3b3b3',
                          minWidth: '35px',
                          textAlign: 'right',
                        }}
                      >
                        {Math.round(volume * 100)}%
                      </span>
                    </>
                  )}
                </div>

                {/* Close Button */}
                <Button
                  size="sm"
                  color="link"
                  className="text-white p-0"
                  onClick={close}
                  title="Close"
                  style={{
                    opacity: 0.6,
                    fontSize: '1.3rem',
                    transition: 'opacity 0.2s',
                    marginLeft: '8px',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
                >
                  ✕
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
