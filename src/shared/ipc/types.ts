// src/shared/ipc/types.ts
// Shared IPC-safe types (imported by both main and preload)
// This module defines all IPC contract types for clean layering.

import type { MediaAsset } from "../sessionPackage/types";
import type { SessionUiSnapshot } from "./sessionUi";

// =============================================================================
// OBS Types
// =============================================================================

export interface ObsInitOptions {
  outputDir: string;
  resolution: { width: number; height: number };
  fps: 60;
  /** Window title to capture (for window capture mode) */
  windowTitle: string;
}

export type ObsInitErrorCode = "init_failed" | "capture_setup_failed";

export type ObsInitResult =
  | { ok: true }
  | { ok: false; code: ObsInitErrorCode; message: string };

export type ObsStartErrorCode =
  | "not_initialized"
  | "start_failed"
  | "start_timeout";

/** Deterministic timeout for waiting on the verified recording-started signal. */
export const OBS_START_TIMEOUT_MS = 15_000;

/** Deterministic timeout for waiting on the verified recording-stopped signal. */
export const OBS_STOP_TIMEOUT_MS = 180_000;

export type ObsStartResult =
  | {
      ok: true;
      recordingStartedAtIso: string;
      recordingStartedAtEpochMs: number;
    }
  | { ok: false; code: ObsStartErrorCode; message: string };

export type ObsStopErrorCode =
  | "not_initialized"
  | "not_recording"
  | "stop_failed"
  | "stop_timeout"
  | "no_recording_file"
  | "multiple_recording_files"
  | "unsupported_recording_extension";

export type ObsStopResult =
  | { ok: true; obsRecordingPath: `recording/${string}`; warnings?: string[] }
  | { ok: false; code: ObsStopErrorCode; message: string };

export type ObsUnexpectedStopReason = "recording_stopped" | "write_error" | "ipc_fatal";

export type ObsUnexpectedStopEvent = {
  reason: ObsUnexpectedStopReason;
  /** OBS service code when available (0 = success, non-zero error). */
  obsCode?: number;
  /** Human-friendly description to surface in the UI. */
  message: string;
};

export type ObsStatus = {
  initialized: boolean;
  recording: boolean;
};

export type ObsShutdownResult =
  | { ok: true }
  | { ok: false; code: "shutdown_failed"; message: string };

/**
 * Result of force-resetting OBS engine state.
 * State is always reset to idle (so next initialize can work).
 * ok: false indicates cleanup errors occurred that should be surfaced to user.
 */
export type ObsForceResetResult =
  | { ok: true }
  | { ok: false; code: "cleanup_errors"; message: string; errors: string[] };

// =============================================================================
// Media Types
// =============================================================================

export type MediaErrorCode =
  | "file_not_found"
  | "invalid_path"
  | "invalid_extension"
  | "invalid_display_name"
  | "canonicalize_failed"
  | "metadata_read_failed"
  | "ffmpeg_missing"
  | "ffmpeg_failed";

export type MediaAddAssetResult =
  | { ok: true; asset: MediaAsset }
  | { ok: false; code: MediaErrorCode; message: string };

export type MediaGetMetadataResult =
  | { ok: true; durationSec: number | null; metadata: Record<string, unknown> }
  | { ok: false; code: MediaErrorCode; message: string };

export type MediaGetVideoInfoResult =
  | {
      ok: true;
      width: number;
      height: number;
      durationSec: number;
      fps: number | null;
    }
  | { ok: false; code: MediaErrorCode; message: string };

// =============================================================================
// Session Types
// =============================================================================

export type SessionErrorCode =
  | "no_active_session"
  | "session_already_active"
  | "create_failed"
  | "save_failed"
  | "load_failed"
  | "invalid_session_path"
  | "invalid_input"
  | "session_not_found"
  | "marker_not_found"
  | "bucket_not_found"
  | "bucket_in_use"
  | "tag_not_found"
  | "tag_in_use"
  | "media_not_found"
  | "media_in_use"
  | "media_duplicate_path"
  | "duplicate_name"
  | "telemetry_time_regression"
  | "ffmpeg_missing"
  | "ffmpeg_failed"
  | "export_failed";

export type SessionCreateResult =
  | { ok: true; sessionId: string; sessionDir: string }
  | { ok: false; code: SessionErrorCode; message: string };

export type SessionSaveResult =
  | { ok: true }
  | { ok: false; code: SessionErrorCode; message: string };

export type SessionLoadResult =
  | {
      ok: true;
      session: SessionUiSnapshot;
      sessionDir: string;
      uiRevision: number;
    }
  | { ok: false; code: SessionErrorCode; message: string };

export type SessionCloseResult =
  | { ok: true }
  | { ok: false; code: SessionErrorCode; message: string };

export type SessionUpdateResult =
  | { ok: true }
  | { ok: false; code: SessionErrorCode; message: string };

export type SessionGetResult =
  | {
      ok: true;
      session: SessionUiSnapshot | null;
      sessionDir: string | null;
      uiRevision: number;
    }
  | { ok: false; code: SessionErrorCode; message: string };

export type AccumulatedSessionTimeResult =
  | { ok: true; accumulatedTimeSec: number }
  | { ok: false; code: SessionErrorCode; message: string };

export type MediaReferenceCountResult =
  | { ok: true; markerCount: number; eventCount: number }
  | { ok: false; code: SessionErrorCode; message: string };

export type MarkerExportSkipReason = "no_media";

// Shared success type for marker exports (discriminated on skipped)
// warnings: optional array of non-fatal issues (e.g., temp file cleanup failures)
type MarkerExportOk =
  | {
      ok: true;
      skipped: true;
      outputRelativePath: null;
      reason: MarkerExportSkipReason;
      warnings?: string[];
    }
  | {
      ok: true;
      skipped: false;
      outputRelativePath: string;
      warnings?: string[];
    };

export type MarkerStillExportResult =
  | MarkerExportOk
  | { ok: false; code: SessionErrorCode; message: string };

export type MarkerClipExportResult =
  | MarkerExportOk
  | { ok: false; code: SessionErrorCode; message: string };

export type GroupClipExportResult =
  | { ok: true; skipped: false; outputRelativePath: string }
  | { ok: false; code: SessionErrorCode; message: string };

// =============================================================================
// Dialog Types
// =============================================================================

export type DialogPickDirectoryResult =
  | { ok: true; path: string }
  | { ok: false; code: "canceled" };

export type DialogPickMediaFilesResult =
  | { ok: true; paths: string[] }
  | { ok: false; code: "canceled" };

// =============================================================================
// App Folder Types
// =============================================================================

/** Summary info for displaying a session in a list */
export interface SessionSummary {
  sessionId: string;
  /** User-provided session name */
  name: string;
  sessionDir: string;
  createdAtIso: string;
  updatedAtIso: string;
  /** File system modification time of session.json (for "last worked on" display) */
  lastModifiedIso: string;
  recordingCount: number;
  totalDurationSec: number;
  markerCount: number;
}

export type InvalidSessionSummary = {
  sessionDir: string;
  /** File system modification time of session.json (best-effort; null if unknown). */
  lastModifiedIso: string | null;
  /** Human-readable validation/parse/read error. */
  error: string;
};

export type AppFolderErrorCode =
  | "create_failed"
  | "list_failed"
  | "invalid_path"
  | "delete_failed"
  | "rename_failed"
  | "session_not_found";

export type AppFolderGetResult =
  | { ok: true; path: string }
  | { ok: false; code: AppFolderErrorCode; message: string };

export type AppFolderEnsureResult =
  | { ok: true; path: string; created: boolean }
  | { ok: false; code: AppFolderErrorCode; message: string };

export type AppFolderListSessionsResult =
  | {
      ok: true;
      sessions: SessionSummary[];
      invalidSessions: InvalidSessionSummary[];
    }
  | { ok: false; code: AppFolderErrorCode; message: string };

export type AppFolderDeleteSessionResult =
  | { ok: true }
  | { ok: false; code: AppFolderErrorCode; message: string };

export type AppFolderRenameSessionResult =
  | { ok: true }
  | { ok: false; code: AppFolderErrorCode; message: string };
