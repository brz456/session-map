// src/shared/sessionPackage/validate.ts
// Deterministic validation (fail-closed) for loaded session packages

import type { SessionPackage, PlaybackEvent, Marker } from './types';
import {
  DRAWING_COORDINATE_SPACE,
  MAX_STROKES_PER_MARKER,
  MAX_POINTS_PER_STROKE,
  PLAYBACK_EVENT_TYPES,
  MARKER_SOURCE_TYPES,
} from './types';
import { hasSupportedMediaExtension, SUPPORTED_MEDIA_EXTENSIONS } from '../mediaExtensions';

export type SessionValidationErrorCode =
  | 'invalid_json'
  | 'missing_required_field'
  | 'invalid_timebase'
  | 'invalid_reference'
  | 'duplicate_media_path'
  | 'unsupported_media_extension'
  | 'unsupported_recording_extension'
  | 'invalid_recording_path'
  | 'recordings_not_contiguous'
  | 'invalid_playback_state'
  | 'invalid_in_progress_recording'
  | 'telemetry_not_sorted'
  | 'clock_regression_detected'
  | 'invalid_telemetry_event'
  | 'negative_time'
  | 'invalid_playback_rate'
  | 'media_time_missing_when_media_loaded'
  | 'invalid_media_time'
  | 'invalid_marker_drawing'
  | 'invalid_group_id';

export type SessionValidationResult =
  | { ok: true; session: SessionPackage }
  | { ok: false; code: SessionValidationErrorCode; message: string };

// Internal result type for helper functions (no session payload needed)
type InternalValidationResult =
  | { ok: true }
  | { ok: false; code: SessionValidationErrorCode; message: string };

const VALID_EVENT_TYPES = new Set<string>(PLAYBACK_EVENT_TYPES);
const VALID_MARKER_SOURCE_TYPES = new Set<string>(MARKER_SOURCE_TYPES);

export function validateSessionPackage(input: unknown): SessionValidationResult {
  if (input === null || typeof input !== 'object') {
    return { ok: false, code: 'invalid_json', message: 'Input is not an object' };
  }

  const obj = input as Record<string, unknown>;

  // Required top-level fields (transcript is required but may be null)
  const requiredFields = [
    'version',
    'sessionId',
    'name',
    'createdAtIso',
    'updatedAtIso',
    'platform',
    'timebase',
    'recordings',
    'media',
    'outline',
    'taxonomy',
    'telemetry',
    'markers',
    'transcript',
  ];
  for (const field of requiredFields) {
    if (!(field in obj)) {
      return { ok: false, code: 'missing_required_field', message: `Missing required field: ${field}` };
    }
  }

  // Version validation (fail-closed; only version 1 supported)
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version)) {
    return { ok: false, code: 'missing_required_field', message: 'version must be an integer' };
  }
  if (obj.version !== 1) {
    return { ok: false, code: 'invalid_reference', message: `Unsupported session version: ${obj.version}` };
  }

  // String field validation
  if (typeof obj.sessionId !== 'string') {
    return { ok: false, code: 'missing_required_field', message: 'sessionId must be a string' };
  }
  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    return { ok: false, code: 'missing_required_field', message: 'name must be a non-empty string' };
  }
  if (typeof obj.createdAtIso !== 'string') {
    return { ok: false, code: 'missing_required_field', message: 'createdAtIso must be a string' };
  }
  if (typeof obj.updatedAtIso !== 'string') {
    return { ok: false, code: 'missing_required_field', message: 'updatedAtIso must be a string' };
  }

  // Timebase validation
  const timebase = obj.timebase;
  if (timebase === null || typeof timebase !== 'object') {
    return { ok: false, code: 'invalid_timebase', message: 'Timebase must be an object' };
  }
  const tb = timebase as Record<string, unknown>;
  if (tb.origin !== 'obs_recording_started' || tb.timeUnit !== 'seconds') {
    return { ok: false, code: 'invalid_timebase', message: 'Timebase must have origin="obs_recording_started" and timeUnit="seconds"' };
  }

  // Platform validation
  const platform = obj.platform;
  if (platform === null || typeof platform !== 'object') {
    return { ok: false, code: 'missing_required_field', message: 'Platform must be an object' };
  }
  if ((platform as Record<string, unknown>).os !== 'windows') {
    return { ok: false, code: 'missing_required_field', message: 'Platform must have os="windows"' };
  }

  // Recordings array validation
  if (!Array.isArray(obj.recordings)) {
    return { ok: false, code: 'missing_required_field', message: 'Recordings must be an array' };
  }

  const recordingIds = new Set<string>();
  let expectedStart = 0; // Tracks expected start for contiguity check
  for (let i = 0; i < obj.recordings.length; i++) {
    const segment = obj.recordings[i];
    if (segment === null || typeof segment !== 'object') {
      return { ok: false, code: 'missing_required_field', message: `Recording segment at index ${i} must be an object` };
    }
    const seg = segment as Record<string, unknown>;

    if (typeof seg.id !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Recording segment at index ${i} missing id string` };
    }
    if (recordingIds.has(seg.id)) {
      return { ok: false, code: 'invalid_reference', message: `Duplicate recording id: ${seg.id}` };
    }
    recordingIds.add(seg.id);

    if (typeof seg.startSessionTimeSec !== 'number' || !Number.isInteger(seg.startSessionTimeSec)) {
      return { ok: false, code: 'missing_required_field', message: `Recording segment at index ${i} missing startSessionTimeSec integer` };
    }
    if (seg.startSessionTimeSec < 0) {
      return { ok: false, code: 'negative_time', message: `Negative startSessionTimeSec at recording segment index ${i}` };
    }

    // Contiguity check: each segment must start where the previous ended
    if (seg.startSessionTimeSec !== expectedStart) {
      return {
        ok: false,
        code: 'recordings_not_contiguous',
        message: `Recording segment at index ${i} has startSessionTimeSec=${seg.startSessionTimeSec}, expected ${expectedStart} (segments must be contiguous)`,
      };
    }

    if (typeof seg.durationSec !== 'number' || !Number.isInteger(seg.durationSec)) {
      return { ok: false, code: 'missing_required_field', message: `Recording segment at index ${i} missing durationSec integer` };
    }
    if (seg.durationSec < 0) {
      return { ok: false, code: 'negative_time', message: `Negative durationSec at recording segment index ${i}` };
    }

    // Update expected start for next segment
    expectedStart = seg.startSessionTimeSec + seg.durationSec;

    if (typeof seg.file !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Recording segment at index ${i} missing file string` };
    }
    // Reject backslashes - paths must use canonical forward slashes only
    if (seg.file.includes('\\')) {
      return { ok: false, code: 'invalid_recording_path', message: `Recording segment at index ${i} file must use forward slashes only (no backslashes)` };
    }
    // Validate file path invariants: prefix, non-empty filename, no traversal
    if (!seg.file.startsWith('recording/')) {
      return { ok: false, code: 'invalid_recording_path', message: `Recording segment at index ${i} file must start with "recording/"` };
    }
    const filename = seg.file.slice('recording/'.length);
    if (filename === '' || filename.startsWith('/') || filename.endsWith('/')) {
      return { ok: false, code: 'invalid_recording_path', message: `Recording segment at index ${i} file must have a non-empty filename after "recording/"` };
    }
    // Check for actual ".." path segments (not just ".." anywhere in filename)
    if (/(^|\/)\.\.($|\/)/.test(seg.file)) {
      return { ok: false, code: 'invalid_recording_path', message: `Recording segment at index ${i} file must not contain path traversal (..)` };
    }
    // Validate supported extension (OBS outputs supported formats only)
    if (!hasSupportedMediaExtension(seg.file)) {
      return {
        ok: false,
        code: 'unsupported_recording_extension',
        message: `Recording segment at index ${i} file must have extension ${SUPPORTED_MEDIA_EXTENSIONS.join(', ')}`,
      };
    }
  }

  // Media validation
  const media = obj.media;
  if (media === null || typeof media !== 'object') {
    return { ok: false, code: 'missing_required_field', message: 'Media must be an object' };
  }
  const mediaObj = media as Record<string, unknown>;
  if (!Array.isArray(mediaObj.assets)) {
    return { ok: false, code: 'missing_required_field', message: 'Media must have assets array' };
  }

  const mediaIds = new Set<string>();
  const mediaPaths = new Set<string>();
  for (let i = 0; i < mediaObj.assets.length; i++) {
    const asset = mediaObj.assets[i];
    if (asset === null || typeof asset !== 'object') {
      return { ok: false, code: 'missing_required_field', message: `Media asset at index ${i} must be an object` };
    }
    const a = asset as Record<string, unknown>;

    if (typeof a.mediaId !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Media asset at index ${i} missing mediaId string` };
    }
    if (typeof a.absolutePath !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Media asset at index ${i} missing absolutePath string` };
    }
    if (typeof a.displayName !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Media asset at index ${i} missing displayName string` };
    }
    if (a.createdAtIso !== undefined) {
      if (typeof a.createdAtIso !== 'string') {
        return { ok: false, code: 'missing_required_field', message: `Media asset at index ${i} createdAtIso must be a string if provided` };
      }
      if (!Number.isFinite(Date.parse(a.createdAtIso))) {
        return { ok: false, code: 'missing_required_field', message: `Media asset at index ${i} createdAtIso must be a valid ISO timestamp if provided` };
      }
    }

    if (mediaIds.has(a.mediaId)) {
      return { ok: false, code: 'invalid_reference', message: `Duplicate mediaId: ${a.mediaId}` };
    }
    mediaIds.add(a.mediaId);

    const normalizedPath = a.absolutePath.toLowerCase();
    if (mediaPaths.has(normalizedPath)) {
      return { ok: false, code: 'duplicate_media_path', message: `Duplicate media path: ${a.absolutePath}` };
    }
    mediaPaths.add(normalizedPath);

    if (!hasSupportedMediaExtension(a.absolutePath)) {
      return {
        ok: false,
        code: 'unsupported_media_extension',
        message: `Media must have extension ${SUPPORTED_MEDIA_EXTENSIONS.join(', ')}, got: ${a.absolutePath}`,
      };
    }
  }

  // Optional playbackState validation (if present, must be well-formed)
  if ('playbackState' in obj && obj.playbackState !== undefined) {
    const ps = obj.playbackState;
    if (ps === null || typeof ps !== 'object') {
      return { ok: false, code: 'invalid_playback_state', message: 'playbackState must be an object' };
    }
    const psObj = ps as Record<string, unknown>;

    // activeMediaId: must be null or a known mediaId
    if (!('activeMediaId' in psObj)) {
      return { ok: false, code: 'invalid_playback_state', message: 'playbackState missing activeMediaId' };
    }
    if (psObj.activeMediaId !== null) {
      if (typeof psObj.activeMediaId !== 'string') {
        return { ok: false, code: 'invalid_playback_state', message: 'playbackState.activeMediaId must be null or a string' };
      }
      if (!mediaIds.has(psObj.activeMediaId)) {
        return { ok: false, code: 'invalid_playback_state', message: `playbackState.activeMediaId references unknown mediaId: ${psObj.activeMediaId}` };
      }
    }

    // mediaPositions: must be an object with known mediaIds as keys and finite >= 0 numbers as values
    if (!('mediaPositions' in psObj)) {
      return { ok: false, code: 'invalid_playback_state', message: 'playbackState missing mediaPositions' };
    }
    // Require plain object (reject arrays, Maps, and other non-plain objects that lose data on JSON serialize)
    if (
      psObj.mediaPositions === null ||
      typeof psObj.mediaPositions !== 'object' ||
      Array.isArray(psObj.mediaPositions) ||
      Object.getPrototypeOf(psObj.mediaPositions) !== Object.prototype
    ) {
      return { ok: false, code: 'invalid_playback_state', message: 'playbackState.mediaPositions must be a plain object' };
    }
    const positions = psObj.mediaPositions as Record<string, unknown>;
    for (const [mediaId, position] of Object.entries(positions)) {
      if (!mediaIds.has(mediaId)) {
        return { ok: false, code: 'invalid_playback_state', message: `playbackState.mediaPositions references unknown mediaId: ${mediaId}` };
      }
      if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
        return { ok: false, code: 'invalid_playback_state', message: `playbackState.mediaPositions[${mediaId}] must be a finite number >= 0` };
      }
    }
  }

  // Optional inProgressRecording validation (if present, must be well-formed)
  // This field indicates an interrupted recording; recovery should clean up orphaned data
  if ('inProgressRecording' in obj && obj.inProgressRecording !== undefined) {
    const ipr = obj.inProgressRecording;
    if (ipr === null || typeof ipr !== 'object') {
      return { ok: false, code: 'invalid_in_progress_recording', message: 'inProgressRecording must be an object' };
    }
    const iprObj = ipr as Record<string, unknown>;

    // id: must be a string (UUID of the in-progress recording)
    if (typeof iprObj.id !== 'string' || iprObj.id === '') {
      return { ok: false, code: 'invalid_in_progress_recording', message: 'inProgressRecording.id must be a non-empty string' };
    }

    // startSessionTimeSec: must be a non-negative integer
    if (typeof iprObj.startSessionTimeSec !== 'number' || !Number.isInteger(iprObj.startSessionTimeSec)) {
      return { ok: false, code: 'invalid_in_progress_recording', message: 'inProgressRecording.startSessionTimeSec must be an integer' };
    }
    if (iprObj.startSessionTimeSec < 0) {
      return { ok: false, code: 'invalid_in_progress_recording', message: 'inProgressRecording.startSessionTimeSec must be non-negative' };
    }

    // startSessionTimeSec must equal accumulated time from recordings (contiguity invariant)
    if (iprObj.startSessionTimeSec !== expectedStart) {
      return {
        ok: false,
        code: 'invalid_in_progress_recording',
        message: `inProgressRecording.startSessionTimeSec=${iprObj.startSessionTimeSec} must equal accumulated recording time (${expectedStart})`,
      };
    }
  }

  // Outline validation
  const outline = obj.outline;
  if (outline === null || typeof outline !== 'object') {
    return { ok: false, code: 'missing_required_field', message: 'Outline must be an object' };
  }
  const outlineObj = outline as Record<string, unknown>;
  if (!Array.isArray(outlineObj.buckets)) {
    return { ok: false, code: 'missing_required_field', message: 'Outline must have buckets array' };
  }

  const bucketIds = new Set<string>();
  for (let i = 0; i < outlineObj.buckets.length; i++) {
    const bucket = outlineObj.buckets[i];
    if (bucket === null || typeof bucket !== 'object') {
      return { ok: false, code: 'missing_required_field', message: `Bucket at index ${i} must be an object` };
    }
    const b = bucket as Record<string, unknown>;

    if (typeof b.bucketId !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Bucket at index ${i} missing bucketId string` };
    }
    if (typeof b.title !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Bucket at index ${i} missing title string` };
    }
    if (typeof b.sortIndex !== 'number') {
      return { ok: false, code: 'missing_required_field', message: `Bucket at index ${i} missing sortIndex number` };
    }

    if (bucketIds.has(b.bucketId)) {
      return { ok: false, code: 'invalid_reference', message: `Duplicate bucketId: ${b.bucketId}` };
    }
    bucketIds.add(b.bucketId);
  }

  // Taxonomy validation
  const taxonomy = obj.taxonomy;
  if (taxonomy === null || typeof taxonomy !== 'object') {
    return { ok: false, code: 'missing_required_field', message: 'Taxonomy must be an object' };
  }
  const taxonomyObj = taxonomy as Record<string, unknown>;
  if (!Array.isArray(taxonomyObj.tags)) {
    return { ok: false, code: 'missing_required_field', message: 'Taxonomy must have tags array' };
  }

  const tagIds = new Set<string>();
  for (let i = 0; i < taxonomyObj.tags.length; i++) {
    const tag = taxonomyObj.tags[i];
    if (tag === null || typeof tag !== 'object') {
      return { ok: false, code: 'missing_required_field', message: `Tag at index ${i} must be an object` };
    }
    const t = tag as Record<string, unknown>;

    if (typeof t.tagId !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Tag at index ${i} missing tagId string` };
    }
    if (typeof t.name !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Tag at index ${i} missing name string` };
    }

    if (tagIds.has(t.tagId)) {
      return { ok: false, code: 'invalid_reference', message: `Duplicate tagId: ${t.tagId}` };
    }
    tagIds.add(t.tagId);
  }

  // Telemetry validation
  const telemetry = obj.telemetry;
  if (telemetry === null || typeof telemetry !== 'object') {
    return { ok: false, code: 'missing_required_field', message: 'Telemetry must be an object' };
  }
  const telemetryObj = telemetry as Record<string, unknown>;
  if (!Array.isArray(telemetryObj.events)) {
    return { ok: false, code: 'missing_required_field', message: 'Telemetry must have events array' };
  }

  let prevSessionTime = -1;
  for (let i = 0; i < telemetryObj.events.length; i++) {
    const event = telemetryObj.events[i];
    const eventResult = validateTelemetryEvent(event, mediaIds, prevSessionTime, i);
    if (!eventResult.ok) {
      return eventResult;
    }
    prevSessionTime = (event as PlaybackEvent).sessionTimeSec;
  }

  // Markers validation
  if (!Array.isArray(obj.markers)) {
    return { ok: false, code: 'missing_required_field', message: 'Markers must be an array' };
  }

  const markerIds = new Set<string>();
  for (let i = 0; i < obj.markers.length; i++) {
    const marker = obj.markers[i];
    const markerResult = validateMarker(marker, mediaIds, bucketIds, tagIds, markerIds, i);
    if (!markerResult.ok) {
      return markerResult;
    }
    markerIds.add((marker as Marker).markerId);
  }

  // Transcript reference validation (must be null or { relativePath: "transcript.json" })
  const transcript = obj.transcript;
  if (transcript !== null) {
    if (typeof transcript !== 'object') {
      return { ok: false, code: 'invalid_reference', message: 'Transcript must be null or an object' };
    }
    const tr = transcript as Record<string, unknown>;
    if (tr.relativePath !== 'transcript.json') {
      return { ok: false, code: 'invalid_reference', message: 'Transcript relativePath must be "transcript.json"' };
    }
  }

  return { ok: true, session: input as SessionPackage };
}

function validateTelemetryEvent(
  event: unknown,
  mediaIds: Set<string>,
  prevSessionTime: number,
  index: number
): InternalValidationResult {
  // Must be a non-null object
  if (event === null || typeof event !== 'object') {
    return { ok: false, code: 'invalid_telemetry_event', message: `Telemetry event at index ${index} must be an object` };
  }

  const e = event as Record<string, unknown>;

  // Type validation
  if (typeof e.type !== 'string' || !VALID_EVENT_TYPES.has(e.type)) {
    return { ok: false, code: 'invalid_telemetry_event', message: `Invalid event type at index ${index}: ${e.type}` };
  }

  // Session time validation
  if (typeof e.sessionTimeSec !== 'number' || !Number.isInteger(e.sessionTimeSec)) {
    return { ok: false, code: 'invalid_telemetry_event', message: `sessionTimeSec must be an integer at index ${index}` };
  }
  if (e.sessionTimeSec < 0) {
    return { ok: false, code: 'negative_time', message: `Negative sessionTimeSec at index ${index}: ${e.sessionTimeSec}` };
  }

  // Ordering validation (use telemetry_not_sorted for out-of-order events)
  if (e.sessionTimeSec < prevSessionTime) {
    return { ok: false, code: 'telemetry_not_sorted', message: `Telemetry not sorted at index ${index}: ${e.sessionTimeSec} < ${prevSessionTime}` };
  }

  // Playback rate validation
  if (typeof e.playbackRate !== 'number' || !Number.isFinite(e.playbackRate) || e.playbackRate <= 0) {
    return { ok: false, code: 'invalid_playback_rate', message: `playbackRate must be finite and > 0 at index ${index}` };
  }

  // Media/time pairing validation
  if (e.mediaId === null) {
    // No-media state: only valid for 'load' type
    if (e.type !== 'load') {
      return { ok: false, code: 'invalid_telemetry_event', message: `null mediaId only valid for 'load' event at index ${index}` };
    }
    if (e.mediaTimeSec !== null) {
      return { ok: false, code: 'invalid_telemetry_event', message: `mediaTimeSec must be null when mediaId is null at index ${index}` };
    }
  } else {
    // mediaId is present
    if (typeof e.mediaId !== 'string') {
      return { ok: false, code: 'invalid_telemetry_event', message: `mediaId must be a string at index ${index}` };
    }
    if (!mediaIds.has(e.mediaId)) {
      return { ok: false, code: 'invalid_reference', message: `Unknown mediaId at index ${index}: ${e.mediaId}` };
    }
    if (e.mediaTimeSec === null || e.mediaTimeSec === undefined) {
      return { ok: false, code: 'media_time_missing_when_media_loaded', message: `mediaTimeSec required when mediaId is present at index ${index}` };
    }
    if (typeof e.mediaTimeSec !== 'number' || !Number.isFinite(e.mediaTimeSec) || e.mediaTimeSec < 0) {
      return { ok: false, code: 'invalid_media_time', message: `mediaTimeSec must be finite and >= 0 at index ${index}` };
    }
  }

  return { ok: true };
}

function validateMarker(
  marker: unknown,
  mediaIds: Set<string>,
  bucketIds: Set<string>,
  tagIds: Set<string>,
  existingMarkerIds: Set<string>,
  index: number
): InternalValidationResult {
  // Must be a non-null object
  if (marker === null || typeof marker !== 'object') {
    return { ok: false, code: 'missing_required_field', message: `Marker at index ${index} must be an object` };
  }

  const m = marker as Record<string, unknown>;

  // Required string fields
  if (typeof m.markerId !== 'string') {
    return { ok: false, code: 'missing_required_field', message: `Marker at index ${index} missing markerId string` };
  }
  if (typeof m.createdAtIso !== 'string') {
    return { ok: false, code: 'missing_required_field', message: `Marker at index ${index} missing createdAtIso string` };
  }

  if (existingMarkerIds.has(m.markerId)) {
    return { ok: false, code: 'invalid_reference', message: `Duplicate markerId: ${m.markerId}` };
  }

  // Anchor time validation: null allowed (marker created outside recording), otherwise must be non-negative integer
  if (m.anchorSessionTimeSec !== null) {
    if (typeof m.anchorSessionTimeSec !== 'number' || !Number.isInteger(m.anchorSessionTimeSec)) {
      return { ok: false, code: 'missing_required_field', message: `anchorSessionTimeSec must be null or an integer for marker at index ${index}` };
    }
    if (m.anchorSessionTimeSec < 0) {
      return { ok: false, code: 'negative_time', message: `Negative anchorSessionTimeSec for marker at index ${index}: ${m.anchorSessionTimeSec}` };
    }
  }

  if (typeof m.sourceType !== 'string' || !VALID_MARKER_SOURCE_TYPES.has(m.sourceType)) {
    return { ok: false, code: 'missing_required_field', message: `Invalid sourceType for marker at index ${index}` };
  }

  // Importance validation
  if (m.importance !== 1 && m.importance !== 2 && m.importance !== 3) {
    return { ok: false, code: 'missing_required_field', message: `Invalid importance for marker at index ${index}` };
  }

  // Playback snapshot validation
  const snapshot = m.playbackSnapshot;
  if (snapshot === null || typeof snapshot !== 'object') {
    return { ok: false, code: 'missing_required_field', message: `Missing playbackSnapshot for marker at index ${index}` };
  }

  const snap = snapshot as Record<string, unknown>;
  if (typeof snap.playbackRate !== 'number' || !Number.isFinite(snap.playbackRate) || snap.playbackRate <= 0) {
    return { ok: false, code: 'invalid_playback_rate', message: `Invalid playbackRate in snapshot for marker at index ${index}` };
  }
  if (typeof snap.paused !== 'boolean') {
    return { ok: false, code: 'missing_required_field', message: `Invalid paused in snapshot for marker at index ${index}` };
  }

  // Require mediaId and mediaTimeSec keys to be present in snapshot
  if (!('mediaId' in snap)) {
    return { ok: false, code: 'missing_required_field', message: `playbackSnapshot missing mediaId key for marker at index ${index}` };
  }
  if (!('mediaTimeSec' in snap)) {
    return { ok: false, code: 'missing_required_field', message: `playbackSnapshot missing mediaTimeSec key for marker at index ${index}` };
  }

  // Apply union rules: null/null vs string/number
  if (snap.mediaId === null) {
    if (snap.mediaTimeSec !== null) {
      return { ok: false, code: 'invalid_media_time', message: `mediaTimeSec must be null when mediaId is null for marker at index ${index}` };
    }
  } else {
    if (typeof snap.mediaId !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `mediaId must be null or a string in snapshot for marker at index ${index}` };
    }
    if (!mediaIds.has(snap.mediaId)) {
      return { ok: false, code: 'invalid_reference', message: `Unknown mediaId in snapshot for marker at index ${index}` };
    }
    if (snap.mediaTimeSec === null) {
      return { ok: false, code: 'media_time_missing_when_media_loaded', message: `mediaTimeSec required when mediaId is present for marker at index ${index}` };
    }
    if (typeof snap.mediaTimeSec !== 'number' || !Number.isFinite(snap.mediaTimeSec)) {
      return { ok: false, code: 'invalid_media_time', message: `mediaTimeSec must be a finite number for marker at index ${index}` };
    }
    if (snap.mediaTimeSec < 0) {
      return { ok: false, code: 'invalid_media_time', message: `Negative mediaTimeSec in snapshot for marker at index ${index}` };
    }
  }

  // Bucket reference validation (require key presence first)
  if (!('bucketId' in m)) {
    return { ok: false, code: 'missing_required_field', message: `Marker at index ${index} missing bucketId field` };
  }
  if (m.bucketId !== null) {
    if (typeof m.bucketId !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `bucketId must be null or a string for marker at index ${index}` };
    }
    if (!bucketIds.has(m.bucketId)) {
      return { ok: false, code: 'invalid_reference', message: `Unknown bucketId for marker at index ${index}: ${m.bucketId}` };
    }
  }

  // Tag references validation
  if (!Array.isArray(m.tagIds)) {
    return { ok: false, code: 'missing_required_field', message: `tagIds must be an array for marker at index ${index}` };
  }
  for (let i = 0; i < m.tagIds.length; i++) {
    const tagId = m.tagIds[i];
    if (typeof tagId !== 'string') {
      return { ok: false, code: 'invalid_reference', message: `tagId at position ${i} must be a string for marker at index ${index}` };
    }
    if (!tagIds.has(tagId)) {
      return { ok: false, code: 'invalid_reference', message: `Unknown tagId for marker at index ${index}: ${tagId}` };
    }
  }

  // Drawing validation (optional field)
  if ('drawing' in m && m.drawing !== undefined) {
    const drawingResult = validateMarkerDrawing(m.drawing, index);
    if (!drawingResult.ok) {
      return drawingResult;
    }
  }

  // groupId validation (optional field: undefined = no group, non-empty string = group ID)
  if ('groupId' in m && m.groupId !== undefined) {
    if (typeof m.groupId !== 'string' || m.groupId === '') {
      return { ok: false, code: 'invalid_group_id', message: `groupId must be a non-empty string for marker at index ${index}` };
    }
  }

  return { ok: true };
}

function validateMarkerDrawing(
  drawing: unknown,
  index: number
): InternalValidationResult {
  // Must be a non-null object (null not allowed when key is present)
  if (drawing === null || typeof drawing !== 'object') {
    return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index} must be an object` };
  }

  const d = drawing as Record<string, unknown>;

  // coordinateSpace must equal DRAWING_COORDINATE_SPACE
  if (d.coordinateSpace !== DRAWING_COORDINATE_SPACE) {
    return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index} has invalid coordinateSpace` };
  }

  // strokeWidth must be finite and > 0
  if (typeof d.strokeWidth !== 'number' || !Number.isFinite(d.strokeWidth) || d.strokeWidth <= 0) {
    return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index} strokeWidth must be finite and > 0` };
  }

  // strokes must be an array
  if (!Array.isArray(d.strokes)) {
    return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index} strokes must be an array` };
  }

  // strokes length limit
  if (d.strokes.length > MAX_STROKES_PER_MARKER) {
    return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index} exceeds max strokes (${MAX_STROKES_PER_MARKER})` };
  }

  // Validate each stroke
  for (let s = 0; s < d.strokes.length; s++) {
    const stroke = d.strokes[s];
    if (stroke === null || typeof stroke !== 'object') {
      return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index}, stroke ${s} must be an object` };
    }

    const st = stroke as Record<string, unknown>;

    // color must be hex string
    if (typeof st.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(st.color)) {
      return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index}, stroke ${s} has invalid color (must be #RRGGBB)` };
    }

    // points must be array with length >= 2
    if (!Array.isArray(st.points)) {
      return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index}, stroke ${s} points must be an array` };
    }

    if (st.points.length < 2) {
      return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index}, stroke ${s} must have at least 2 points` };
    }

    if (st.points.length > MAX_POINTS_PER_STROKE) {
      return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index}, stroke ${s} exceeds max points (${MAX_POINTS_PER_STROKE})` };
    }

    // Validate each point
    for (let p = 0; p < st.points.length; p++) {
      const point = st.points[p];
      if (point === null || typeof point !== 'object') {
        return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index}, stroke ${s}, point ${p} must be an object` };
      }

      const pt = point as Record<string, unknown>;

      // x must be finite and 0..1
      if (typeof pt.x !== 'number' || !Number.isFinite(pt.x) || pt.x < 0 || pt.x > 1) {
        return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index}, stroke ${s}, point ${p} x must be 0..1` };
      }

      // y must be finite and 0..1
      if (typeof pt.y !== 'number' || !Number.isFinite(pt.y) || pt.y < 0 || pt.y > 1) {
        return { ok: false, code: 'invalid_marker_drawing', message: `Marker drawing at index ${index}, stroke ${s}, point ${p} y must be 0..1` };
      }
    }
  }

  return { ok: true };
}
