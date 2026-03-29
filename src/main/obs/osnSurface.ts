// src/main/obs/osnSurface.ts
// Pinned expected obs-studio-node signal names for our OSN integration.
// Runtime verification required: ObsEngine.initialize() must confirm these signals
// are emitted as expected; if not, fail closed and block recording.

/**
 * Expected OBS output signal names based on libobs source.
 * String-literal types enforce determinism at compile time.
 *
 * Failure modes:
 * - Recording failure is signaled via 'stop' with a non-zero error code (not a separate event)
 * - File I/O errors emit 'writing_error' (disk full, permission denied, etc.)
 */
export interface OsnSignalNames {
  /** Emitted when recording has successfully started */
  recordingStarted: 'start';
  /** Emitted when recording has stopped (check error code for failure) */
  recordingStopped: 'stop';
  /** Emitted on file write errors during recording */
  recordingWriteError: 'writing_error';
}

/**
 * Pinned signal names for OSN integration.
 * These are expected values; runtime verification is required before use.
 */
export const OSN_SIGNAL_NAMES: OsnSignalNames = {
  recordingStarted: 'start',
  recordingStopped: 'stop',
  recordingWriteError: 'writing_error',
} as const;
