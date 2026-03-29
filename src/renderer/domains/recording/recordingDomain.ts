import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionUiSnapshot } from '../../../shared/ipc/sessionUi';
import type {
  PlaybackEventType,
  RecordingSegment,
} from '../../../shared/sessionPackage/types';
import { newId } from '../../../shared/sessionPackage/types';
import type { SessionStatus } from '../../app/appTypes';
import type { AppCommonDeps } from '../../app/appDeps';
import {
  buildPlaybackEvent,
  type TelemetryWriteContext,
} from '../../telemetry/telemetry';
import {
  useSessionClock,
  type SessionTimeResult,
} from '../../session/useSessionClock';
import type { InputDomain } from '../input/inputDomain';
import type {
  PlaybackDomainQueries,
  PlaybackDomainState,
} from '../playback/playbackDomain';
import type { SessionDomainActions } from '../session/sessionDomain';

export interface RecordingDomainState {
  /** Synchronous gate for marker/telemetry writes (mirrors internal ref; not just React state). */
  recordingActive: boolean;
  /** Sticky fatal flag (clock regression or telemetry IPC failure). */
  fatalClockError: boolean;
  /** For UI display; updated at least 1Hz while recording. */
  sessionTimeSec: number;
}

export interface RecordingDomainQueries {
  /** SSoT for anchorSessionTimeSec and telemetry timestamps. */
  getSessionTimeSec(): SessionTimeResult;
}

export interface RecordingDomainActions {
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  /**
   * Telemetry writer (SSoT; safe to call from playback UI/commands).
   * Must be a deterministic no-op when `recordingActive` is false.
   */
  logTelemetry(type: PlaybackEventType): void;
}

export function useRecordingDomain(
  deps: AppCommonDeps & {
    session: SessionUiSnapshot | null;
    sessionDir: string | null;
    sessionStatus: SessionStatus;
    setSessionStatus(status: SessionStatus): void;
    sessionActions: Pick<SessionDomainActions, 'recoverInterruptedRecording'>;
    input: InputDomain;
    playback: { state: PlaybackDomainState; queries: PlaybackDomainQueries };
  },
): {
  state: RecordingDomainState;
  actions: RecordingDomainActions;
  queries: RecordingDomainQueries;
} {
  const sessionClock = useSessionClock();

  const [fatalClockError, setFatalClockError] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const [sessionTimeSec, setSessionTimeSec] = useState(0);

  const telemetryQueueRef = useRef<Promise<void>>(Promise.resolve());
  const telemetryGenerationRef = useRef(0);
  const recordingLifecycleGenRef = useRef(0);
  const recordingActiveRef = useRef(false);
  const currentRecordingIdRef = useRef<string | null>(null);
  const recordingStartOffsetRef = useRef(0);
  const sessionStatusRef = useRef<SessionStatus>(deps.sessionStatus);

  useEffect(() => {
    sessionStatusRef.current = deps.sessionStatus;
  }, [deps.sessionStatus]);

  const setSessionStatusDeterministic = useCallback(
    (status: SessionStatus) => {
      sessionStatusRef.current = status;
      deps.setSessionStatus(status);
    },
    [deps.setSessionStatus],
  );

  const setFatalAndIncrementGeneration = useCallback(
    (message: string) => {
      recordingActiveRef.current = false;
      setRecordingActive(false);
      telemetryGenerationRef.current += 1;
      setFatalClockError(true);
      deps.errors.set(message);
      setSessionStatusDeterministic('error');
    },
    [deps.errors, setSessionStatusDeterministic],
  );

  const getTelemetryContext = useCallback((): TelemetryWriteContext => {
    return {
      getSessionTimeSec: () => sessionClock.getSessionTimeSec(),
      getActiveMediaId: () => deps.playback.queries.getActiveMediaId(),
      getMediaTimeSec: () => deps.playback.queries.getMediaTimeSec(),
      getPlaybackRate: () => deps.playback.queries.getPlaybackRate(),
    };
  }, [deps.playback.queries, sessionClock]);

  const logTelemetry = useCallback(
    (type: PlaybackEventType) => {
      if (!recordingActiveRef.current) return;

      const enqueuedGeneration = telemetryGenerationRef.current;
      telemetryQueueRef.current = telemetryQueueRef.current.then(async () => {
        if (telemetryGenerationRef.current !== enqueuedGeneration) {
          return;
        }

        try {
          const result = buildPlaybackEvent(type, getTelemetryContext());
          if (result.ok) {
            const ipcResult = await deps.api.session.addPlaybackEvent(
              result.event,
            );
            if (!ipcResult.ok) {
              setFatalAndIncrementGeneration(
                `Failed to sync telemetry: ${ipcResult.message}`,
              );
              return;
            }

            if (telemetryGenerationRef.current !== enqueuedGeneration) {
              return;
            }

            deps.persistence.markDirty();
          } else {
            setFatalAndIncrementGeneration(
              `Fatal telemetry error: ${result.message}`,
            );
          }
        } catch (err) {
          setFatalAndIncrementGeneration(
            `Telemetry error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    },
    [
      deps.api.session,
      deps.persistence,
      getTelemetryContext,
      setFatalAndIncrementGeneration,
    ],
  );

  const cleanupObsAfterFailure = useCallback(async (): Promise<
    { ok: true } | { ok: false; message: string }
  > => {
    const cleanupErrors: string[] = [];
    let needsForceReset = false;

    try {
      const stopResult = await deps.api.obs.stopRecording();
      if (!stopResult.ok && stopResult.code !== 'not_recording') {
        needsForceReset = true;
        cleanupErrors.push(`stopRecording: ${stopResult.message}`);
      }
    } catch (err) {
      needsForceReset = true;
      cleanupErrors.push(
        `stopRecording threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      const shutdownResult = await deps.api.obs.shutdown();
      if (!shutdownResult.ok) {
        needsForceReset = true;
        cleanupErrors.push(`shutdown: ${shutdownResult.message}`);
      }
    } catch (err) {
      needsForceReset = true;
      cleanupErrors.push(
        `shutdown threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!needsForceReset) {
      return { ok: true };
    }

    try {
      const resetResult = await deps.api.obs.forceReset();
      if (!resetResult.ok) {
        const parts = [
          ...cleanupErrors,
          `force-reset errors: ${resetResult.errors.join('; ')}`,
        ];
        return { ok: false, message: parts.join('; ') };
      }
      if (cleanupErrors.length > 0) {
        console.warn(
          '[RecordingDomain] OBS cleanup required force-reset after failure:',
          cleanupErrors.join('; '),
        );
      }
      return { ok: true };
    } catch (err) {
      const parts = [
        ...cleanupErrors,
        `force-reset threw: ${err instanceof Error ? err.message : String(err)}`,
      ];
      return { ok: false, message: parts.join('; ') };
    }
  }, [deps.api.obs]);

  const handleUnexpectedObsStop = useCallback(
    async (eventMessage: string) => {
      // Only react while a recording attempt is in-flight or running
      if (
        sessionStatusRef.current !== 'starting' &&
        sessionStatusRef.current !== 'running'
      ) {
        return;
      }
      if (!deps.session || !deps.sessionDir) {
        deps.errors.set(
          'Recording failed: missing session context during unexpected OBS stop',
        );
        setSessionStatusDeterministic('error');
        recordingActiveRef.current = false;
        setRecordingActive(false);
        telemetryGenerationRef.current += 1;
        recordingLifecycleGenRef.current += 1;
        if (sessionClock.isRunning) {
          const stopResult = sessionClock.stop();
          if (!stopResult.ok) {
            console.warn(
              '[RecordingDomain] sessionClock.stop failed during unexpected OBS stop (no session context)',
              stopResult.message,
            );
          }
        }
        void deps.api.obs
          .forceReset()
          .catch((err) =>
            console.warn(
              '[RecordingDomain] forceReset failed during unexpected OBS stop (no session context)',
              err instanceof Error ? err.message : String(err),
            ),
          );
        return;
      }

      try {
        // Prevent further telemetry writes and UI record indicators
        recordingActiveRef.current = false;
        setRecordingActive(false);
        telemetryGenerationRef.current += 1;
        recordingLifecycleGenRef.current += 1;
        setSessionStatusDeterministic('stopping');
        deps.input.actions.resetToPlayerMode();

        if (sessionClock.isRunning) {
          const stopResult = sessionClock.stop();
          if (!stopResult.ok) {
            // Not user-actionable in this path (OBS already failed), but keep diagnostics.
            console.warn(
              '[RecordingDomain] sessionClock.stop failed during unexpected OBS stop',
              stopResult.message,
            );
          }
        }

        const extraParts = [eventMessage];
        try {
          const resetResult = await deps.api.obs.forceReset();
          if (!resetResult.ok) {
            extraParts.push(
              `OBS cleanup: force-reset errors: ${resetResult.errors.join('; ')}`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          extraParts.push(`OBS cleanup: force-reset threw: ${msg}`);
        }

        await deps.sessionActions.recoverInterruptedRecording({
          reason: 'stop_failure',
          extraErrorContext: extraParts.join('; '),
        });
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        deps.errors.set(
          `Recording failed: ${eventMessage}. Recover failed: ${errMessage}`,
        );
        setSessionStatusDeterministic('error');
      }
    },
    [
      deps.api.obs,
      deps.errors,
      deps.input.actions,
      deps.session,
      deps.sessionActions,
      deps.sessionDir,
      setSessionStatusDeterministic,
      sessionClock,
    ],
  );

  const unexpectedStopHandlerRef = useRef<
    (message: string) => Promise<void>
  >(handleUnexpectedObsStop);

  useEffect(() => {
    unexpectedStopHandlerRef.current = handleUnexpectedObsStop;
  }, [handleUnexpectedObsStop]);

  const startRecording = useCallback(async () => {
    if (
      sessionStatusRef.current === 'starting' ||
      sessionStatusRef.current === 'running' ||
      sessionStatusRef.current === 'stopping'
    ) {
      return;
    }

    if (!deps.session || !deps.sessionDir) return;

    if (deps.session.media.assets.length === 0) {
      deps.errors.set(
        'Import at least one media file before starting recording.',
      );
      return;
    }

    setSessionStatusDeterministic('starting');
    deps.errors.clear();

    try {
      // Capture lifecycle generation to detect async cancellation (e.g., unexpected OBS stop)
      const startGen = recordingLifecycleGenRef.current;

      const accumulatedTimeResult =
        await deps.api.session.getAccumulatedSessionTime();
      if (recordingLifecycleGenRef.current !== startGen) return;
      if (!accumulatedTimeResult.ok) {
        deps.errors.set(
          `Failed to get accumulated time: ${accumulatedTimeResult.message}`,
        );
        setSessionStatusDeterministic('error');
        return;
      }
      recordingStartOffsetRef.current =
        accumulatedTimeResult.accumulatedTimeSec;

      currentRecordingIdRef.current = newId();

      const setInProgressResult = await deps.api.session.setInProgressRecording(
        currentRecordingIdRef.current,
        accumulatedTimeResult.accumulatedTimeSec,
      );
      if (!setInProgressResult.ok) {
        deps.errors.set(
          `Failed to set in-progress recording: ${setInProgressResult.message}`,
        );
        setSessionStatusDeterministic('error');
        return;
      }
      if (recordingLifecycleGenRef.current !== startGen) return;

      const saveResult = await deps.api.session.save();
      if (recordingLifecycleGenRef.current !== startGen) return;
      if (!saveResult.ok) {
        const errors: string[] = [
          `Failed to save session before recording: ${saveResult.message}`,
        ];
        const clearResult = await deps.api.session.clearInProgressRecording();
        if (!clearResult.ok)
          errors.push(`clear failed: ${clearResult.message}`);
        const retrySave = await deps.api.session.save();
        if (!retrySave.ok)
          errors.push(`retry save failed: ${retrySave.message}`);
        deps.errors.set(errors.join('; '));
        setSessionStatusDeterministic('error');
        return;
      }

      const obsInitOptions = {
        outputDir: deps.sessionDir,
        resolution: {
          width: Math.floor(window.innerWidth),
          height: Math.floor(window.innerHeight),
        },
        fps: 60 as const,
        windowTitle: 'SessionMap',
      };

      const initResult = await deps.api.obs.initialize(obsInitOptions);
      if (recordingLifecycleGenRef.current !== startGen) return;
      if (!initResult.ok) {
        const resetResult = await deps.api.obs.forceReset();
        const errors: string[] = [`OBS init failed: ${initResult.message}`];
        errors.push('force-reset applied');
        if (!resetResult.ok) {
          errors.push(`reset had errors: ${resetResult.errors.join('; ')}`);
        }
        const clearResult = await deps.api.session.clearInProgressRecording();
        if (!clearResult.ok)
          errors.push(`clear failed: ${clearResult.message}`);
        const saveResult = await deps.api.session.save();
        if (!saveResult.ok) errors.push(`save failed: ${saveResult.message}`);

        deps.errors.set(
          `${errors.join('; ')}. Click Start Recording to retry.`,
        );
        setSessionStatusDeterministic('stopped');
        return;
      }

      const startResult = await deps.api.obs.startRecording();
      if (recordingLifecycleGenRef.current !== startGen) return;
      if (!startResult.ok) {
        const errors: string[] = [`OBS start failed: ${startResult.message}`];
        const clearResult = await deps.api.session.clearInProgressRecording();
        if (!clearResult.ok)
          errors.push(`clear failed: ${clearResult.message}`);
        const saveResult = await deps.api.session.save();
        if (!saveResult.ok) errors.push(`save failed: ${saveResult.message}`);
        const obsCleanupResult = await cleanupObsAfterFailure();
        if (!obsCleanupResult.ok)
          errors.push(`OBS cleanup failed: ${obsCleanupResult.message}`);

        deps.errors.set(errors.join('; '));
        setSessionStatusDeterministic(errors.length > 1 ? 'error' : 'stopped');
        return;
      }

      const baselineResult = sessionClock.setBaseline(
        accumulatedTimeResult.accumulatedTimeSec,
      );
      if (recordingLifecycleGenRef.current !== startGen) return;
      if (!baselineResult.ok) {
        const errors: string[] = [
          `Clock baseline failed: ${baselineResult.message}`,
        ];
        const clearResult = await deps.api.session.clearInProgressRecording();
        if (!clearResult.ok)
          errors.push(`clear failed: ${clearResult.message}`);
        const saveResult = await deps.api.session.save();
        if (!saveResult.ok) errors.push(`save failed: ${saveResult.message}`);
        const obsCleanupResult = await cleanupObsAfterFailure();
        if (!obsCleanupResult.ok)
          errors.push(`OBS cleanup failed: ${obsCleanupResult.message}`);

        deps.errors.set(errors.join('; '));
        setSessionStatusDeterministic(errors.length > 1 ? 'error' : 'stopped');
        return;
      }

      const clockStartResult = sessionClock.start(
        startResult.recordingStartedAtEpochMs,
        accumulatedTimeResult.accumulatedTimeSec,
      );
      if (recordingLifecycleGenRef.current !== startGen) return;
      if (!clockStartResult.ok) {
        const errors: string[] = [
          `Clock start failed: ${clockStartResult.message}`,
        ];
        const clearResult = await deps.api.session.clearInProgressRecording();
        if (!clearResult.ok)
          errors.push(`clear failed: ${clearResult.message}`);
        const saveResult = await deps.api.session.save();
        if (!saveResult.ok) errors.push(`save failed: ${saveResult.message}`);
        const obsCleanupResult = await cleanupObsAfterFailure();
        if (!obsCleanupResult.ok)
          errors.push(`OBS cleanup failed: ${obsCleanupResult.message}`);

        deps.errors.set(errors.join('; '));
        setSessionStatusDeterministic(errors.length > 1 ? 'error' : 'stopped');
        return;
      }

      recordingActiveRef.current = true;
      setRecordingActive(true);
      setFatalClockError(false);
      setSessionStatusDeterministic('running');

      logTelemetry('load');
    } catch (err) {
      deps.errors.set(
        `Failed to start recording: ${err instanceof Error ? err.message : String(err)}`,
      );
      setSessionStatusDeterministic('error');
    }
  }, [
    cleanupObsAfterFailure,
    deps.api.obs,
    deps.api.session,
    deps.errors,
    deps.session,
    deps.sessionDir,
    setSessionStatusDeterministic,
    logTelemetry,
    sessionClock,
  ]);

  const stopRecording = useCallback(async () => {
    // Idempotency guard: ignore duplicate stop triggers unless recording is actively running.
    if (sessionStatusRef.current !== 'running') {
      return;
    }

    if (!deps.session || !deps.sessionDir) return;

    setSessionStatusDeterministic('stopping');
    deps.input.actions.resetToPlayerMode();

    let stopSucceeded = false;
    let clockRegressionError: string | null = null;
    let obsStopWarningMessage: string | null = null;

    recordingActiveRef.current = false;
    setRecordingActive(false);

    let finalSessionTime = 0;
    if (sessionClock.isRunning) {
      const stopResult = sessionClock.stop();
      if (stopResult.ok) {
        finalSessionTime = stopResult.sec;
      } else {
        clockRegressionError = `Clock regression on stop: ${stopResult.message}`;
      }
    }
    telemetryGenerationRef.current += 1;

    try {
      const stopResult = await deps.api.obs.stopRecording();
      if (!stopResult.ok) {
        deps.errors.set(`OBS stop failed: ${stopResult.message}`);
        setSessionStatusDeterministic('error');
        return;
      }
      if (Array.isArray(stopResult.warnings) && stopResult.warnings.length > 0) {
        obsStopWarningMessage = `OBS finalize warnings: ${stopResult.warnings.join('; ')}`;
      }

      if (clockRegressionError) {
        deps.errors.set(
          `${clockRegressionError}. Recording file saved but segment metadata not persisted.`,
        );
        setSessionStatusDeterministic('error');
      } else {
        const recordingDuration = Math.floor(
          finalSessionTime - recordingStartOffsetRef.current,
        );
        const segment: RecordingSegment = {
          id: currentRecordingIdRef.current!,
          startSessionTimeSec: recordingStartOffsetRef.current,
          durationSec: recordingDuration,
          file: stopResult.obsRecordingPath,
        };

        const segmentResult =
          await deps.api.session.addRecordingSegment(segment);
        if (!segmentResult.ok) {
          deps.errors.set(
            `Failed to save recording segment: ${segmentResult.message}`,
          );
          setSessionStatusDeterministic('error');
          return;
        }

        currentRecordingIdRef.current = null;
        await deps.persistence.saveNow();
        stopSucceeded = true;
      }
    } catch (err) {
      deps.errors.set(
        `Failed to stop recording: ${err instanceof Error ? err.message : String(err)}`,
      );
      setSessionStatusDeterministic('error');
    } finally {
      const attemptObsShutdown = async (): Promise<string | null> => {
        try {
          const shutdownResult = await deps.api.obs.shutdown();
          if (!shutdownResult.ok) {
            const resetResult = await deps.api.obs.forceReset();
            const parts = [
              `OBS shutdown failed: ${shutdownResult.message}`,
              'force-reset applied',
            ];
            if (!resetResult.ok) {
              parts.push(`reset errors: ${resetResult.errors.join('; ')}`);
            }
            return parts.join('; ');
          }
          return null;
        } catch (shutdownErr) {
          const resetResult = await deps.api.obs.forceReset();
          const parts = [
            `OBS shutdown error: ${shutdownErr instanceof Error ? shutdownErr.message : String(shutdownErr)}`,
            'force-reset applied',
          ];
          if (!resetResult.ok) {
            parts.push(`reset errors: ${resetResult.errors.join('; ')}`);
          }
          return parts.join('; ');
        }
      };

      if (stopSucceeded) {
        setFatalClockError(false);
        const obsShutdownError = await attemptObsShutdown();
        const notices: string[] = [];
        if (obsStopWarningMessage) {
          notices.push(obsStopWarningMessage);
        }
        if (obsShutdownError) {
          notices.push(obsShutdownError);
        }
        if (notices.length > 0) {
          deps.errors.set(`Recording saved. ${notices.join('; ')}.`);
        } else {
          deps.errors.clear();
        }
        setSessionStatusDeterministic('stopped');
        return;
      }

      const obsErr = await attemptObsShutdown();
      let recovered = false;
      try {
        recovered = await deps.sessionActions.recoverInterruptedRecording({
          reason: 'stop_failure',
          extraErrorContext: obsErr,
        });
      } catch (err) {
        const baseMessage = `Failed to recover interrupted recording: ${
          err instanceof Error ? err.message : String(err)
        }`;
        deps.errors.set(obsErr ? `${baseMessage}. ${obsErr}` : baseMessage);
        setSessionStatusDeterministic('error');
        return;
      }
      if (recovered) {
        setFatalClockError(false);
      }
    }
  }, [
    deps.api.obs,
    deps.api.session,
    deps.errors,
    deps.input.actions,
    deps.persistence,
    deps.session,
    deps.sessionActions,
    deps.sessionDir,
    setSessionStatusDeterministic,
    sessionClock,
  ]);

  const TICK_INTERVAL_SEC = 5;
  const lastTickBucketRef = useRef(-1);

  useEffect(() => {
    if (!sessionClock.isRunning || fatalClockError) {
      lastTickBucketRef.current = -1;
      return;
    }

    const intervalId = setInterval(() => {
      if (deps.playback.queries.getActiveMediaId() === null) {
        return;
      }

      const timeResult = sessionClock.getSessionTimeSec();
      if (!timeResult.ok) {
        logTelemetry('tick');
        return;
      }

      const currentBucket = Math.floor(timeResult.sec / TICK_INTERVAL_SEC);
      if (currentBucket > lastTickBucketRef.current) {
        lastTickBucketRef.current = currentBucket;
        logTelemetry('tick');
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [deps.playback.queries, fatalClockError, logTelemetry, sessionClock]);

  useEffect(() => {
    if (!sessionClock.isRunning) {
      return;
    }

    const timerId = setInterval(() => {
      const result = sessionClock.getSessionTimeSec();
      if (result.ok) {
        setSessionTimeSec(result.sec);
      }
    }, 1000);

    return () => clearInterval(timerId);
  }, [sessionClock]);

  useEffect(() => {
    const subscriptionId = deps.api.obs.subscribeUnexpectedStop((event) => {
      void unexpectedStopHandlerRef.current(event.message);
    });
    return () => {
      deps.api.obs.unsubscribeUnexpectedStop(subscriptionId);
    };
  }, [deps.api.obs]);

  return {
    state: {
      recordingActive,
      fatalClockError,
      sessionTimeSec,
    },
    actions: {
      startRecording,
      stopRecording,
      logTelemetry,
    },
    queries: {
      getSessionTimeSec: sessionClock.getSessionTimeSec,
    },
  };
}
