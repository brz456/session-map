import { useCallback, useEffect, useRef, useState } from 'react';
import type { UUID } from '../../../shared/sessionPackage/types';
import type { SessionUiSnapshot } from '../../../shared/ipc/sessionUi';
import type { AppCommonDeps } from '../../app/appDeps';

function resolveSnapshotActiveMediaIndex(session: SessionUiSnapshot): number {
  let nextIndex = -1;
  const snapshotActiveMediaId = session.playbackState?.activeMediaId ?? null;
  if (snapshotActiveMediaId !== null) {
    const idx = session.media.assets.findIndex((asset) => asset.mediaId === snapshotActiveMediaId);
    if (idx >= 0) {
      nextIndex = idx;
    }
  }
  if (nextIndex === -1 && session.media.assets.length > 0) {
    nextIndex = 0;
  }
  return nextIndex;
}

export interface PlaybackDomainState {
  activeMediaIndex: number; // -1 when none
  activeMediaId: UUID | null;
  mediaTimeSec: number;
  isPaused: boolean;
  playbackRate: number;
  mediaPositions: Record<string, number>;
  /**
   * Video snap request (SSoT): when `snapToken` increments and `snapToTimeSec` is non-null,
   * the VideoPlayer pauses + seeks to this time (parity with current `VideoPlayer` snap effect).
   */
  snapToTimeSec: number | null;
  snapToken: number;
}

export interface PlaybackDomainQueries {
  /**
   * Telemetry context SSoT (must be ref-backed, not "React state at render time"):
   * these getters must always reflect the latest known player context, including within the same tick
   * as a `selectMedia(...)` action.
   */
  getActiveMediaId(): UUID | null;
  getMediaTimeSec(): number | null;
  getPlaybackRate(): number;
}

export interface PlaybackDomainActions {
  selectMedia(index: number): void;
  setPaused(paused: boolean): void;
  setPlaybackRate(rate: number): void;
  setMediaTimeSec(timeSec: number): void;
  commitSeek(timeSec: number): void;
  /** Request a snap-to-time (increments `snapToken`). */
  requestSnapToTimeSec(timeSec: number): void;
  /** Clear the current snap request (does not decrement token). */
  clearSnap(): void;
}

export function usePlaybackDomain(
  deps: AppCommonDeps & {
    session: SessionUiSnapshot | null;
  }
): { state: PlaybackDomainState; actions: PlaybackDomainActions; queries: PlaybackDomainQueries } {
  const [activeMediaIndex, setActiveMediaIndex] = useState(-1);
  const [activeMediaId, setActiveMediaId] = useState<UUID | null>(null);
  const [mediaTimeSec, setMediaTimeSecState] = useState(0);
  const [isPaused, setIsPausedState] = useState(true);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [mediaPositions, setMediaPositions] = useState<Record<string, number>>({});
  const [snapToTimeSec, setSnapToTimeSec] = useState<number | null>(null);
  const [snapToken, setSnapToken] = useState(0);

  const playbackStateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const playbackStateGenerationRef = useRef(0);
  const lastSessionIdRef = useRef<string | null>(null);
  const mediaPositionsRef = useRef<Record<string, number>>({});
  const activeMediaIndexRef = useRef(activeMediaIndex);
  const sessionUiRef = useRef<SessionUiSnapshot | null>(deps.session);

  const playbackStateRef = useRef({
    activeMediaId: activeMediaId,
    mediaTimeSec: mediaTimeSec,
    playbackRate: playbackRate,
    isPaused: isPaused,
  });

  useEffect(() => {
    mediaPositionsRef.current = mediaPositions;
  }, [mediaPositions]);

  useEffect(() => {
    sessionUiRef.current = deps.session;
  }, [deps.session]);

  useEffect(() => {
    playbackStateRef.current = {
      activeMediaId,
      mediaTimeSec,
      playbackRate,
      isPaused,
    };
  }, [activeMediaId, mediaTimeSec, playbackRate, isPaused]);

  useEffect(() => {
    activeMediaIndexRef.current = activeMediaIndex;
  }, [activeMediaIndex]);

  useEffect(() => {
    const sessionId = deps.session?.sessionId ?? null;
    if (sessionId === lastSessionIdRef.current) {
      return;
    }
    lastSessionIdRef.current = sessionId;
    playbackStateGenerationRef.current += 1;

    setSnapToTimeSec(null);
    setSnapToken(0);
    setIsPausedState(true);
    setPlaybackRateState(1);
    setMediaTimeSecState(0);

    if (!deps.session) {
      setActiveMediaIndex(-1);
      setActiveMediaId(null);
      playbackStateRef.current = {
        ...playbackStateRef.current,
        activeMediaId: null,
        mediaTimeSec: 0,
        playbackRate: 1,
        isPaused: true,
      };
      const emptyPositions = {};
      mediaPositionsRef.current = emptyPositions;
      setMediaPositions(emptyPositions);
      activeMediaIndexRef.current = -1;
      return;
    }

    const savedPositions = deps.session.playbackState?.mediaPositions ?? {};
    const nextPositions = { ...savedPositions };
    mediaPositionsRef.current = nextPositions;
    setMediaPositions(nextPositions);

    const nextIndex = resolveSnapshotActiveMediaIndex(deps.session);

    if (nextIndex === -1) {
      setActiveMediaIndex(-1);
      setActiveMediaId(null);
      playbackStateRef.current = {
        activeMediaId: null,
        mediaTimeSec: 0,
        playbackRate: 1,
        isPaused: true,
      };
      activeMediaIndexRef.current = -1;
      return;
    }

    const media = deps.session.media.assets[nextIndex];
    const savedPosition = savedPositions[media.mediaId] ?? 0;

    playbackStateRef.current = {
      activeMediaId: media.mediaId,
      mediaTimeSec: savedPosition,
      playbackRate: 1,
      isPaused: true,
    };
    activeMediaIndexRef.current = nextIndex;
    setActiveMediaIndex(nextIndex);
    setActiveMediaId(media.mediaId);
    setMediaTimeSecState(savedPosition);
  }, [deps.session]);

  useEffect(() => {
    if (!deps.session) {
      return;
    }
    const currentActiveMediaId = playbackStateRef.current.activeMediaId;
    if (!currentActiveMediaId) {
      return;
    }
    const resolvedIndex = deps.session.media.assets.findIndex((asset) => asset.mediaId === currentActiveMediaId);
    if (resolvedIndex === -1 || resolvedIndex === activeMediaIndexRef.current) {
      return;
    }
    activeMediaIndexRef.current = resolvedIndex;
    setActiveMediaIndex(resolvedIndex);
  }, [deps.session]);

  useEffect(() => {
    if (!deps.session) {
      return;
    }

    const currentActiveMediaId = playbackStateRef.current.activeMediaId;
    if (currentActiveMediaId === null) {
      return;
    }

    const currentStillExists = deps.session.media.assets.some((asset) => asset.mediaId === currentActiveMediaId);
    if (currentStillExists) {
      return;
    }

    const snapshotPositions = { ...(deps.session.playbackState?.mediaPositions ?? {}) };
    mediaPositionsRef.current = snapshotPositions;
    setMediaPositions(snapshotPositions);

    const snapshotActiveMediaId = deps.session.playbackState?.activeMediaId ?? null;
    if (snapshotActiveMediaId === null) {
      activeMediaIndexRef.current = -1;
      setActiveMediaIndex(-1);
      setActiveMediaId(null);
      setMediaTimeSecState(0);
      setIsPausedState(true);
      setPlaybackRateState(1);
      playbackStateRef.current = {
        activeMediaId: null,
        mediaTimeSec: 0,
        playbackRate: 1,
        isPaused: true,
      };
      return;
    }

    const nextIndex = deps.session.media.assets.findIndex((asset) => asset.mediaId === snapshotActiveMediaId);
    if (nextIndex === -1) {
      activeMediaIndexRef.current = -1;
      setActiveMediaIndex(-1);
      setActiveMediaId(null);
      setMediaTimeSecState(0);
      setIsPausedState(true);
      setPlaybackRateState(1);
      playbackStateRef.current = {
        activeMediaId: null,
        mediaTimeSec: 0,
        playbackRate: 1,
        isPaused: true,
      };
      return;
    }

    const savedPosition = snapshotPositions[snapshotActiveMediaId] ?? 0;
    activeMediaIndexRef.current = nextIndex;
    setActiveMediaIndex(nextIndex);
    setActiveMediaId(snapshotActiveMediaId);
    setMediaTimeSecState(savedPosition);
    setIsPausedState(true);
    setPlaybackRateState(1);
    playbackStateRef.current = {
      activeMediaId: snapshotActiveMediaId,
      mediaTimeSec: savedPosition,
      playbackRate: 1,
      isPaused: true,
    };
  }, [deps.session]);

  useEffect(() => {
    if (!deps.session) {
      return;
    }
    const activeIndex = activeMediaIndexRef.current;
    if (activeIndex >= deps.session.media.assets.length) {
      activeMediaIndexRef.current = -1;
      setActiveMediaIndex(-1);
      setActiveMediaId(null);
      playbackStateRef.current = {
        ...playbackStateRef.current,
        activeMediaId: null,
        mediaTimeSec: 0,
        playbackRate: 1,
        isPaused: true,
      };
      setMediaTimeSecState(0);
      return;
    }
    if (activeIndex === -1) {
      setActiveMediaId(null);
      playbackStateRef.current = {
        ...playbackStateRef.current,
        activeMediaId: null,
      };
      return;
    }
    const media = deps.session.media.assets[activeIndex];
    if (!media) {
      return;
    }
    if (media.mediaId !== playbackStateRef.current.activeMediaId) {
      playbackStateRef.current = {
        ...playbackStateRef.current,
        activeMediaId: media.mediaId,
      };
      setActiveMediaId(media.mediaId);
    }
  }, [activeMediaIndex, deps.session]);

  const setPaused = useCallback((paused: boolean) => {
    setIsPausedState(paused);
    playbackStateRef.current = {
      ...playbackStateRef.current,
      isPaused: paused,
    };
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    setPlaybackRateState(rate);
    playbackStateRef.current = {
      ...playbackStateRef.current,
      playbackRate: rate,
    };
  }, []);

  const setMediaTimeSec = useCallback((timeSec: number) => {
    setMediaTimeSecState(timeSec);
    playbackStateRef.current = {
      ...playbackStateRef.current,
      mediaTimeSec: timeSec,
    };
  }, []);

  const requestSnapToTimeSec = useCallback((timeSec: number) => {
    setSnapToTimeSec(timeSec);
    setSnapToken((t) => t + 1);
  }, []);

  const clearSnap = useCallback(() => {
    setSnapToTimeSec(null);
  }, []);

  type PersistPlaybackStateResult =
    | { ok: true }
    | { ok: false; code: 'stale' | 'invalid_input' | 'ipc_failed' | 'queue_error'; message: string };

  const persistPlaybackState = useCallback(async (
    mediaId: UUID | null,
    positions: Record<string, number>
  ): Promise<PersistPlaybackStateResult> => {
    for (const [id, time] of Object.entries(positions)) {
      if (!Number.isFinite(time) || time < 0) {
        const message = `Invalid position for media ${id}: ${time}`;
        return { ok: false, code: 'invalid_input', message };
      }
    }

    const enqueuedGeneration = playbackStateGenerationRef.current;
    let result: PersistPlaybackStateResult = { ok: false, code: 'queue_error', message: 'Not executed' };

    const work = async () => {
      if (playbackStateGenerationRef.current !== enqueuedGeneration) {
        result = { ok: false, code: 'stale', message: 'Session generation changed' };
        return;
      }

      const basePositions = sessionUiRef.current?.playbackState?.mediaPositions ?? {};
      const updatedPositions = { ...basePositions, ...positions };
      for (const [id, time] of Object.entries(updatedPositions)) {
        if (!Number.isFinite(time) || time < 0) {
          result = { ok: false, code: 'invalid_input', message: `Invalid position for media ${id}: ${time}` };
          return;
        }
      }

      const ipcResult = await deps.api.session.setPlaybackState({
        activeMediaId: mediaId,
        mediaPositions: updatedPositions,
      });

      if (playbackStateGenerationRef.current !== enqueuedGeneration) {
        result = { ok: false, code: 'stale', message: 'Session closed during IPC' };
        return;
      }

      if (!ipcResult.ok) {
        result = { ok: false, code: 'ipc_failed', message: ipcResult.message };
      } else {
        deps.persistence.markDirty();
        result = { ok: true };
      }
    };

    playbackStateQueueRef.current = playbackStateQueueRef.current.then(work).catch((err) => {
      result = {
        ok: false,
        code: 'queue_error',
        message: err instanceof Error ? err.message : String(err),
      };
    });

    await playbackStateQueueRef.current;
    return result;
  }, [deps.api.session, deps.persistence]);

  const commitSeek = useCallback((timeSec: number) => {
    if (!Number.isFinite(timeSec) || timeSec < 0) {
      deps.errors.set(`Invalid seek time: ${timeSec}`);
      return;
    }
    if (!deps.session) {
      deps.errors.set('Cannot seek without active session');
      return;
    }
    const activeMediaId = playbackStateRef.current.activeMediaId;
    if (!activeMediaId) {
      deps.errors.set('Cannot seek without active media');
      return;
    }

    const updatedPositions = { ...mediaPositionsRef.current, [activeMediaId]: timeSec };
    mediaPositionsRef.current = updatedPositions;
    setMediaPositions(updatedPositions);
    setMediaTimeSecState(timeSec);
    playbackStateRef.current = {
      ...playbackStateRef.current,
      mediaTimeSec: timeSec,
    };

    void persistPlaybackState(activeMediaId, updatedPositions)
      .then((result) => {
        if (!result.ok) {
          if (result.code === 'stale') {
            return;
          }
          deps.errors.set(`Failed to save playback position: ${result.message}`);
        }
      })
      .catch((err) => {
        deps.errors.set(`Failed to save playback position: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [deps.errors, deps.session, persistPlaybackState]);

  // Auto-select first media when assets exist and none selected.
  const selectMedia = useCallback((index: number) => {
    if (!deps.session || index < 0 || index >= deps.session.media.assets.length) return;
    if (index === activeMediaIndexRef.current) return;

    const newMedia = deps.session.media.assets[index];
    const currentPositions = mediaPositionsRef.current;
    const currentActive = playbackStateRef.current.activeMediaId;
    const currentTime = playbackStateRef.current.mediaTimeSec;
    const currentRate = playbackStateRef.current.playbackRate;

    const updatedPositions = currentActive
      ? { ...currentPositions, [currentActive]: currentTime }
      : { ...currentPositions };

    mediaPositionsRef.current = updatedPositions;
    setMediaPositions(updatedPositions);
    activeMediaIndexRef.current = index;

    const savedPosition = updatedPositions[newMedia.mediaId] ?? 0;

    setIsPausedState(true);

    playbackStateRef.current = {
      activeMediaId: newMedia.mediaId,
      mediaTimeSec: savedPosition,
      playbackRate: currentRate,
      isPaused: true,
    };

    setActiveMediaIndex(index);
    setActiveMediaId(newMedia.mediaId);
    setMediaTimeSecState(savedPosition);

    void persistPlaybackState(newMedia.mediaId, updatedPositions)
      .then((result) => {
        if (!result.ok) {
          if (result.code === 'stale') {
            return;
          }
          deps.errors.set(`Failed to save playback position: ${result.message}`);
        }
      })
      .catch((err) => {
        deps.errors.set(`Failed to save playback position: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [deps.errors, deps.session, persistPlaybackState]);

  return {
    state: {
      activeMediaIndex,
      activeMediaId,
      mediaTimeSec,
      isPaused,
      playbackRate,
      mediaPositions,
      snapToTimeSec,
      snapToken,
    },
    actions: {
      selectMedia,
      setPaused,
      setPlaybackRate,
      setMediaTimeSec,
      commitSeek,
      requestSnapToTimeSec,
      clearSnap,
    },
    queries: {
      getActiveMediaId: () => playbackStateRef.current.activeMediaId,
      getMediaTimeSec: () =>
        playbackStateRef.current.activeMediaId ? playbackStateRef.current.mediaTimeSec : null,
      getPlaybackRate: () => playbackStateRef.current.playbackRate,
    },
  };
}
