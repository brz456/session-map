import type { RecordingSegment } from '../../../shared/sessionPackage/types';
import type {
  AccumulatedSessionTimeResult,
  SessionUpdateResult,
} from '../../../shared/ipc/types';
import type { SessionStoreMutatorContext } from './types';

export function addRecordingSegment(
  ctx: SessionStoreMutatorContext,
  segment: RecordingSegment
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Remove inProgressRecording (if present) atomically with segment addition
  // This is required because validation checks inProgressRecording.startSessionTimeSec === accumulated time,
  // which becomes false after the segment is added.
  const { inProgressRecording: _, ...sessionWithoutInProgress } = currentSession;

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated({
    ...sessionWithoutInProgress,
    recordings: [...currentSession.recordings, segment],
  });
}

export function getAccumulatedSessionTime(
  ctx: SessionStoreMutatorContext
): AccumulatedSessionTimeResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // O(1) via contiguity invariant: last segment end = total accumulated time
  const recordings = currentSession.recordings;
  const last = recordings.length > 0 ? recordings[recordings.length - 1] : undefined;
  const accumulatedTimeSec = last ? last.startSessionTimeSec + last.durationSec : 0;
  return { ok: true, accumulatedTimeSec };
}

export function setInProgressRecording(
  ctx: SessionStoreMutatorContext,
  id: string,
  startSessionTimeSec: number
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Validate startSessionTimeSec matches accumulated time (contiguity invariant)
  const accumulated = getAccumulatedSessionTime(ctx);
  if (!accumulated.ok) {
    return accumulated;
  }
  if (startSessionTimeSec !== accumulated.accumulatedTimeSec) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `startSessionTimeSec (${startSessionTimeSec}) must equal accumulated time (${accumulated.accumulatedTimeSec})`,
    };
  }

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated({
    ...currentSession,
    inProgressRecording: { id, startSessionTimeSec },
  });
}

export function clearInProgressRecording(ctx: SessionStoreMutatorContext): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  if (!currentSession.inProgressRecording) {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'No in-progress recording to clear',
    };
  }

  // Build prospective next session without inProgressRecording
  const { inProgressRecording: _, ...rest } = currentSession;
  return ctx.commitValidated(rest);
}

export function cleanupInterruptedRecording(
  ctx: SessionStoreMutatorContext
): SessionUpdateResult & { markersRemoved?: number; eventsRemoved?: number } {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const ipr = currentSession.inProgressRecording;
  if (!ipr) {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'No interrupted recording to clean up',
    };
  }

  const cutoffTime = ipr.startSessionTimeSec;

  // Filter out orphaned markers (created during the interrupted recording)
  // Markers with null anchorSessionTimeSec were created outside recording, so keep them
  const originalMarkerCount = currentSession.markers.length;
  const filteredMarkers = currentSession.markers.filter(
    (m) => m.anchorSessionTimeSec === null || m.anchorSessionTimeSec < cutoffTime
  );
  const markersRemoved = originalMarkerCount - filteredMarkers.length;

  // Filter out orphaned telemetry events (logged during the interrupted recording)
  const originalEventCount = currentSession.telemetry.events.length;
  const filteredEvents = currentSession.telemetry.events.filter((e) => e.sessionTimeSec < cutoffTime);
  const eventsRemoved = originalEventCount - filteredEvents.length;

  // Build prospective next session without orphaned data and without inProgressRecording
  const { inProgressRecording: _, ...rest } = currentSession;
  const result = ctx.commitValidated({
    ...rest,
    markers: filteredMarkers,
    telemetry: {
      ...rest.telemetry,
      events: filteredEvents,
    },
  });

  if (result.ok) {
    return { ...result, markersRemoved, eventsRemoved };
  }
  return result;
}

export function hasInProgressRecording(ctx: SessionStoreMutatorContext): boolean {
  return ctx.getCurrentSession()?.inProgressRecording !== undefined;
}
