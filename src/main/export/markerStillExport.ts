// src/main/export/markerStillExport.ts
// Marker export pipelines: still images (PNG) and clips (MP4)

import { writeFile, mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getSessionStore } from '../session/sessionStoreInstance';
import { extractFrame, compositeOverlay, extractClip, extractClipRange, getFfmpegPath, getFfmpegError } from './ffmpeg';
import type { MarkerStillExportResult, MarkerClipExportResult, GroupClipExportResult } from '../../shared/ipc/types';

// Strict UUID v4 regex for path safety validation
// Prevents path traversal attacks via crafted markerId in tampered session files
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates that an ID is a safe UUID v4 for use in filesystem paths.
 * Fail-closed: rejects anything that doesn't match strict UUID v4 format.
 */
function isValidUuidForPath(id: string): boolean {
  return UUID_V4_REGEX.test(id);
}

// Strict base64 regex (standard base64 with optional padding)
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

// PNG magic bytes: 0x89 P N G \r \n 0x1A \n
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Validates and decodes a base64 PNG string.
 * Fail-closed: rejects invalid base64 or non-PNG data.
 */
function decodeBase64Png(base64: string): { ok: true; buffer: Buffer } | { ok: false; message: string } {
  // Validate base64 format
  if (!BASE64_REGEX.test(base64)) {
    return { ok: false, message: 'Invalid base64 encoding' };
  }

  const buffer = Buffer.from(base64, 'base64');

  // Validate PNG magic bytes
  if (buffer.length < PNG_MAGIC.length || !buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { ok: false, message: 'Data is not a valid PNG (missing magic bytes)' };
  }

  return { ok: true, buffer };
}

export interface ExportMarkerStillOptions {
  markerId: string;
  overlayPngBase64: string | null;
}

/**
 * Exports a marker as a still image with optional drawing overlay.
 *
 * Flow:
 * 1. Look up marker and associated media
 * 2. Extract frame from video at marker time using ffmpeg
 * 3. If overlay provided, composite it on top
 * 4. Save to session marker-stills/ directory
 */
export async function exportMarkerStill(
  options: ExportMarkerStillOptions
): Promise<MarkerStillExportResult> {
  const { markerId, overlayPngBase64 } = options;

  // Validate markerId is safe for filesystem paths (prevents path traversal)
  if (!isValidUuidForPath(markerId)) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Invalid markerId format: ${markerId.slice(0, 50)}`,
    };
  }

  // Verify ffmpeg is available
  if (!getFfmpegPath()) {
    return {
      ok: false,
      code: 'ffmpeg_missing',
      message: getFfmpegError() ?? 'ffmpeg binary not found',
    };
  }

  const store = getSessionStore();
  const sessionResult = store.getFull();

  if (!sessionResult.ok) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const session = sessionResult.session;

  // Find the marker
  const marker = session.markers.find((m: { markerId: string }) => m.markerId === markerId);
  if (!marker) {
    return {
      ok: false,
      code: 'marker_not_found',
      message: `Marker not found: ${markerId}`,
    };
  }

  // Check if marker has associated media
  const mediaId = marker.playbackSnapshot.mediaId;
  if (!mediaId) {
    return {
      ok: true,
      outputRelativePath: null,
      skipped: true,
      reason: 'no_media',
    };
  }

  // Find the media asset
  const media = session.media.assets.find((a: { mediaId: string }) => a.mediaId === mediaId);
  if (!media) {
    return {
      ok: false,
      code: 'media_not_found',
      message: `Media not found: ${mediaId}`,
    };
  }

  // Get marker time
  // If mediaId is present but mediaTimeSec is null, that's corrupted state (fail-closed)
  const mediaTimeSec = marker.playbackSnapshot.mediaTimeSec;
  if (mediaTimeSec === null) {
    return {
      ok: false,
      code: 'export_failed',
      message: `Marker ${markerId} has mediaId but null mediaTimeSec (corrupted playbackSnapshot)`,
    };
  }

  // Get session directory
  const sessionDir = store.getSessionDir();
  if (!sessionDir) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'Session directory not available',
    };
  }

  // Output paths
  const stillsDir = path.join(sessionDir, 'marker-stills');
  const outputFilename = `${markerId}.png`;
  const outputPath = path.join(stillsDir, outputFilename);
  const outputRelativePath = `marker-stills/${outputFilename}`;

  // Collect non-fatal warnings (e.g., cleanup failures)
  const warnings: string[] = [];

  try {
    // Ensure marker-stills directory exists (mkdir recursive is idempotent)
    await mkdir(stillsDir, { recursive: true });

    if (overlayPngBase64 !== null) {
      // Fail-closed: empty string is invalid input, not "no overlay"
      if (overlayPngBase64.length === 0) {
        return {
          ok: false,
          code: 'invalid_input',
          message: 'overlayPngBase64 is empty string (use null for no overlay)',
        };
      }

      // Validate overlay before any I/O (fail fast)
      const decodeResult = decodeBase64Png(overlayPngBase64);
      if (!decodeResult.ok) {
        return {
          ok: false,
          code: 'invalid_input',
          message: `Invalid overlay: ${decodeResult.message}`,
        };
      }

      // Use per-invocation temp directory to avoid race conditions on concurrent exports
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'marker-still-'));
      const tempFramePath = path.join(tempDir, 'frame.png');
      const tempOverlayPath = path.join(tempDir, 'overlay.png');

      try {
        // Extract frame
        const extractResult = await extractFrame({
          inputPath: media.absolutePath,
          timeSec: mediaTimeSec,
          outputPath: tempFramePath,
        });

        if (!extractResult.ok) {
          return {
            ok: false,
            code: extractResult.code,
            message: extractResult.message,
          };
        }

        // Write validated overlay to temp file
        await writeFile(tempOverlayPath, decodeResult.buffer);

        // Composite overlay on frame
        const compositeResult = await compositeOverlay({
          basePath: tempFramePath,
          overlayPath: tempOverlayPath,
          outputPath,
        });

        if (!compositeResult.ok) {
          return {
            ok: false,
            code: compositeResult.code,
            message: compositeResult.message,
          };
        }
      } finally {
        // Clean up temp directory (collect warning for non-fatal failure)
        try {
          await rm(tempDir, { recursive: true });
        } catch (err) {
          warnings.push(`Failed to clean up temp dir: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else {
      // overlayPngBase64 === null: no overlay requested, extract frame directly to output
      const extractResult = await extractFrame({
        inputPath: media.absolutePath,
        timeSec: mediaTimeSec,
        outputPath,
      });

      if (!extractResult.ok) {
        return {
          ok: false,
          code: extractResult.code,
          message: extractResult.message,
        };
      }
    }

    return {
      ok: true,
      outputRelativePath,
      skipped: false,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      code: 'export_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ExportMarkerClipOptions {
  markerId: string;
  videoDurationSec: number;
  radiusSec: number;
}

/**
 * Exports a clip around a marker (+/- radiusSec, clamped to video bounds).
 *
 * Flow:
 * 1. Look up marker and associated media
 * 2. Extract clip using ffmpeg stream copy
 * 3. Save to session marker-clips/ directory
 */
export async function exportMarkerClip(
  options: ExportMarkerClipOptions
): Promise<MarkerClipExportResult> {
  const { markerId, videoDurationSec, radiusSec } = options;

  // Validate markerId is safe for filesystem paths (prevents path traversal)
  if (!isValidUuidForPath(markerId)) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Invalid markerId format: ${markerId.slice(0, 50)}`,
    };
  }

  // Validate numeric inputs (fail-closed: reject NaN, Infinity, non-positive)
  if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Invalid videoDurationSec: ${videoDurationSec} (must be finite and > 0)`,
    };
  }
  if (!Number.isFinite(radiusSec) || radiusSec <= 0) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Invalid radiusSec: ${radiusSec} (must be finite and > 0)`,
    };
  }

  // Verify ffmpeg is available
  if (!getFfmpegPath()) {
    return {
      ok: false,
      code: 'ffmpeg_missing',
      message: getFfmpegError() ?? 'ffmpeg binary not found',
    };
  }

  const store = getSessionStore();
  const sessionResult = store.getFull();

  if (!sessionResult.ok) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const session = sessionResult.session;

  // Find the marker
  const marker = session.markers.find((m: { markerId: string }) => m.markerId === markerId);
  if (!marker) {
    return {
      ok: false,
      code: 'marker_not_found',
      message: `Marker not found: ${markerId}`,
    };
  }

  // Check if marker has associated media
  const mediaId = marker.playbackSnapshot.mediaId;
  if (!mediaId) {
    return {
      ok: true,
      outputRelativePath: null,
      skipped: true,
      reason: 'no_media',
    };
  }

  // Find the media asset
  const media = session.media.assets.find((a: { mediaId: string }) => a.mediaId === mediaId);
  if (!media) {
    return {
      ok: false,
      code: 'media_not_found',
      message: `Media not found: ${mediaId}`,
    };
  }

  // Get marker time
  // If mediaId is present but mediaTimeSec is null, that's corrupted state (fail-closed)
  const mediaTimeSec = marker.playbackSnapshot.mediaTimeSec;
  if (mediaTimeSec === null) {
    return {
      ok: false,
      code: 'export_failed',
      message: `Marker ${markerId} has mediaId but null mediaTimeSec (corrupted playbackSnapshot)`,
    };
  }

  // Get session directory
  const sessionDir = store.getSessionDir();
  if (!sessionDir) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'Session directory not available',
    };
  }

  // Output paths
  const clipsDir = path.join(sessionDir, 'marker-clips');
  const outputFilename = `${markerId}.mp4`;
  const outputPath = path.join(clipsDir, outputFilename);
  const outputRelativePath = `marker-clips/${outputFilename}`;

  try {
    // Ensure marker-clips directory exists (mkdir recursive is idempotent)
    await mkdir(clipsDir, { recursive: true });

    const clipResult = await extractClip({
      inputPath: media.absolutePath,
      centerTimeSec: mediaTimeSec,
      videoDurationSec,
      radiusSec,
      outputPath,
    });

    if (!clipResult.ok) {
      return {
        ok: false,
        code: clipResult.code,
        message: clipResult.message,
      };
    }

    return {
      ok: true,
      outputRelativePath,
      skipped: false,
    };
  } catch (err) {
    return {
      ok: false,
      code: 'export_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ============================================================================
   Group Clip Export
   ============================================================================ */

export interface ExportGroupClipOptions {
  /** Group ID (used for output filename) */
  groupId: string;
  /** Media ID for the group's media source */
  mediaId: string;
  /** Start time of the clip (min of group markers - padding) */
  startSec: number;
  /** End time of the clip (max of group markers + padding) */
  endSec: number;
  /** Video duration for clamping */
  videoDurationSec: number;
}

/**
 * Exports a clip for a marker group with explicit start/end times.
 * Used for grouped markers where the clip spans from first to last marker + padding.
 */
export async function exportGroupClip(
  options: ExportGroupClipOptions
): Promise<GroupClipExportResult> {
  const { groupId, mediaId, startSec, endSec, videoDurationSec } = options;

  // Validate groupId for filesystem safety
  if (!isValidUuidForPath(groupId)) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Invalid groupId format: ${groupId.slice(0, 50)}`,
    };
  }

  // Validate numeric inputs
  if (!Number.isFinite(startSec) || startSec < 0) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Invalid startSec: ${startSec} (must be finite and >= 0)`,
    };
  }
  if (!Number.isFinite(endSec) || endSec < 0) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Invalid endSec: ${endSec} (must be finite and >= 0)`,
    };
  }
  if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Invalid videoDurationSec: ${videoDurationSec} (must be finite and > 0)`,
    };
  }
  if (endSec <= startSec) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Invalid time range: endSec (${endSec}) must be greater than startSec (${startSec})`,
    };
  }

  // Verify ffmpeg is available
  if (!getFfmpegPath()) {
    return {
      ok: false,
      code: 'ffmpeg_missing',
      message: getFfmpegError() ?? 'ffmpeg binary not found',
    };
  }

  const store = getSessionStore();
  const sessionResult = store.getFull();

  if (!sessionResult.ok) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const session = sessionResult.session;

  // Find the media asset
  const media = session.media.assets.find((a: { mediaId: string }) => a.mediaId === mediaId);
  if (!media) {
    return {
      ok: false,
      code: 'media_not_found',
      message: `Media not found: ${mediaId}`,
    };
  }

  // Get session directory
  const sessionDir = store.getSessionDir();
  if (!sessionDir) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'Session directory not available',
    };
  }

  // Output paths - use group- prefix to distinguish from marker clips
  const clipsDir = path.join(sessionDir, 'marker-clips');
  const outputFilename = `group-${groupId}.mp4`;
  const outputPath = path.join(clipsDir, outputFilename);
  const outputRelativePath = `marker-clips/${outputFilename}`;

  try {
    // Ensure marker-clips directory exists
    await mkdir(clipsDir, { recursive: true });

    const clipResult = await extractClipRange({
      inputPath: media.absolutePath,
      startSec,
      endSec,
      videoDurationSec,
      outputPath,
    });

    if (!clipResult.ok) {
      return {
        ok: false,
        code: clipResult.code,
        message: clipResult.message,
      };
    }

    return {
      ok: true,
      outputRelativePath,
      skipped: false,
    };
  } catch (err) {
    return {
      ok: false,
      code: 'export_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
