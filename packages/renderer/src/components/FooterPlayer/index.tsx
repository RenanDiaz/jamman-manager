/**
 * Footer Player Component
 *
 * A persistent audio player that appears at the bottom of the screen
 * (YouTube Music style). Provides a central place for all audio playback
 * with waveform visualization and full controls.
 *
 * Features:
 * - Waveform visualization with WaveSurfer.js
 * - Playback controls (Play/Pause, Stop)
 * - Seek bar with waveform interaction
 * - Volume control
 * - Metadata display (patch name, phrase name, duration, file size)
 * - Minimize/maximize functionality
 * - Close button
 */

import { FC, useEffect, useRef, useState } from 'react';
import { Button, ButtonGroup, Progress } from 'reactstrap';
import { toast } from 'react-toastify';
import WaveSurfer from 'wavesurfer.js';
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
    isLoading,
    currentTime,
    volume,
    isMinimized,
    play,
    pause,
    stop,
    seek,
    setVolume,
    setLoading,
    setCurrentTime,
    setDuration,
    toggleMinimized,
    close,
  } = useAudioPlayerStore();

  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Initialize WaveSurfer when audio is loaded
  useEffect(() => {
    if (!audioInfo || !waveformRef.current) return;

    setLoading(true);
    setIsReady(false);

    // Create WaveSurfer instance
    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#6c757d',
      progressColor: '#0d6efd',
      cursorColor: '#0d6efd',
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 80,
      normalize: true,
      backend: 'WebAudio',
    });

    wavesurferRef.current = ws;

    // Load audio URL
    (async () => {
      try {
        const url = await window.electronAPI.getAudioURL(audioInfo.wavPath);
        if (!url) {
          toast.error('Failed to load audio file');
          setLoading(false);
          return;
        }

        await ws.load(url);
      } catch (error) {
        console.error('Error loading audio:', error);
        toast.error('Failed to load audio');
        setLoading(false);
      }
    })();

    // Event listeners
    ws.on('ready', () => {
      console.log('WaveSurfer ready');
      setIsReady(true);
      setLoading(false);
      setDuration(ws.getDuration());
    });

    ws.on('audioprocess', () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on('finish', () => {
      pause();
      ws.seekTo(0);
    });

    ws.on('error', error => {
      console.error('WaveSurfer error:', error);
      toast.error('Audio playback error');
      setLoading(false);
    });

    // Cleanup
    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [audioInfo, setLoading, setDuration, setCurrentTime, pause]);

  // Sync play/pause with WaveSurfer
  useEffect(() => {
    if (!wavesurferRef.current || !isReady) return;

    if (isPlaying) {
      wavesurferRef.current.play();
    } else {
      wavesurferRef.current.pause();
    }
  }, [isPlaying, isReady]);

  // Sync volume with WaveSurfer
  useEffect(() => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.setVolume(volume);
  }, [volume]);

  // Handle seek
  const handleSeek = (time: number) => {
    if (!wavesurferRef.current || !audioInfo?.duration) return;
    const position = time / audioInfo.duration;
    wavesurferRef.current.seekTo(position);
    seek(time);
  };

  // Don't render if no audio loaded
  if (!audioInfo) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#212529',
        borderTop: '1px solid #495057',
        zIndex: 1000,
        transition: 'height 0.3s ease',
        height: isMinimized ? '60px' : '200px',
      }}
    >
      <div className="container-fluid h-100 d-flex flex-column">
        {/* Header */}
        <div className="d-flex align-items-center justify-content-between py-2 border-bottom border-secondary">
          <div className="d-flex align-items-center gap-2">
            <Button
              size="sm"
              color="link"
              className="text-white p-0"
              onClick={toggleMinimized}
              title={isMinimized ? 'Expand' : 'Minimize'}
            >
              {isMinimized ? '▲' : '▼'}
            </Button>
            <div>
              <div className="fw-bold" style={{ fontSize: '0.9rem' }}>
                {audioInfo.patchName}
              </div>
              <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                {audioInfo.patchDir} → {audioInfo.phraseName}
              </div>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            {!isMinimized && (
              <>
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                  ⏱️ {formatTime(audioInfo.duration)}
                </span>
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                  📦 {formatFileSize(audioInfo.fileSizeBytes)}
                </span>
              </>
            )}
            <Button size="sm" color="link" className="text-white p-0" onClick={close} title="Close">
              ✕
            </Button>
          </div>
        </div>

        {/* Main Content - Hidden when minimized */}
        {!isMinimized && (
          <div className="flex-grow-1 d-flex flex-column justify-content-center py-2">
            {/* Waveform */}
            <div className="mb-2">
              <div ref={waveformRef} style={{ opacity: isLoading ? 0.5 : 1 }} />
            </div>

            {/* Controls */}
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center gap-3">
                {/* Playback Controls */}
                <ButtonGroup size="sm">
                  <Button
                    color="primary"
                    onClick={() => (isPlaying ? pause() : play())}
                    disabled={isLoading || !isReady}
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </Button>
                  <Button color="secondary" onClick={stop} disabled={isLoading || !isReady}>
                    <StopIcon />
                  </Button>
                </ButtonGroup>

                {/* Time Display */}
                <div style={{ fontSize: '0.85rem', minWidth: '100px' }}>
                  <span className="text-white">{formatTime(currentTime)}</span>
                  <span className="text-muted"> / {formatTime(audioInfo.duration)}</span>
                </div>
              </div>

              {/* Volume Control */}
              <div className="d-flex align-items-center gap-2" style={{ width: '150px' }}>
                <span style={{ fontSize: '0.85rem' }}>🔊</span>
                <input
                  type="range"
                  className="form-range"
                  min="0"
                  max="100"
                  value={volume * 100}
                  onChange={e => setVolume(parseInt(e.target.value) / 100)}
                  style={{ width: '100px' }}
                />
                <span style={{ fontSize: '0.75rem', minWidth: '35px' }}>
                  {Math.round(volume * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Minimized View - Only show playback controls */}
        {isMinimized && (
          <div className="flex-grow-1 d-flex align-items-center justify-content-between">
            <ButtonGroup size="sm">
              <Button
                color="primary"
                onClick={() => (isPlaying ? pause() : play())}
                disabled={isLoading || !isReady}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </Button>
              <Button color="secondary" onClick={stop} disabled={isLoading || !isReady}>
                <StopIcon />
              </Button>
            </ButtonGroup>

            <div style={{ fontSize: '0.85rem' }}>
              <span className="text-white">{formatTime(currentTime)}</span>
              <span className="text-muted"> / {formatTime(audioInfo.duration)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
