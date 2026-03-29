import type { PlaybackEvent, TranscriptRef } from '../../../shared/sessionPackage/types';
import type { SessionUpdateResult } from '../../../shared/ipc/types';
import type { SessionStoreMutatorContext } from './types';

export function addPlaybackEvent(
  ctx: SessionStoreMutatorContext,
  event: PlaybackEvent
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated(
    {
      ...currentSession,
      telemetry: {
        ...currentSession.telemetry,
        events: [...currentSession.telemetry.events, event],
      },
    },
    { bumpUiRevision: false }
  );
}

export function setTranscriptRef(
  ctx: SessionStoreMutatorContext,
  ref: TranscriptRef | null
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated({
    ...currentSession,
    transcript: ref,
  });
}

export function setPlaybackState(
  ctx: SessionStoreMutatorContext,
  state: { activeMediaId: string | null; mediaPositions: Record<string, number> }
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated({
    ...currentSession,
    playbackState: state,
  });
}
