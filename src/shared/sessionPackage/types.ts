// src/shared/sessionPackage/types.ts
// Session Package — canonical contract between capture app and downstream tooling

export type UUID = string;

// Drawing constants
export const DRAWING_COORDINATE_SPACE = 'video_normalized' as const;
export const DEFAULT_DRAWING_STROKE_WIDTH = 3;
export const MAX_STROKES_PER_MARKER = 200;
export const MAX_POINTS_PER_STROKE = 5000;
export const MIN_POINT_DISTANCE = 0.003;

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  color: string; // hex string "#RRGGBB"
  points: DrawingPoint[];
}

export interface MarkerDrawing {
  coordinateSpace: typeof DRAWING_COORDINATE_SPACE;
  strokeWidth: number;
  strokes: DrawingStroke[];
}

export function newId(): UUID {
  return globalThis.crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** A single recording segment within a session. */
export interface RecordingSegment {
  id: UUID;
  /** Session time when this recording started (offset from t=0). Must be non-negative integer (per timebase). */
  startSessionTimeSec: number;
  /** Duration of this recording in seconds. Must be non-negative integer (per timebase). */
  durationSec: number;
  /**
   * Relative path within session folder, prefixed with "recording/".
   * Runtime validation enforces: non-empty filename, no path traversal (..).
   */
  file: `recording/${string}`;
}

export interface SessionPackage {
  /** Schema version. Only `1` is supported by this app build. */
  version: 1;
  sessionId: UUID;
  /** User-provided session name */
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  platform: {
    os: 'windows';
  };

  /** Explicit session clock definition (required; SSoT for interpreting all sessionTimeSec fields). */
  timebase: {
    /** t=0 is when the first OBS recording started. Session time is continuous across all recordings. */
    origin: 'obs_recording_started';
    /** All session times are stored as integer seconds. */
    timeUnit: 'seconds';
  };

  /** Array of recording segments. Each has a start offset and duration. */
  recordings: RecordingSegment[];

  media: {
    assets: MediaAsset[];
  };

  outline: {
    buckets: Bucket[];
  };

  taxonomy: {
    tags: Tag[];
  };

  telemetry: {
    /**
     * Ordered list of playback events. Must be sorted by sessionTimeSec asc.
     * SSoT for reconstructing playback state DURING RECORDING PERIODS ONLY.
     * Events are only logged while recording is active.
     * For AI analysis: correlates what user was watching with session timeline.
     */
    events: PlaybackEvent[];
  };

  markers: Marker[];

  /** Reference to transcript stored in transcript.json (content is not embedded in session.json). */
  transcript: TranscriptRef | null;

  /**
   * Optional: UI resume state (restored on session reopen).
   * SSoT for playback position OUTSIDE OF RECORDING.
   *
   * Precedence invariant:
   * - During recording: telemetry.events is authoritative for analysis; playbackState may lag.
   * - Outside recording: playbackState is the only persisted source (telemetry not logged).
   *
   * This is NOT redundant: user may browse media without recording, in which case
   * telemetry is empty but playbackState remembers their position.
   */
  playbackState?: {
    /** Last active media ID, or null if no media was selected. */
    activeMediaId: UUID | null;
    /** Map of mediaId -> last playback position in seconds. */
    mediaPositions: Record<UUID, number>;
  };

  /**
   * Optional: Tracks an in-progress recording that hasn't been finalized yet.
   * Used for recovery: if present on session load, the recording was interrupted.
   *
   * Recovery protocol:
   * - If inProgressRecording exists, recording was not cleanly stopped
   * - All markers with anchorSessionTimeSec !== null && anchorSessionTimeSec >= startSessionTimeSec are orphaned
   *   (markers with anchorSessionTimeSec === null were created outside recording and are unaffected)
   * - All telemetry with sessionTimeSec >= startSessionTimeSec are orphaned
   * - Recovery should: remove orphaned data, clear this field, save session
   *
   * Lifecycle:
   * - Set when recording starts (before OBS starts)
   * - Cleared when recording stops successfully (after segment saved)
   */
  inProgressRecording?: {
    /** Recording segment ID (will become RecordingSegment.id on success). */
    id: UUID;
    /** Session time when this recording started. */
    startSessionTimeSec: number;
  };
}

export interface TranscriptRef {
  relativePath: 'transcript.json';
}

export interface MediaAsset {
  mediaId: UUID;
  displayName: string;
  absolutePath: string;
  /** Filesystem creation timestamp captured at import time (ISO-8601). */
  createdAtIso?: string;
  /** Optional, populated later: duration in seconds. */
  durationSec?: number;
  /** Optional, populated later: frames per second (required for frame stepping). */
  fps?: number;
  /** Optional, populated later: additional metadata if available. */
  metadata?: Record<string, unknown>;
}

export interface Bucket {
  bucketId: UUID;
  title: string;
  sortIndex: number;
  description?: string;
}

export interface Tag {
  tagId: UUID;
  name: string;
  aliases?: string[];
  color?: string;
}

export const PLAYBACK_EVENT_TYPES = ['load', 'play', 'pause', 'seek', 'rate', 'tick'] as const;
export type PlaybackEventType = (typeof PLAYBACK_EVENT_TYPES)[number];

export interface PlaybackEventBase {
  sessionTimeSec: number;
  type: PlaybackEventType;
  playbackRate: number;
}

/**
 * No-media state is represented explicitly and is only valid for type: 'load'.
 * All other events must have mediaId + mediaTimeSec.
 */
export type PlaybackEvent =
  | (PlaybackEventBase & { type: 'load'; mediaId: null; mediaTimeSec: null })
  | (PlaybackEventBase & { mediaId: UUID; mediaTimeSec: number });

/** Same contract as PlaybackEvent: if mediaId is present, mediaTimeSec must be present. */
export type PlaybackSnapshot =
  | { mediaId: UUID; mediaTimeSec: number; playbackRate: number; paused: boolean }
  | { mediaId: null; mediaTimeSec: null; playbackRate: number; paused: boolean };

export const MARKER_SOURCE_TYPES = ['video', 'browser', 'whiteboard'] as const;

export interface Marker {
  markerId: UUID;
  createdAtIso: string;

  /**
   * Point anchor in canonical session time.
   * Optional: null when marker created outside of recording (e.g., pre-marking clips).
   * When null, the marker is a spatial annotation without a session time anchor.
   */
  anchorSessionTimeSec: number | null;

  /** Where this marker originated (drives presentation/rendering). */
  sourceType: (typeof MARKER_SOURCE_TYPES)[number];

  /** Captured playback snapshot at marker creation for trivial later mapping. */
  playbackSnapshot: PlaybackSnapshot;

  /** Course intent */
  bucketId: UUID | null;
  tagIds: UUID[];
  importance: 1 | 2 | 3;

  /** Optional: quick intent note (NOT evidence, just user intent). */
  note?: string;

  /**
   * Optional: evidence links after transcript import.
   * Supports linking to transcript sections and utterances by generated IDs.
   */
  transcriptRefs?: {
    sectionIds?: string[];
    utteranceIds?: string[];
  };

  /** Optional: freehand drawing overlay in normalized video coordinates. */
  drawing?: MarkerDrawing;

  /** Optional: group ID for linked markers. Markers with same groupId are linked. */
  groupId?: UUID;
}

export interface Transcript {
  /** Stable provider identifier, e.g. "internal-transcript-tool" (known providers first). */
  provider: 'internal-transcript-tool' | string;
  importedAtIso: string;

  /**
   * Sections are higher-level topic groupings produced by the transcript tool.
   * They are helpful metadata but NOT SSoT.
   */
  sections: TranscriptSection[];

  /**
   * Utterances are the atomic transcript units (speaker + start/end + text).
   * IDs are generated deterministically on import.
   */
  utterances: TranscriptUtterance[];

  speakers: TranscriptSpeaker[];
}

export interface TranscriptSection {
  /** Deterministic ID generated on import, e.g. "section_0001". */
  sectionId: string;
  /** Provider-native identifier/label if available (e.g. "3.2"). */
  providerKey?: string;
  title: string;
  startTimeSec: number;
  endTimeSec: number;
  summaryBullets: string[];
  decisions?: string[];
  importantFacts?: string[];
  actionItems?: string[];
}

export interface TranscriptUtterance {
  /** Deterministic ID generated on import. */
  utteranceId: string;
  speakerId: string;
  startTimeSec: number;
  endTimeSec: number;
  text: string;
}

export interface TranscriptSpeaker {
  speakerId: string;
  displayName?: string;
}
