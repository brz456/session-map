// src/renderer/components/player/VideoPlayer.tsx
// Wrapper around HTML <video> with controlled props and callbacks

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { buildMediaUrl } from '../../../shared/mediaProtocol';
import { DrawingOverlay } from './DrawingOverlay';
import { formatTime, getImportanceColor } from '../../utils/format';
import { MARKER_NAV_EPSILON_SEC, SEEK_TOLERANCE_SEC } from '../../utils/markerNavConstants';
import type { VideoMarker, VideoPlayerHandle, VideoPlayerProps } from './videoPlayerTypes';
import {
  IconPlay,
  IconPause,
  IconPrev,
  IconNext,
  IconVolumeMuted,
  IconVolumeLow,
  IconVolumeHigh,
} from './icons';

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(props, ref) {
  const {
    activeMediaPath,
    activeMediaId,
    playbackRate,
    initialTime,
    fps,
    markers,
    selectedMarkerIds,
    onPlay,
    onPause,
    onSeeked,
    onRateChange,
    onLoadedMetadata,
    onTimeUpdate,
    onMarkerClick,
    onMoveMarker,
    onDeleteMarker,
    onSeekTo,
    // Drawing props
    drawing,
    drawingMode,
    drawingColor,
    drawingStrokeWidth,
    markerTimeSec,
    snapToTimeSec,
    snapToken,
    onSnapComplete,
    onCommitStroke,
    onRequestSnap,
    sessionActions,
  } = props;

  // Convert selectedMarkerIds to Set for O(1) lookup
  const selectedMarkerIdsSet = new Set(selectedMarkerIds);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const pendingSeekRef = useRef<number>(0); // Stores initial time to seek to after load
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const [markerContextMenu, setMarkerContextMenu] = useState<{ markerId: string; x: number; y: number } | null>(null);
  const markerContextMenuRef = useRef<HTMLDivElement>(null);

  // Marker dragging state for Alt+drag movement
  const [draggingMarker, setDraggingMarker] = useState<{ markerId: string } | null>(null);
  const [dragPreviewTime, setDragPreviewTime] = useState<number | null>(null);
  // Pending move: keeps displaying at target position until marker data catches up
  const [pendingMove, setPendingMove] = useState<{ markerId: string; targetTime: number } | null>(null);

  // Close marker context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (markerContextMenuRef.current && !markerContextMenuRef.current.contains(e.target as Node)) {
        setMarkerContextMenu(null);
      }
    };
    if (markerContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [markerContextMenu]);

  // Marker dragging handlers (Alt+drag to move)
  useEffect(() => {
    if (!draggingMarker) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!scrubberRef.current || duration <= 0) return;

      const padding = getScrubberPadding();
      if (padding === null) return;

      const rect = scrubberRef.current.getBoundingClientRect();
      const trackWidth = rect.width - padding * 2;

      // Calculate new time from mouse position
      const x = e.clientX - rect.left - padding;
      const clampedX = Math.max(0, Math.min(x, trackWidth));
      const newTime = (clampedX / trackWidth) * duration;

      setDragPreviewTime(newTime);
    };

    const handleMouseUp = async () => {
      if (dragPreviewTime !== null && draggingMarker) {
        // Commit the move - only set pending on success to avoid stuck UI on failure
        const success = await onMoveMarker(draggingMarker.markerId, dragPreviewTime);
        if (success) {
          setPendingMove({ markerId: draggingMarker.markerId, targetTime: dragPreviewTime });
        }
      }
      setDraggingMarker(null);
      setDragPreviewTime(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingMarker, dragPreviewTime, duration, onMoveMarker]);

  // Clear pending move when marker position catches up
  useEffect(() => {
    if (!pendingMove) return;
    const marker = markers.find((m) => m.markerId === pendingMove.markerId);
    if (marker && Math.abs(marker.mediaTimeSec - pendingMove.targetTime) < 0.01) {
      setPendingMove(null);
    }
  }, [markers, pendingMove]);

  // Read scrubber padding from CSS (SSoT). Returns null on failure.
  const getScrubberPadding = (): number | null => {
    if (!scrubberRef.current) return null;
    const computedStyle = getComputedStyle(scrubberRef.current);
    const cssValue = computedStyle.getPropertyValue('--scrubber-padding').trim();
    const parsed = parseFloat(cssValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      console.error('[VideoPlayer] Invalid --scrubber-padding CSS value:', cssValue);
      return null;
    }
    return parsed;
  };

  // Hover preview state
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);

  // Snap-to-marker state tracking
  const lastSnapTokenRef = useRef<number>(0);
  const pendingSnapRef = useRef<{ token: number; timeSec: number } | null>(null);

  // Sync playback rate with video element (also re-sync when video changes)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, activeMediaId]);

  // Snap-to-marker effect: when snapToken changes and snapToTimeSec is set, pause and seek
  // Fail-closed: only consume the token after a valid seek is actually initiated
  useEffect(() => {
    // Already handled this token
    if (snapToken === lastSnapTokenRef.current) return;

    // No snap target - this is a valid "no snap requested" state, consume token
    if (snapToTimeSec === null) {
      lastSnapTokenRef.current = snapToken;
      return;
    }

    // Invalid snap time - consume token to prevent infinite retries, log error
    if (!Number.isFinite(snapToTimeSec)) {
      console.error('[VideoPlayer] Invalid snapToTimeSec:', snapToTimeSec);
      lastSnapTokenRef.current = snapToken;
      return;
    }

    // Video element not available - DON'T consume token, allow retry when available
    const video = videoRef.current;
    if (!video) return;

    // Duration not yet known (or invalid) - DON'T consume token, allow retry when metadata loads
    if (!Number.isFinite(duration) || duration <= 0) return;

    // All preconditions met - NOW consume the token and initiate snap
    lastSnapTokenRef.current = snapToken;

    // Store pending snap info for handleSeeked to complete
    pendingSnapRef.current = { token: snapToken, timeSec: snapToTimeSec };

    // Pause and seek (clamped to valid range)
    video.pause();
    video.currentTime = Math.max(0, Math.min(duration, snapToTimeSec));
  }, [snapToken, snapToTimeSec, duration]);

  // Handle video source changes
  useEffect(() => {
    if (videoRef.current && activeMediaPath) {
      // Use shared buildMediaUrl for proper encoding (SSoT)
      // Protocol handler in main process validates path against allowlist
      const mediaUrl = buildMediaUrl(activeMediaPath);

      if (videoRef.current.src !== mediaUrl) {
        // Capture initial time to seek to after video loads
        pendingSeekRef.current = initialTime;
        videoRef.current.src = mediaUrl;
        videoRef.current.load();
        // Reset local state for new video - new videos always start paused
        setIsPaused(true);
        setCurrentTime(initialTime);
        setDuration(0);
        setVideoError(null);
      }
    }
  }, [activeMediaPath, initialTime]);

  const handlePlay = () => {
    setIsPaused(false);
    setVideoError(null); // Clear error on successful playback
    onPlay();
  };

  const handlePause = () => {
    setIsPaused(true);
    onPause();
  };

  const handleSeeked = useCallback(() => {
    onSeeked();

    // Complete pending snap if any
    const pending = pendingSnapRef.current;
    if (pending) {
      pendingSnapRef.current = null;
      onSnapComplete(pending.token);
    }
  }, [onSeeked, onSnapComplete]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const durationSec = videoRef.current.duration;

      // Fail-closed: reject invalid duration (NaN, Infinity, negative)
      if (!Number.isFinite(durationSec) || durationSec < 0) {
        console.error('[VideoPlayer] Invalid duration from video element:', durationSec);
        return;
      }

      setDuration(durationSec);
      // Re-apply playbackRate after video loads (browser resets it to 1 on new source)
      videoRef.current.playbackRate = playbackRate;
      // Seek to saved position (clamped to valid range)
      const seekTime = Math.max(0, Math.min(pendingSeekRef.current, durationSec));
      if (seekTime > 0) {
        videoRef.current.currentTime = seekTime;
        setCurrentTime(seekTime);
      }
      onLoadedMetadata(durationSec);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const currentTimeSec = videoRef.current.currentTime;
      setCurrentTime(currentTimeSec);
      onTimeUpdate(currentTimeSec);
    }
  };

  const handleError = () => {
    if (videoRef.current?.error) {
      const error = videoRef.current.error;
      console.error('[VideoPlayer] Video error:', {
        code: error.code,
        message: error.message,
        src: videoRef.current.src,
      });
      // User-friendly error message
      const message = error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'Media format not supported'
        : error.code === MediaError.MEDIA_ERR_NETWORK
          ? 'Network error loading media'
          : 'Failed to load media';
      setVideoError(message);
    }
  };

  const handleRateSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRate = parseFloat(e.target.value);
    if (Number.isFinite(newRate) && newRate > 0) {
      onRateChange(newRate);
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      // Clear any previous error before retrying playback
      setVideoError(null);
      void videoRef.current.play().catch((err) => {
        console.error('[VideoPlayer] Playback failed:', err);
        setVideoError('Playback failed');
      });
    } else {
      videoRef.current.pause();
    }
  };

  // Shared seek helper: clamps to [0, duration], updates video + state, notifies SSoT
  // Used by both scrubber and marker clicks for consistent behavior
  // Returns true if seek was executed, false otherwise (fail-closed)
  const seekToTime = (timeSec: number): boolean => {
    // Fail-closed: require valid duration (not 0, NaN, Infinity, negative)
    if (!Number.isFinite(duration) || duration <= 0) {
      return false;
    }

    // Fail-closed: reject invalid timeSec
    if (!Number.isFinite(timeSec)) {
      console.error('[VideoPlayer] Invalid seek time:', timeSec);
      return false;
    }

    // Fail-closed: require videoRef before mutating time or notifying SSoT
    if (!videoRef.current) {
      console.error('[VideoPlayer] Cannot seek: video element not available');
      return false;
    }

    // Clamp to valid range - explicit, not relying on browser clamping
    const clampedTime = Math.max(0, Math.min(duration, timeSec));

    // Update video position
    videoRef.current.currentTime = clampedTime;
    // Update local state immediately for responsive UI
    setCurrentTime(clampedTime);
    // Notify parent (SSoT) of seek
    onSeekTo(clampedTime);
    return true;
  };

  const seekRelative = (deltaSec: number) => {
    if (!videoRef.current) return;
    const newTime = videoRef.current.currentTime + deltaSec;
    seekToTime(newTime); // Delegate to SSoT seek path
  };

  // Step one frame forward/backward using fps prop (disabled when fps unavailable)
  const stepFrame = (direction: 1 | -1) => {
    if (!videoRef.current) return;
    // Fail-closed: fps must be provided and valid for frame stepping
    if (fps === undefined) {
      console.warn('[VideoPlayer] stepFrame: fps not available for this media, frame stepping disabled');
      return;
    }
    if (!Number.isFinite(fps) || fps <= 0) {
      console.error('[VideoPlayer] stepFrame: fps must be positive finite number, got:', fps);
      return;
    }
    // Pause video when frame stepping
    if (!videoRef.current.paused) {
      videoRef.current.pause();
    }
    const frameDuration = 1 / fps;
    const newTime = videoRef.current.currentTime + direction * frameDuration;
    seekToTime(newTime);
  };

  // Step playback rate up/down through discrete PLAYBACK_RATES (SSoT)
  const adjustPlaybackRate = (direction: 1 | -1) => {
    // Fail-closed: validate direction
    if (direction !== 1 && direction !== -1) {
      console.error('[VideoPlayer] adjustPlaybackRate: invalid direction, must be 1 or -1');
      return;
    }
    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
    // Fail-closed: current rate must be in PLAYBACK_RATES
    if (currentIndex === -1) {
      console.error('[VideoPlayer] adjustPlaybackRate: current rate not in PLAYBACK_RATES:', playbackRate);
      return;
    }
    const newIndex = Math.max(0, Math.min(PLAYBACK_RATES.length - 1, currentIndex + direction));
    const newRate = PLAYBACK_RATES[newIndex];
    if (newRate !== playbackRate) {
      onRateChange(newRate);
    }
  };

  // Navigate to previous marker (Ctrl+Left behavior)
  // - mode 'time': skip selection logic, go to nearest marker before current time
  // - mode 'selection' (default): use selected markers as anchor
  //   - If played past selected marker: return to it first
  //   - If at/before selected marker: go to previous (no-op at first)
  // - No selection: time-based with boundary snap
  const navigateToPrevMarker = (mode: 'selection' | 'time' = 'selection'): string | null => {
    if (markers.length === 0) return null;

    const video = videoRef.current;
    if (!video) {
      console.error('[VideoPlayer] Cannot navigate: video element not available');
      return null;
    }

    const curr = video.currentTime;

    // Selection-based navigation (skip if mode is 'time')
    if (mode === 'selection' && selectedMarkerIds.length > 0) {
      const selectedIndices = selectedMarkerIds
        .map(id => markers.findIndex(m => m.markerId === id))
        .filter(i => i !== -1);

      if (selectedIndices.length > 0) {
        const earliestIndex = Math.min(...selectedIndices);
        const earliestMarker = markers[earliestIndex];

        // If past the earliest selected marker, return to it
        if (curr > earliestMarker.mediaTimeSec + MARKER_NAV_EPSILON_SEC) {
          if (seekToTime(earliestMarker.mediaTimeSec)) {
            return earliestMarker.markerId;
          }
          return null;
        }

        // At or before earliest: go to previous marker
        if (earliestIndex > 0) {
          const target = markers[earliestIndex - 1];
          if (seekToTime(target.mediaTimeSec)) {
            return target.markerId;
          }
        }
        // At first marker: no-op
        return null;
      }
    }

    // Time-based navigation (no selection)
    const firstMarkerTime = markers[0].mediaTimeSec;
    const lastMarkerTime = markers[markers.length - 1].mediaTimeSec;

    // Before or at first marker: snap to first
    if (curr <= firstMarkerTime + MARKER_NAV_EPSILON_SEC) {
      if (seekToTime(firstMarkerTime)) {
        return markers[0].markerId;
      }
      return null;
    }

    // After all markers: snap to last
    if (curr > lastMarkerTime) {
      if (seekToTime(lastMarkerTime)) {
        return markers[markers.length - 1].markerId;
      }
      return null;
    }

    // Between markers: find previous (small tolerance handles seek imprecision)
    for (let i = markers.length - 1; i >= 0; i--) {
      if (markers[i].mediaTimeSec < curr - SEEK_TOLERANCE_SEC) {
        if (seekToTime(markers[i].mediaTimeSec)) {
          return markers[i].markerId;
        }
        return null;
      }
    }

    return null;
  };

  // Navigate to next marker (Ctrl+Right behavior)
  // - mode 'time': skip selection logic, go to nearest marker after current time
  // - mode 'selection' (default): use selected markers as anchor
  //   - If before selected marker: return to it first
  //   - If at/after selected marker: go to next (no-op at last)
  // - No selection: time-based with boundary snap
  const navigateToNextMarker = (mode: 'selection' | 'time' = 'selection'): string | null => {
    if (markers.length === 0) return null;

    const video = videoRef.current;
    if (!video) {
      console.error('[VideoPlayer] Cannot navigate: video element not available');
      return null;
    }

    const curr = video.currentTime;

    // Selection-based navigation (skip if mode is 'time')
    if (mode === 'selection' && selectedMarkerIds.length > 0) {
      const selectedIndices = selectedMarkerIds
        .map(id => markers.findIndex(m => m.markerId === id))
        .filter(i => i !== -1);

      if (selectedIndices.length > 0) {
        const latestIndex = Math.max(...selectedIndices);
        const latestMarker = markers[latestIndex];

        // If before the latest selected marker, return to it
        if (curr < latestMarker.mediaTimeSec - MARKER_NAV_EPSILON_SEC) {
          if (seekToTime(latestMarker.mediaTimeSec)) {
            return latestMarker.markerId;
          }
          return null;
        }

        // At or after latest: go to next marker
        if (latestIndex < markers.length - 1) {
          const target = markers[latestIndex + 1];
          if (seekToTime(target.mediaTimeSec)) {
            return target.markerId;
          }
        }
        // At last marker: no-op
        return null;
      }
    }

    // Time-based navigation (no selection)
    const firstMarkerTime = markers[0].mediaTimeSec;
    const lastMarkerTime = markers[markers.length - 1].mediaTimeSec;

    // Before first marker: snap to first
    if (curr < firstMarkerTime) {
      if (seekToTime(firstMarkerTime)) {
        return markers[0].markerId;
      }
      return null;
    }

    // At or after last marker: snap to last
    if (curr >= lastMarkerTime - MARKER_NAV_EPSILON_SEC) {
      if (seekToTime(lastMarkerTime)) {
        return markers[markers.length - 1].markerId;
      }
      return null;
    }

    // Between markers: find next (small tolerance handles seek imprecision)
    for (const marker of markers) {
      if (marker.mediaTimeSec > curr + SEEK_TOLERANCE_SEC) {
        if (seekToTime(marker.mediaTimeSec)) {
          return marker.markerId;
        }
        return null;
      }
    }

    return null;
  };

  // UI button handlers: navigate + select
  const seekToPrevMarker = () => {
    const markerId = navigateToPrevMarker();
    if (markerId) {
      onMarkerClick(markerId);
    }
  };

  const seekToNextMarker = () => {
    const markerId = navigateToNextMarker();
    if (markerId) {
      onMarkerClick(markerId);
    }
  };

  // Expose control methods to parent via ref
  useImperativeHandle(ref, () => ({
    togglePlayPause,
    seekRelative,
    seekTo: seekToTime,
    stepFrame,
    adjustPlaybackRate,
    isPaused: () => isPaused,
    getPlaybackRate: () => playbackRate,
    navigateToPrevMarker,
    navigateToNextMarker,
  }));

  // Sync volume with video element (also re-sync when video changes)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted, activeMediaId]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    // Fail-closed: validate before mutating state
    if (!Number.isFinite(newVolume) || newVolume < 0 || newVolume > 1) {
      console.error('[VideoPlayer] Invalid volume value:', e.target.value);
      return;
    }
    setVolume(newVolume);
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  // Seek to position from mouse X coordinate (accounting for padding)
  const seekFromClientX = (clientX: number, padding: number) => {
    if (!scrubberRef.current || duration === 0) return;

    const rect = scrubberRef.current.getBoundingClientRect();
    const trackWidth = rect.width - padding * 2;
    // Fail-closed: abort on invalid trackWidth to prevent Infinity/NaN
    if (!Number.isFinite(trackWidth) || trackWidth <= 0) return;

    const clickX = clientX - rect.left - padding;
    const percentage = Math.max(0, Math.min(1, clickX / trackWidth));
    const newTime = percentage * duration;

    seekToTime(newTime);
  };

  const handleScrubberMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration === 0 || !scrubberRef.current) return;
    e.preventDefault();

    // Read padding from CSS (SSoT); abort on failure
    const padding = getScrubberPadding();
    if (padding === null) return;

    isDraggingRef.current = true;
    seekFromClientX(e.clientX, padding);

    // Attach listeners to document for drag tracking
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (isDraggingRef.current) {
        seekFromClientX(moveEvent.clientX, padding);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const getMarkerPosition = (mediaTimeSec: number): number => {
    if (duration === 0) return 0;
    return (mediaTimeSec / duration) * 100;
  };

  // Handle scrubber mouse move for hover preview
  const handleScrubberMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current || duration === 0 || isDraggingRef.current) return;

    // Read padding from CSS (SSoT); abort on failure
    const padding = getScrubberPadding();
    if (padding === null) return;

    const rect = scrubberRef.current.getBoundingClientRect();
    const trackWidth = rect.width - padding * 2;
    // Fail-closed: abort on invalid trackWidth to prevent Infinity/NaN
    if (!Number.isFinite(trackWidth) || trackWidth <= 0) return;

    const hoverPos = e.clientX - rect.left - padding;
    const percentage = Math.max(0, Math.min(1, hoverPos / trackWidth));
    const time = percentage * duration;

    setHoverTime(time);
    setHoverX(e.clientX - rect.left);
  };

  const handleScrubberMouseLeave = () => {
    setHoverTime(null);
  };

  const renderSessionActionControls = () => {
    if (!sessionActions) {
      return null;
    }

    const {
      sessionStatus,
      isExporting,
      markerCount,
      hasActiveMedia,
      hasFatalClockError,
      onBack,
      onExport,
      onDropMarker,
      onStartRecording,
      onStopRecording,
    } = sessionActions;

    return (
      <div className="video-player__session-actions">
        {(sessionStatus === 'running' || sessionStatus === 'stopping') && (
          <span className="app__marker-count">{markerCount} markers</span>
        )}

        {sessionStatus === 'error' && (
          <button
            type="button"
            className="app__btn app__btn--ghost"
            onClick={onBack}
          >
            Back
          </button>
        )}

        {(sessionStatus === 'stopped' || sessionStatus === 'starting') && (
          <>
            <button
              type="button"
              className="app__btn app__btn--ghost"
              onClick={onBack}
              disabled={sessionStatus === 'starting'}
            >
              Back
            </button>
            <button
              type="button"
              className="app__btn app__btn--ghost"
              onClick={onExport}
              disabled={sessionStatus === 'starting' || isExporting || markerCount === 0}
              title="Export marker stills and clips"
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
            <button
              type="button"
              className="app__btn app__btn--marker"
              onClick={onDropMarker}
              disabled={sessionStatus === 'starting' || !hasActiveMedia}
              title="Drop marker at current time (M)"
            >
              Drop Marker
            </button>
            <button
              type="button"
              className="app__btn app__btn--primary app__btn--record"
              onClick={onStartRecording}
              disabled={sessionStatus === 'starting'}
            >
              {sessionStatus === 'starting' ? 'Starting...' : 'Start Recording'}
            </button>
          </>
        )}

        {(sessionStatus === 'running' || sessionStatus === 'stopping') && (
          <>
            <button
              type="button"
              className="app__btn app__btn--marker"
              onClick={onDropMarker}
              disabled={hasFatalClockError || sessionStatus === 'stopping'}
              title="Drop marker at current time (M)"
            >
              Drop Marker
            </button>
            <button
              type="button"
              className="app__btn app__btn--danger"
              onClick={onStopRecording}
              disabled={sessionStatus === 'stopping'}
            >
              {sessionStatus === 'stopping' ? 'Stopping...' : 'Stop'}
            </button>
          </>
        )}
      </div>
    );
  };

  if (!activeMediaPath) {
    return (
      <div className={`video-player video-player--empty ${sessionActions ? 'video-player--with-session-actions' : ''}`}>
        <div className="video-player__placeholder">
          No media loaded. Import media files to begin.
        </div>
        {sessionActions && (
          <div className="video-player__controls video-player__controls--empty">
            {renderSessionActionControls()}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="video-player">
      {/* Video stage: positions video and drawing overlay together */}
      <div className="video-player__stage">
        <video
          key={activeMediaId ?? 'no-media'}
          ref={videoRef}
          className="video-player__video"
          onClick={togglePlayPause}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeked={handleSeeked}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onError={handleError}
        />
        <DrawingOverlay
          drawing={drawing}
          enabled={drawingMode}
          strokeColor={drawingColor}
          strokeWidth={drawingStrokeWidth}
          videoRef={videoRef}
          markerTimeSec={markerTimeSec}
          onCommitStroke={onCommitStroke}
          onRequestSnap={onRequestSnap}
        />
        {videoError && (
          <div className="video-player__error">
            <span className="video-player__error-icon" aria-hidden="true">!</span>
            <span className="video-player__error-message">{videoError}</span>
          </div>
        )}
      </div>

      {/* Scrubber/Timeline with markers */}
      <div
        ref={scrubberRef}
        className="video-player__scrubber"
        onMouseDown={handleScrubberMouseDown}
        onMouseMove={handleScrubberMouseMove}
        onMouseLeave={handleScrubberMouseLeave}
        style={{ '--progress': duration > 0 ? (currentTime / duration) * 100 : 0 } as React.CSSProperties}
      >
        {/* Progress bar background */}
        <div className="video-player__scrubber-track" />

        {/* Progress bar fill and playhead - only render when duration is known */}
        {duration > 0 && (
          <>
            <div className="video-player__scrubber-progress" />
            <div className="video-player__scrubber-playhead" />
          </>
        )}

        {/* Group bars and markers - only render when duration is known */}
        {duration > 0 && (
          <>
            {/* Group connecting bars - render before markers so they appear behind */}
            {(() => {
              const groupedMarkers = new Map<string, VideoMarker[]>();
              markers.forEach((m) => {
                if (m.groupId) {
                  const group = groupedMarkers.get(m.groupId) || [];
                  group.push(m);
                  groupedMarkers.set(m.groupId, group);
                }
              });

              return Array.from(groupedMarkers.entries()).map(([groupId, groupMarkers]) => {
                if (groupMarkers.length < 2) return null;
                const sorted = [...groupMarkers].sort((a, b) => a.mediaTimeSec - b.mediaTimeSec);
                const minTime = sorted[0].mediaTimeSec;
                const maxTime = sorted[sorted.length - 1].mediaTimeSec;
                const minPos = getMarkerPosition(minTime);
                const maxPos = getMarkerPosition(maxTime);
                const hasSelectedMarker = groupMarkers.some((m) => selectedMarkerIdsSet.has(m.markerId));
                return (
                  <div
                    key={`group-${groupId}`}
                    className={`video-player__group-bar ${hasSelectedMarker ? 'video-player__group-bar--selected' : ''}`}
                    style={{
                      '--group-start': minPos,
                      '--group-end': maxPos,
                    } as React.CSSProperties}
                  />
                );
              });
            })()}

            {/* Markers on timeline */}
            {markers.map((marker) => {
              const isSelected = selectedMarkerIdsSet.has(marker.markerId);
              const isDragging = draggingMarker?.markerId === marker.markerId;
              const isPendingMove = pendingMove?.markerId === marker.markerId;
              const displayTime = isDragging && dragPreviewTime !== null
                ? dragPreviewTime
                : isPendingMove
                  ? pendingMove.targetTime
                  : marker.mediaTimeSec;
              const markerColor = getImportanceColor(marker.importance);
              return (
                <div
                  key={marker.markerId}
                  className={`video-player__marker ${isSelected ? 'video-player__marker--selected' : ''} ${isDragging ? 'video-player__marker--dragging' : ''} ${marker.groupId ? 'video-player__marker--grouped' : ''}`}
                  style={{
                    '--marker-pos': getMarkerPosition(displayTime),
                    borderTopColor: markerColor,
                    color: markerColor,
                  } as React.CSSProperties}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                      e.preventDefault();
                      setDraggingMarker({ markerId: marker.markerId });
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (draggingMarker) return;
                    if (videoRef.current) {
                      videoRef.current.pause();
                    }
                    if (seekToTime(marker.mediaTimeSec)) {
                      onMarkerClick(marker.markerId, e);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMarkerContextMenu({ markerId: marker.markerId, x: e.clientX, y: e.clientY });
                  }}
                  title={marker.note || `Marker at ${formatTime(marker.mediaTimeSec)}${marker.groupId ? ' (grouped)' : ''}`}
                >
                  {isSelected && <span className="video-player__marker-stem" />}
                </div>
              );
            })}
          </>
        )}

        {/* Drag preview tooltip */}
        {draggingMarker && dragPreviewTime !== null && (
          <div
            className="video-player__hover-tooltip video-player__drag-tooltip"
            style={{
              left: `calc(var(--scrubber-padding) + ${getMarkerPosition(dragPreviewTime)} * 1% - ${getMarkerPosition(dragPreviewTime)} * var(--scrubber-padding) * 2 / 100)`,
            }}
          >
            {formatTime(dragPreviewTime)}
          </div>
        )}

        {/* Hover time tooltip */}
        {hoverTime !== null && (
          <div
            className="video-player__hover-tooltip"
            style={{ left: hoverX }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
      </div>

      {/* Controls row */}
      <div className="video-player__controls">
        <button
          type="button"
          className="video-player__btn video-player__btn--seek"
          onClick={() => seekRelative(-5)}
          title="Seek -5s (J)"
        >
          -5s
        </button>
        <button
          type="button"
          className="video-player__btn video-player__btn--seek-small"
          onClick={() => seekRelative(-1)}
          title="Seek -1s (Shift+J)"
        >
          -1s
        </button>
        <button
          type="button"
          className="video-player__btn video-player__btn--play"
          onClick={togglePlayPause}
          title="Play/Pause (Space)"
          aria-label={isPaused ? 'Play' : 'Pause'}
        >
          {isPaused ? <IconPlay /> : <IconPause />}
        </button>
        <button
          type="button"
          className="video-player__btn video-player__btn--seek-small"
          onClick={() => seekRelative(1)}
          title="Seek +1s (Shift+L)"
        >
          +1s
        </button>
        <button
          type="button"
          className="video-player__btn video-player__btn--seek"
          onClick={() => seekRelative(5)}
          title="Seek +5s (L)"
        >
          +5s
        </button>

        <span className="video-player__time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Marker navigation */}
        <button
          type="button"
          className="video-player__btn video-player__btn--marker-nav"
          onClick={seekToPrevMarker}
          disabled={markers.length === 0}
          title="Previous marker"
          aria-label="Previous marker"
        >
          <IconPrev />
        </button>
        <button
          type="button"
          className="video-player__btn video-player__btn--marker-nav"
          onClick={seekToNextMarker}
          disabled={markers.length === 0}
          title="Next marker"
          aria-label="Next marker"
        >
          <IconNext />
        </button>

        {/* Volume controls */}
        <button
          type="button"
          className="video-player__btn video-player__btn--volume"
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted || volume === 0 ? <IconVolumeMuted /> : volume < 0.5 ? <IconVolumeLow /> : <IconVolumeHigh />}
        </button>
        <input
          type="range"
          className="video-player__volume-slider"
          min="0"
          max="1"
          step="0.05"
          value={isMuted ? 0 : volume}
          onChange={handleVolumeChange}
          title="Volume"
          aria-label="Volume"
        />

        <select
          className="video-player__rate-select"
          value={playbackRate}
          onChange={handleRateSelect}
          title="Playback Rate"
          aria-label="Playback rate"
        >
          {PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}x
            </option>
          ))}
        </select>

        {renderSessionActionControls()}
      </div>

      {/* Marker context menu */}
      {markerContextMenu && createPortal(
        <div
          ref={markerContextMenuRef}
          className="video-player__context-menu"
          style={{ top: markerContextMenu.y, left: markerContextMenu.x }}
        >
          <button
            type="button"
            className="video-player__context-menu-item video-player__context-menu-item--danger"
            onClick={() => {
              onDeleteMarker(markerContextMenu.markerId);
              setMarkerContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
});
