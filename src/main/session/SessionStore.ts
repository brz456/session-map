// src/main/session/SessionStore.ts
// Session state management with atomic persistence

import {
  SessionPackage,
  RecordingSegment,
  MediaAsset,
  Bucket,
  Tag,
  PlaybackEvent,
  Marker,
  TranscriptRef,
  nowIso,
} from '../../shared/sessionPackage/types';
import type { SessionUiSnapshot } from '../../shared/ipc/sessionUi';
import { validateSessionPackage, type SessionValidationErrorCode } from '../../shared/sessionPackage/validate';
import { toSessionUiSnapshot } from './toSessionUiSnapshot';
import type {
  SessionCreateResult,
  SessionSaveResult,
  SessionLoadResult,
  SessionCloseResult,
  SessionUpdateResult,
  AccumulatedSessionTimeResult,
  MediaReferenceCountResult,
  SessionErrorCode,
} from '../../shared/ipc/types';
import {
  closeSession,
  createSession,
  loadSession,
  renameSession,
  saveSession,
} from './sessionMutators/sessionLifecycle';
import {
  addRecordingSegment,
  clearInProgressRecording,
  cleanupInterruptedRecording,
  getAccumulatedSessionTime,
  hasInProgressRecording,
  setInProgressRecording,
} from './sessionMutators/recordingMutators';
import {
  addMediaAsset,
  getMediaReferenceCount,
  removeMediaAsset,
} from './sessionMutators/mediaMutators';
import {
  addBucket,
  forceRemoveBucket,
  getBucketReferenceCount,
  removeBucket,
  reorderBucket,
  updateBucket,
} from './sessionMutators/bucketMutators';
import {
  addTag,
  forceRemoveTag,
  getTagReferenceCount,
  removeTag,
  updateTag,
} from './sessionMutators/tagMutators';
import { addMarker, removeMarker, updateMarker } from './sessionMutators/markerMutators';
import {
  addPlaybackEvent,
  setPlaybackState,
  setTranscriptRef,
} from './sessionMutators/playbackMutators';
import type { SessionStoreMutatorContext } from './sessionMutators/types';

/**
 * Maps SessionValidationErrorCode to SessionErrorCode for IPC contract consistency.
 */
function mapValidationErrorCode(code: SessionValidationErrorCode): SessionErrorCode {
  switch (code) {
    case 'duplicate_media_path':
      return 'media_duplicate_path';
    case 'telemetry_not_sorted':
      return 'telemetry_time_regression';
    default:
      return 'invalid_input';
  }
}

export type GetFullSessionResult =
  | { ok: true; session: SessionPackage }
  | { ok: false; code: 'no_active_session'; message: string };

export type GetUiSessionResult = {
  ok: true;
  session: SessionUiSnapshot | null;
  sessionDir: string | null;
  uiRevision: number;
};

/**
 * SessionStore manages the current active session.
 *
 * Invariants:
 * - At most one session is active at a time.
 * - Mutations are in-memory only; persistence occurs via explicit save().
 * - All externally-driven mutators validate via validateSessionPackage (SSoT)
 *   before committing, ensuring this.currentSession is always schema-valid.
 */
export class SessionStore {
  private currentSession: SessionPackage | null = null;
  private currentSessionDir: string | null = null;
  private uiRevision = 0;

  /**
   * Validates a prospective session state and commits only on success.
   * SSoT helper: ensures this.currentSession is always schema-valid.
   * Maps validation error codes to SessionErrorCodes for IPC contract consistency.
   */
  private commitValidated(
    nextSession: unknown,
    options?: { bumpUiRevision?: boolean }
  ): SessionUpdateResult {
    const validation = validateSessionPackage(nextSession);
    if (!validation.ok) {
      return {
        ok: false,
        code: mapValidationErrorCode(validation.code),
        message: validation.message,
      };
    }
    const shouldBumpUi = options?.bumpUiRevision !== false;
    if (shouldBumpUi) {
      validation.session.updatedAtIso = nowIso();
    }
    this.currentSession = validation.session;
    if (shouldBumpUi) {
      this.uiRevision += 1;
    }
    return { ok: true };
  }

  private getMutatorContext(): SessionStoreMutatorContext {
    return {
      getCurrentSession: () => this.currentSession,
      setCurrentSession: (session) => {
        this.currentSession = session;
      },
      getCurrentSessionDir: () => this.currentSessionDir,
      setCurrentSessionDir: (dir) => {
        this.currentSessionDir = dir;
      },
      getUiRevision: () => this.uiRevision,
      bumpUiRevision: () => {
        this.uiRevision += 1;
        return this.uiRevision;
      },
      commitValidated: this.commitValidated.bind(this),
    };
  }

  /**
   * Creates a new session in the specified base directory.
   *
   * @param baseDir - Parent directory where sessions are stored
   * @returns Result with sessionId and sessionDir on success
   *
   * Behavior:
   * - Fails if a session is already active.
   * - Creates a new directory: baseDir/{sessionId}/
   * - Creates session.json and recording/ subdirectory.
   */
  async create(baseDir: string, name: string): Promise<SessionCreateResult> {
    return createSession(this.getMutatorContext(), baseDir, name);
  }

  /**
   * Loads an existing session from a session directory.
   *
   * @param sessionDir - Path to session directory containing session.json
   */
  async load(sessionDir: string): Promise<SessionLoadResult> {
    return loadSession(this.getMutatorContext(), sessionDir);
  }

  /**
   * Closes the current session without saving.
   * Call save() first if you need to persist unsaved changes.
   */
  close(): SessionCloseResult {
    return closeSession(this.getMutatorContext());
  }

  /**
   * Returns the full session if one is active (internal callers only).
   */
  getFull(): GetFullSessionResult {
    if (this.currentSession === null) {
      return {
        ok: false,
        code: 'no_active_session',
        message: 'No active session',
      };
    }

    return { ok: true, session: this.currentSession };
  }

  /**
   * Returns a telemetry-free UI snapshot (renderer hydration).
   */
  getUi(): GetUiSessionResult {
    return {
      ok: true,
      session: this.currentSession ? toSessionUiSnapshot(this.currentSession) : null,
      sessionDir: this.currentSessionDir,
      uiRevision: this.uiRevision,
    };
  }

  /**
   * Renames the current session.
   */
  rename(newName: string): SessionUpdateResult {
    return renameSession(this.getMutatorContext(), newName);
  }

  /**
   * Returns whether a session is currently active.
   */
  hasActiveSession(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Returns the current session directory, or null if no session is active.
   */
  getSessionDir(): string | null {
    return this.currentSessionDir;
  }

  /**
   * Persists the current session to disk.
   * Validates the session before writing to ensure SSoT integrity.
   */
  async save(): Promise<SessionSaveResult> {
    return saveSession(this.getMutatorContext());
  }

  /**
   * Adds a recording segment to the session.
   * Call this when a recording stops to store segment metadata.
   *
   * IMPORTANT: Also atomically clears inProgressRecording if present.
   * This ensures validation passes (inProgressRecording.startSessionTimeSec must equal
   * accumulated time, which changes after segment is added).
   */
  addRecordingSegment(segment: RecordingSegment): SessionUpdateResult {
    return addRecordingSegment(this.getMutatorContext(), segment);
  }

  /**
   * Returns the total accumulated session time from all recordings.
   * Used to determine the offset for starting a new recording.
   */
  getAccumulatedSessionTime(): AccumulatedSessionTimeResult {
    return getAccumulatedSessionTime(this.getMutatorContext());
  }

  // --- In-Progress Recording Operations ---

  /**
   * Sets the in-progress recording state. Call BEFORE starting OBS recording.
   * This persists the recording intent so recovery can clean up orphaned data
   * if the recording is interrupted (crash, sleep/wake, etc.).
   *
   * @param id - UUID for the recording segment (will become RecordingSegment.id on success)
   * @param startSessionTimeSec - Session time when recording starts (must match accumulated time)
   */
  setInProgressRecording(id: string, startSessionTimeSec: number): SessionUpdateResult {
    return setInProgressRecording(this.getMutatorContext(), id, startSessionTimeSec);
  }

  /**
   * Clears the in-progress recording state. Call AFTER recording stops successfully
   * and the recording segment has been added.
   */
  clearInProgressRecording(): SessionUpdateResult {
    return clearInProgressRecording(this.getMutatorContext());
  }

  /**
   * Cleans up orphaned data from an interrupted recording.
   * Call during recovery when inProgressRecording exists.
   *
   * Removes:
   * - All markers with anchorSessionTimeSec >= inProgressRecording.startSessionTimeSec
   * - All telemetry events with sessionTimeSec >= inProgressRecording.startSessionTimeSec
   * - The inProgressRecording field itself
   *
   * @returns The number of markers and events removed, or error
   */
  cleanupInterruptedRecording(): SessionUpdateResult & { markersRemoved?: number; eventsRemoved?: number } {
    return cleanupInterruptedRecording(this.getMutatorContext());
  }

  /**
   * Returns whether there is an in-progress recording (indicates interrupted recording on load).
   */
  hasInProgressRecording(): boolean {
    return hasInProgressRecording(this.getMutatorContext());
  }

  // --- Media Asset Operations ---

  addMediaAsset(asset: MediaAsset): SessionUpdateResult {
    return addMediaAsset(this.getMutatorContext(), asset);
  }

  removeMediaAsset(mediaId: string): SessionUpdateResult {
    return removeMediaAsset(this.getMutatorContext(), mediaId);
  }

  getMediaReferenceCount(mediaId: string): MediaReferenceCountResult {
    return getMediaReferenceCount(this.getMutatorContext(), mediaId);
  }

  // --- Bucket Operations ---

  addBucket(bucket: Bucket): SessionUpdateResult {
    return addBucket(this.getMutatorContext(), bucket);
  }

  removeBucket(bucketId: string): SessionUpdateResult {
    return removeBucket(this.getMutatorContext(), bucketId);
  }

  reorderBucket(bucketId: string, newIndex: number): SessionUpdateResult {
    return reorderBucket(this.getMutatorContext(), bucketId, newIndex);
  }

  updateBucket(
    bucketId: string,
    patch: Partial<Pick<Bucket, 'title' | 'description' | 'sortIndex'>>
  ): SessionUpdateResult {
    return updateBucket(this.getMutatorContext(), bucketId, patch);
  }

  // --- Tag Operations ---

  addTag(tag: Tag): SessionUpdateResult {
    return addTag(this.getMutatorContext(), tag);
  }

  removeTag(tagId: string): SessionUpdateResult {
    return removeTag(this.getMutatorContext(), tagId);
  }

  updateTag(
    tagId: string,
    patch: Partial<Pick<Tag, 'name' | 'color'>>
  ): SessionUpdateResult {
    return updateTag(this.getMutatorContext(), tagId, patch);
  }

  /**
   * Returns the count of markers that reference a tag.
   */
  getTagReferenceCount(tagId: string): { ok: true; count: number } | { ok: false; code: string; message: string } {
    return getTagReferenceCount(this.getMutatorContext(), tagId);
  }

  /**
   * Returns the count of markers that reference a bucket.
   */
  getBucketReferenceCount(bucketId: string): { ok: true; count: number } | { ok: false; code: string; message: string } {
    return getBucketReferenceCount(this.getMutatorContext(), bucketId);
  }

  /**
   * Force-removes a tag, first removing it from any markers that reference it.
   * Returns the count of affected markers.
   */
  forceRemoveTag(tagId: string): SessionUpdateResult & { affectedMarkers?: number } {
    return forceRemoveTag(this.getMutatorContext(), tagId);
  }

  /**
   * Force-removes a bucket, first clearing bucketId from any markers that reference it.
   * Returns the count of affected markers.
   */
  forceRemoveBucket(bucketId: string): SessionUpdateResult & { affectedMarkers?: number } {
    return forceRemoveBucket(this.getMutatorContext(), bucketId);
  }

  // --- Marker Operations ---

  addMarker(marker: Marker): SessionUpdateResult {
    return addMarker(this.getMutatorContext(), marker);
  }

  removeMarker(markerId: string): SessionUpdateResult {
    return removeMarker(this.getMutatorContext(), markerId);
  }

  updateMarker(
    markerId: string,
    patch: Partial<Pick<Marker, 'bucketId' | 'tagIds' | 'importance' | 'note'>> & {
      // drawing: undefined = ignore, null = clear, MarkerDrawing = set
      drawing?: Marker['drawing'] | null;
      // mediaTimeSec: update playbackSnapshot.mediaTimeSec for marker movement
      mediaTimeSec?: number;
      // groupId: undefined = ignore, null = clear, string = set
      groupId?: string | null;
    }
  ): SessionUpdateResult {
    return updateMarker(this.getMutatorContext(), markerId, patch);
  }

  // --- Telemetry Operations ---

  addPlaybackEvent(event: PlaybackEvent): SessionUpdateResult {
    return addPlaybackEvent(this.getMutatorContext(), event);
  }

  // --- Transcript Operations ---

  setTranscriptRef(ref: TranscriptRef | null): SessionUpdateResult {
    return setTranscriptRef(this.getMutatorContext(), ref);
  }

  /**
   * Sets the playback state for UI resume.
   */
  setPlaybackState(state: { activeMediaId: string | null; mediaPositions: Record<string, number> }): SessionUpdateResult {
    return setPlaybackState(this.getMutatorContext(), state);
  }
}
