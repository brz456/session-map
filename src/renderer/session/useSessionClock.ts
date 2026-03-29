// src/renderer/session/useSessionClock.ts
// Session clock anchored to recordingStartedAtEpochMs from main

import { useCallback, useMemo, useRef, useState } from 'react';

/** Result of getSessionTimeSec() and stop() - typed for explicit error handling */
export type SessionTimeResult =
  | { ok: true; sec: number }
  | { ok: false; code: 'clock_regression'; message: string; lastSec: number };

/** Result of start() - typed for explicit error handling */
export type StartResult =
  | { ok: true }
  | { ok: false; code: 'invalid_input' | 'clock_regression'; message: string; lastSec: number };

export interface SessionClock {
  /** Whether the session is currently running (recording active). */
  isRunning: boolean;
  /** Get the current session time in seconds (integer). Returns typed result for explicit error handling. */
  getSessionTimeSec(): SessionTimeResult;
  /**
   * Set the baseline time from loaded session data (accumulated time from prior recordings).
   * Must be called before start() when resuming a session with existing recordings.
   * Can only be called when clock is not running.
   * @param baselineSec - The accumulated session time to use as baseline (must be finite non-negative integer)
   */
  setBaseline(baselineSec: number): StartResult;
  /**
   * Start the clock with the provided epoch timestamp.
   * Returns typed result for explicit error handling.
   * Can only be called when clock is not running.
   * @param recordingStartedAtEpochMs - When OBS recording started (from main process), must not be in the future
   * @param offsetSec - Session time offset to resume from. Defaults to current baseline (lastSec).
   *                    Must equal lastSec for contiguous recordings.
   */
  start(recordingStartedAtEpochMs: number, offsetSec?: number): StartResult;
  /** Stop the clock. Returns typed result with final session time or error if regression detected. */
  stop(): SessionTimeResult;
}

/**
 * Hook to manage the session clock.
 *
 * The clock is anchored to `recordingStartedAtEpochMs` from main and uses
 * `performance.now()` for monotonic time advancement to avoid system clock jumps.
 *
 * Invariant: getSessionTimeSec().sec must be monotonic non-decreasing when ok=true.
 */
export function useSessionClock(): SessionClock {
  const [isRunning, setIsRunning] = useState(false);

  // Refs to store timing state without causing re-renders
  const recordingStartedAtEpochMsRef = useRef<number | null>(null);
  const elapsedAtStartMsRef = useRef<number>(0);
  const monoAtStartMsRef = useRef<number>(0);
  const lastSessionTimeSecRef = useRef<number>(0);
  // Offset for multi-recording sessions (accumulated time from previous recordings)
  const offsetSecRef = useRef<number>(0);
  // Ref to track if regression already detected (sticky within a recording; reset on successful stop)
  const regressionDetectedRef = useRef<boolean>(false);
  const regressionMessageRef = useRef<string>('');

  const start = useCallback((recordingStartedAtEpochMs: number, offsetSec?: number): StartResult => {
    // Fail-closed: reject if already running (caller must stop() first)
    if (recordingStartedAtEpochMsRef.current !== null) {
      return {
        ok: false,
        code: 'invalid_input',
        message: 'Cannot start: clock is already running',
        lastSec: lastSessionTimeSecRef.current,
      };
    }

    // Default offsetSec to current baseline (lastSessionTimeSecRef) if not provided
    // This allows callers to omit offsetSec after setBaseline()
    const effectiveOffsetSec = offsetSec ?? lastSessionTimeSecRef.current;

    // Fail-closed: reject invalid offsetSec (must be finite non-negative integer)
    // Note: do NOT set regressionDetectedRef for invalid_input - that's for clock regression only
    if (!Number.isFinite(effectiveOffsetSec) || !Number.isInteger(effectiveOffsetSec) || effectiveOffsetSec < 0) {
      const message = `Invalid offsetSec: ${effectiveOffsetSec}`;
      return { ok: false, code: 'invalid_input', message, lastSec: lastSessionTimeSecRef.current };
    }

    // Fail-closed: enforce contiguity invariant (offsetSec must exactly equal last known time)
    // This matches the recording contiguity invariant in validate.ts
    if (effectiveOffsetSec !== lastSessionTimeSecRef.current) {
      const message = `offsetSec ${effectiveOffsetSec} !== lastSec ${lastSessionTimeSecRef.current} violates contiguity invariant`;
      regressionDetectedRef.current = true;
      regressionMessageRef.current = message;
      return { ok: false, code: 'clock_regression', message, lastSec: lastSessionTimeSecRef.current };
    }

    // Fail-closed: reject invalid recordingStartedAtEpochMs
    // Note: do NOT set regressionDetectedRef for invalid_input - that's for clock regression only
    if (!Number.isFinite(recordingStartedAtEpochMs)) {
      const message = `Invalid recordingStartedAtEpochMs: ${recordingStartedAtEpochMs}`;
      return { ok: false, code: 'invalid_input', message, lastSec: lastSessionTimeSecRef.current };
    }

    // Calculate elapsed time from recording start to now (before setting refs)
    const elapsedAtStartMs = Date.now() - recordingStartedAtEpochMs;

    // Fail-closed: validate elapsed time is finite and non-negative (reject future timestamps)
    // Note: do NOT set regressionDetectedRef for invalid_input - that's for clock regression only
    if (!Number.isFinite(elapsedAtStartMs) || elapsedAtStartMs < 0) {
      const message = elapsedAtStartMs < 0
        ? `recordingStartedAtEpochMs is in the future (elapsed: ${elapsedAtStartMs}ms)`
        : `Invalid elapsedAtStartMs: ${elapsedAtStartMs}`;
      return { ok: false, code: 'invalid_input', message, lastSec: lastSessionTimeSecRef.current };
    }

    // All validations passed - set refs and start
    recordingStartedAtEpochMsRef.current = recordingStartedAtEpochMs;
    offsetSecRef.current = effectiveOffsetSec;
    elapsedAtStartMsRef.current = elapsedAtStartMs;
    monoAtStartMsRef.current = performance.now();

    // Initialize lastSessionTimeSec to offset (clock starts at offset, not 0)
    lastSessionTimeSecRef.current = effectiveOffsetSec;
    regressionDetectedRef.current = false;
    regressionMessageRef.current = '';

    setIsRunning(true);
    return { ok: true };
  }, []);

  const setBaseline = useCallback((baselineSec: number): StartResult => {
    // Can only set baseline when clock is not running
    if (recordingStartedAtEpochMsRef.current !== null) {
      return {
        ok: false,
        code: 'invalid_input',
        message: 'Cannot set baseline while clock is running',
        lastSec: lastSessionTimeSecRef.current,
      };
    }

    // Validate baselineSec is finite non-negative integer
    if (!Number.isFinite(baselineSec) || !Number.isInteger(baselineSec) || baselineSec < 0) {
      return {
        ok: false,
        code: 'invalid_input',
        message: `Invalid baselineSec: ${baselineSec} (must be finite non-negative integer)`,
        lastSec: lastSessionTimeSecRef.current,
      };
    }

    // Set baseline - this allows subsequent start(_, offsetSec) where offsetSec === baselineSec
    lastSessionTimeSecRef.current = baselineSec;
    // Clear any prior regression state when setting new baseline
    regressionDetectedRef.current = false;
    regressionMessageRef.current = '';

    return { ok: true };
  }, []);

  // Pure getter - no setState, returns typed result for caller to handle
  // Defined before stop() so stop() can use it as SSoT for time calculation
  const getSessionTimeSec = useCallback((): SessionTimeResult => {
    // Check regression BEFORE null-guard so start() validation errors are observable
    if (regressionDetectedRef.current) {
      return {
        ok: false,
        code: 'clock_regression',
        message: regressionMessageRef.current,
        lastSec: lastSessionTimeSecRef.current,
      };
    }

    if (recordingStartedAtEpochMsRef.current === null) {
      // Return last known session time (preserves time after stop() for multi-recording sessions)
      return { ok: true, sec: lastSessionTimeSecRef.current };
    }

    // Use monotonic clock to avoid system time jumps
    const elapsedSinceStartMs = performance.now() - monoAtStartMsRef.current;
    const totalElapsedMs = elapsedAtStartMsRef.current + elapsedSinceStartMs;
    // Add offset for multi-recording sessions (accumulated time from previous recordings)
    const sessionTimeSec = offsetSecRef.current + Math.floor(totalElapsedMs / 1000);

    // Fail-closed: validate computed values are valid before returning ok: true
    if (!Number.isFinite(totalElapsedMs)) {
      const message = `Invalid totalElapsedMs: ${totalElapsedMs}`;
      regressionDetectedRef.current = true;
      regressionMessageRef.current = message;
      return {
        ok: false,
        code: 'clock_regression',
        message,
        lastSec: lastSessionTimeSecRef.current,
      };
    }

    if (!Number.isFinite(sessionTimeSec) || !Number.isInteger(sessionTimeSec) || sessionTimeSec < 0) {
      const message = `Invalid sessionTimeSec: ${sessionTimeSec}`;
      regressionDetectedRef.current = true;
      regressionMessageRef.current = message;
      return {
        ok: false,
        code: 'clock_regression',
        message,
        lastSec: lastSessionTimeSecRef.current,
      };
    }

    // Enforce monotonic non-decreasing invariant
    if (sessionTimeSec < lastSessionTimeSecRef.current) {
      // Clock regression detected - mark as sticky and return error
      const message = `Clock regression detected: ${sessionTimeSec}s < last ${lastSessionTimeSecRef.current}s`;
      regressionDetectedRef.current = true;
      regressionMessageRef.current = message;
      return {
        ok: false,
        code: 'clock_regression',
        message,
        lastSec: lastSessionTimeSecRef.current,
      };
    }

    lastSessionTimeSecRef.current = sessionTimeSec;
    return { ok: true, sec: sessionTimeSec };
  }, []);

  const stop = useCallback((): SessionTimeResult => {
    // Use getSessionTimeSec() as SSoT to compute final time (avoids duplicated logic)
    const currentTime = getSessionTimeSec();

    // Always transition to stopped state
    setIsRunning(false);
    recordingStartedAtEpochMsRef.current = null;

    if (currentTime.ok) {
      lastSessionTimeSecRef.current = currentTime.sec;
      // Only clear regression state on success
      regressionDetectedRef.current = false;
      regressionMessageRef.current = '';
      return { ok: true, sec: currentTime.sec };
    }

    // Propagate error - don't clear regression state so caller sees the issue
    return currentTime;
  }, [getSessionTimeSec]);

  // Memoize to provide stable object reference (prevents effect churn in consumers)
  return useMemo(
    () => ({
      isRunning,
      getSessionTimeSec,
      setBaseline,
      start,
      stop,
    }),
    [isRunning, getSessionTimeSec, setBaseline, start, stop]
  );
}
