// src/renderer/telemetry/telemetry.ts
// Centralized telemetry writer with strict invariants (no missing fields)

import {
  PlaybackEvent,
  PlaybackEventType,
  UUID,
} from '../../shared/sessionPackage/types';
import type { SessionTimeResult } from '../session/useSessionClock';

export type TelemetryErrorCode =
  | 'clock_regression_detected'
  | 'no_media_loaded'
  | 'missing_media_time'
  | 'invalid_playback_rate'
  | 'negative_time'
  | 'invalid_event_type';

export type TelemetryBuildResult =
  | { ok: true; event: PlaybackEvent }
  | { ok: false; code: TelemetryErrorCode; message: string; fatal: true };

export interface TelemetryWriteContext {
  getSessionTimeSec(): SessionTimeResult;
  getActiveMediaId(): UUID | null;
  getMediaTimeSec(): number | null;
  getPlaybackRate(): number;
}

const VALID_EVENT_TYPES = new Set<PlaybackEventType>([
  'load',
  'play',
  'pause',
  'seek',
  'rate',
  'tick',
]);

/**
 * Builds a playback event from the current context.
 * Validates all invariants and returns a typed error on failure.
 */
export function buildPlaybackEvent(
  type: PlaybackEventType,
  ctx: TelemetryWriteContext
): TelemetryBuildResult {
  // Validate event type
  if (!VALID_EVENT_TYPES.has(type)) {
    return {
      ok: false,
      code: 'invalid_event_type',
      message: `Invalid event type: ${type}`,
      fatal: true,
    };
  }

  const sessionTimeResult = ctx.getSessionTimeSec();
  const activeMediaId = ctx.getActiveMediaId();
  const mediaTimeSec = ctx.getMediaTimeSec();
  const playbackRate = ctx.getPlaybackRate();

  // Handle clock regression from session clock
  if (!sessionTimeResult.ok) {
    return {
      ok: false,
      code: 'clock_regression_detected',
      message: sessionTimeResult.message,
      fatal: true,
    };
  }

  const sessionTimeSec = sessionTimeResult.sec;

  // Validate sessionTimeSec (already validated by clock, but defensive check)
  if (!Number.isInteger(sessionTimeSec) || sessionTimeSec < 0) {
    return {
      ok: false,
      code: 'negative_time',
      message: `sessionTimeSec must be a non-negative integer, got: ${sessionTimeSec}`,
      fatal: true,
    };
  }

  // Validate playbackRate
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
    return {
      ok: false,
      code: 'invalid_playback_rate',
      message: `playbackRate must be finite and > 0, got: ${playbackRate}`,
      fatal: true,
    };
  }

  // Handle no-media state (only valid for 'load' type)
  if (activeMediaId === null) {
    if (type !== 'load') {
      return {
        ok: false,
        code: 'no_media_loaded',
        message: `Event type "${type}" requires active media, but no media is loaded`,
        fatal: true,
      };
    }

    // Explicit no-media load event
    const event: PlaybackEvent = {
      sessionTimeSec,
      type: 'load',
      playbackRate,
      mediaId: null,
      mediaTimeSec: null,
    };
    return { ok: true, event };
  }

  // Media is loaded - validate mediaTimeSec
  if (mediaTimeSec === null) {
    return {
      ok: false,
      code: 'missing_media_time',
      message: 'mediaTimeSec is required when media is loaded',
      fatal: true,
    };
  }

  if (!Number.isFinite(mediaTimeSec) || mediaTimeSec < 0) {
    return {
      ok: false,
      code: 'negative_time',
      message: `mediaTimeSec must be finite and >= 0, got: ${mediaTimeSec}`,
      fatal: true,
    };
  }

  const event: PlaybackEvent = {
    sessionTimeSec,
    type,
    playbackRate,
    mediaId: activeMediaId,
    mediaTimeSec,
  };

  return { ok: true, event };
}

