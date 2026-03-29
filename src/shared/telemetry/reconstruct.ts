// src/shared/telemetry/reconstruct.ts
// Canonical, shared implementation of Section 5's reconstruction algorithm (SSoT; no duplicated logic)

import type { PlaybackEvent, UUID } from '../sessionPackage/types';

export interface PlaybackStateAtTime {
  /** Null means no media loaded (explicitly logged via `load` with null mediaId). */
  activeMediaId: UUID | null;
  /** Null means no media loaded or unknown state. */
  mediaTimeSec: number | null;
  /** The playbackRate from the last applied event (authoritative). */
  playbackRate: number;
  paused: boolean;
  /** The sessionTimeSec of the last applied event. */
  lastEventSessionTimeSec: number;
}

export type PlaybackStateAtTimeErrorCode = 'invalid_input' | 'not_sorted' | 'invalid_event';

export type PlaybackStateAtTimeResult =
  | { ok: true; state: PlaybackStateAtTime | null }
  | { ok: false; code: PlaybackStateAtTimeErrorCode; message: string };

/**
 * Reconstruct playback state at a given session time.
 *
 * Algorithm (from PRD Section 5):
 * 1. Find the last event with sessionTimeSec <= T
 * 2. Apply events in order to build state machine
 * 3. If paused, return lastKnownMediaTimeSec
 * 4. If playing, extrapolate: mediaTimeAtT = lastKnownMediaTimeSec + (T - lastEvent.sessionTimeSec) * playbackRate
 */
export function getPlaybackStateAtTime(
  events: PlaybackEvent[],
  sessionTimeSec: number
): PlaybackStateAtTimeResult {
  if (!Array.isArray(events)) {
    return { ok: false, code: 'invalid_input', message: 'events must be an array' };
  }

  if (typeof sessionTimeSec !== 'number' || !Number.isInteger(sessionTimeSec) || sessionTimeSec < 0) {
    return { ok: false, code: 'invalid_input', message: 'sessionTimeSec must be a non-negative integer' };
  }

  // Validate ALL events for structure and sorting, while tracking lastEventIndex <= T
  let lastEventIndex = -1;
  let prevTime = -1;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Validate event is an object
    if (event === null || typeof event !== 'object') {
      return { ok: false, code: 'invalid_event', message: `Event at index ${i} must be an object` };
    }

    // Validate sessionTimeSec is an integer >= 0
    if (typeof event.sessionTimeSec !== 'number' || !Number.isInteger(event.sessionTimeSec)) {
      return { ok: false, code: 'invalid_event', message: `sessionTimeSec must be an integer at index ${i}` };
    }
    if (event.sessionTimeSec < 0) {
      return { ok: false, code: 'invalid_event', message: `sessionTimeSec must be >= 0 at index ${i}` };
    }

    // Check sorting (must validate entire array, no early break)
    if (event.sessionTimeSec < prevTime) {
      return { ok: false, code: 'not_sorted', message: `Events not sorted at index ${i}` };
    }
    prevTime = event.sessionTimeSec;

    // Track last event <= T (no break; continue validating remaining events)
    if (event.sessionTimeSec <= sessionTimeSec) {
      lastEventIndex = i;
    }
  }

  // No events before or at T
  if (lastEventIndex === -1) {
    return { ok: true, state: null };
  }

  // Apply events in order to build state
  let activeMediaId: UUID | null = null;
  let lastKnownMediaTimeSec: number | null = null;
  let playbackRate = 1;
  let paused = true;
  let lastEventSessionTimeSec = 0;

  for (let i = 0; i <= lastEventIndex; i++) {
    const event = events[i];

    // Validate playbackRate
    if (typeof event.playbackRate !== 'number' || !Number.isFinite(event.playbackRate) || event.playbackRate <= 0) {
      return { ok: false, code: 'invalid_event', message: `playbackRate must be finite and > 0 at index ${i}` };
    }

    // Validate type is a valid string
    if (typeof event.type !== 'string') {
      return { ok: false, code: 'invalid_event', message: `type must be a string at index ${i}` };
    }

    lastEventSessionTimeSec = event.sessionTimeSec;
    playbackRate = event.playbackRate;

    // Apply media state from event with strict validation
    if (event.mediaId === null) {
      // Explicit no-media state: only valid for 'load' type (PRD invariant)
      if (event.type !== 'load') {
        return { ok: false, code: 'invalid_event', message: `null mediaId only valid for 'load' event at index ${i}` };
      }
      if (event.mediaTimeSec !== null) {
        return { ok: false, code: 'invalid_event', message: `mediaTimeSec must be null when mediaId is null at index ${i}` };
      }
      activeMediaId = null;
      lastKnownMediaTimeSec = null;
      paused = true;
    } else {
      // Media is loaded: validate mediaId is string, mediaTimeSec is finite >= 0
      if (typeof event.mediaId !== 'string') {
        return { ok: false, code: 'invalid_event', message: `mediaId must be null or a string at index ${i}` };
      }
      if (typeof event.mediaTimeSec !== 'number' || !Number.isFinite(event.mediaTimeSec)) {
        return { ok: false, code: 'invalid_event', message: `mediaTimeSec must be a finite number when mediaId is present at index ${i}` };
      }
      if (event.mediaTimeSec < 0) {
        return { ok: false, code: 'invalid_event', message: `mediaTimeSec must be >= 0 at index ${i}` };
      }
      activeMediaId = event.mediaId;
      lastKnownMediaTimeSec = event.mediaTimeSec;
    }

    // Apply type-specific paused state
    const eventType = event.type;
    switch (eventType) {
      case 'load':
        paused = true;
        break;
      case 'play':
        paused = false;
        break;
      case 'pause':
        paused = true;
        break;
      case 'seek':
      case 'tick':
      case 'rate':
        // Do not change paused state
        break;
      default: {
        // Runtime validation: eventType is typed as never but could be invalid at runtime
        const invalidType: string = eventType;
        return { ok: false, code: 'invalid_event', message: `Unknown event type at index ${i}: ${invalidType}` };
      }
    }
  }

  // Calculate media time at T
  let mediaTimeSec: number | null = null;

  if (activeMediaId !== null && lastKnownMediaTimeSec !== null) {
    if (paused) {
      mediaTimeSec = lastKnownMediaTimeSec;
    } else {
      // Extrapolate: media time advances linearly while playing
      const elapsed = sessionTimeSec - lastEventSessionTimeSec;
      mediaTimeSec = lastKnownMediaTimeSec + elapsed * playbackRate;
    }
  }

  return {
    ok: true,
    state: {
      activeMediaId,
      mediaTimeSec,
      playbackRate,
      paused,
      lastEventSessionTimeSec,
    },
  };
}
