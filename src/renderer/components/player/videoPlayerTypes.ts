import type { UUID, MarkerDrawing, DrawingStroke } from '../../../shared/sessionPackage/types';
import type { SessionStatus } from '../../app/appTypes';

/** Marker with its position in video time (pre-filtered to current video) */
export interface VideoMarker {
  markerId: string;
  mediaTimeSec: number;
  importance: 1 | 2 | 3;
  note?: string;
  /** Optional: group ID for linked markers */
  groupId?: string;
}

/** Methods exposed via ref */
export interface VideoPlayerHandle {
  togglePlayPause: () => void;
  seekRelative: (deltaSec: number) => void;
  seekTo: (timeSec: number) => void;
  /** Step forward/backward by one frame using fps prop */
  stepFrame: (direction: 1 | -1) => void;
  /** Step playback rate up/down through discrete PLAYBACK_RATES */
  adjustPlaybackRate: (direction: 1 | -1) => void;
  /** Returns true if video is paused */
  isPaused: () => boolean;
  /** Get current playback rate */
  getPlaybackRate: () => number;
  /**
   * Navigate to previous marker. Returns markerId if found and seeked, null otherwise.
   * @param mode - 'selection': use selected markers as anchor (default), 'time': pure time-based navigation
   */
  navigateToPrevMarker: (mode?: 'selection' | 'time') => string | null;
  /**
   * Navigate to next marker. Returns markerId if found and seeked, null otherwise.
   * @param mode - 'selection': use selected markers as anchor (default), 'time': pure time-based navigation
   */
  navigateToNextMarker: (mode?: 'selection' | 'time') => string | null;
}

export interface VideoPlayerProps {
  activeMediaPath: string | null;
  activeMediaId: UUID | null;
  playbackRate: number;
  /** Initial time to seek to when video loads (for resuming position) */
  initialTime: number;
  /** Frames per second for frame stepping (optional; frame stepping disabled when unavailable) */
  fps?: number;
  /** Markers for the currently active video (filtered by parent). Must be sorted by mediaTimeSec ascending. */
  markers: VideoMarker[];
  /** Selected marker IDs (multi-select support) */
  selectedMarkerIds: string[];
  onPlay(): void;
  onPause(): void;
  onSeeked(): void;
  onRateChange(newRate: number): void;
  onLoadedMetadata(durationSec: number): void;
  onTimeUpdate(currentTimeSec: number): void;
  /** Marker click with optional event for modifier key detection */
  onMarkerClick(markerId: string, event?: React.MouseEvent): void;
  /** Move marker to new timestamp (Alt+drag). Returns true on success. */
  onMoveMarker(markerId: string, newTimeSec: number): Promise<boolean>;
  onDeleteMarker(markerId: string): void;
  onSeekTo(timeSec: number): void;

  // Drawing props
  drawing: MarkerDrawing | null;
  drawingMode: boolean;
  drawingColor: string;
  drawingStrokeWidth: number;
  /** Marker's media time for snap-on-draw check */
  markerTimeSec: number | null;
  /** Time to snap to when snapToken changes (used for export positioning) */
  snapToTimeSec: number | null;
  /** Increment to trigger snap; changed = snap pending */
  snapToken: number;
  /** Called after video has seeked and paused at snapToTimeSec */
  onSnapComplete(token: number): void;
  /** Called when user finishes drawing a stroke */
  onCommitStroke(stroke: DrawingStroke): void;
  /** Called when user tries to draw but not at marker time */
  onRequestSnap(): void;
  /** Optional session-level actions rendered alongside player controls. */
  sessionActions?: {
    sessionStatus: SessionStatus;
    isExporting: boolean;
    markerCount: number;
    hasActiveMedia: boolean;
    hasFatalClockError: boolean;
    onBack(): void;
    onExport(): void;
    onDropMarker(): void;
    onStartRecording(): void;
    onStopRecording(): void;
  };
}
