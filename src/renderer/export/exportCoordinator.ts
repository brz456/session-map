// src/renderer/export/exportCoordinator.ts
// Coordinates export flow: snap to marker time, render overlay, invoke IPC

import type { MarkerDrawing } from '../../shared/sessionPackage/types';
import type { SessionUiSnapshot } from '../../shared/ipc/sessionUi';
import {
  computeGroupClip,
  getStandaloneClipRange,
  STANDALONE_CLIP_RADIUS_SEC,
} from '../../shared/clips/clipRules';
import type { RendererApi } from '../app/rendererApi';
import { renderDrawingToCanvas, canvasToPngBase64 } from '../drawing/render';

export interface ExportCoordinatorOptions {
  markerId: string;
  drawing: MarkerDrawing | null;
  videoElement: HTMLVideoElement;
}

export type ExportCoordinatorResult =
  | { ok: true; outputRelativePath: string | null; skipped: boolean; reason?: string }
  | { ok: false; message: string };

export type ExportCoordinatorApi = {
  session: Pick<RendererApi['session'], 'exportMarkerStill' | 'exportMarkerClip' | 'exportGroupClip'>;
  media: Pick<RendererApi['media'], 'getVideoInfo'>;
};

/**
 * Coordinates export of a marker still image.
 * Assumes video is already seeked to marker time.
 *
 * Flow:
 * 1. Render drawing overlay to canvas (if present)
 * 2. Convert to base64 PNG
 * 3. Call IPC to extract frame with ffmpeg
 */
export async function exportMarkerStill(
  api: ExportCoordinatorApi,
  options: ExportCoordinatorOptions
): Promise<ExportCoordinatorResult> {
  const { markerId, drawing, videoElement } = options;

  try {
    // Render overlay if drawing exists
    let overlayPngBase64: string | null = null;
    if (drawing && drawing.strokes.length > 0) {
      // Use video's natural dimensions for export quality
      const width = videoElement.videoWidth;
      const height = videoElement.videoHeight;

      if (width === 0 || height === 0) {
        return {
          ok: false,
          message: 'Video dimensions not available (video may not be loaded)',
        };
      }

      const canvas = renderDrawingToCanvas(drawing, width, height);
      overlayPngBase64 = await canvasToPngBase64(canvas);
    }

    // Call IPC to export with ffmpeg
    const result = await api.session.exportMarkerStill(markerId, overlayPngBase64);

    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
      };
    }

    if (result.skipped) {
      return {
        ok: true,
        outputRelativePath: result.outputRelativePath,
        skipped: true,
        reason: result.reason,
      };
    }

    return {
      ok: true,
      outputRelativePath: result.outputRelativePath,
      skipped: false,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

type VideoInfo = { width: number; height: number; durationSec: number };
type VideoInfoResult =
  | { ok: true; info: VideoInfo }
  | { ok: false; message: string };

/**
 * Gets video info (dimensions and duration) using main process ffmpeg (via IPC).
 * Returns typed result for explicit error handling.
 */
async function getVideoInfo(api: ExportCoordinatorApi['media'], mediaPath: string): Promise<VideoInfoResult> {
  try {
    const result = await api.getVideoInfo(mediaPath);
    if (result.ok) {
      return {
        ok: true,
        info: { width: result.width, height: result.height, durationSec: result.durationSec },
      };
    }
    return { ok: false, message: result.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export interface ExportAllMediaResult {
  stills: { exported: number; skipped: number; failed: number };
  clips: { exported: number; skipped: number; failed: number };
}

/**
 * Exports all marker media: stills with drawing overlays and clips.
 *
 * Clip export logic:
 * - Standalone markers (no groupId): 1 clip per marker with +/- 30s radius
 * - Grouped markers (same groupId): 1 clip per group spanning min-to-max + 5s padding
 *
 * This runs in the renderer so we can use canvas for overlay rendering.
 */
export async function exportAllMarkerMedia(
  api: ExportCoordinatorApi,
  session: SessionUiSnapshot
): Promise<ExportAllMediaResult> {
  const stills = { exported: 0, skipped: 0, failed: 0 };
  const clips = { exported: 0, skipped: 0, failed: 0 };

  // Build a map of mediaId -> absolute path for quick lookup
  const mediaPathMap = new Map<string, string>();
  for (const asset of session.media.assets) {
    mediaPathMap.set(asset.mediaId, asset.absolutePath);
  }

  // Cache of mediaId -> video info result to avoid probing same video multiple times
  const videoInfoCache = new Map<string, VideoInfoResult>();

  // Helper to get video info (cached)
  const getCachedVideoInfo = async (mediaId: string, mediaPath: string): Promise<VideoInfoResult> => {
    let videoInfoResult = videoInfoCache.get(mediaId);
    if (videoInfoResult === undefined) {
      videoInfoResult = await getVideoInfo(api.media, mediaPath);
      videoInfoCache.set(mediaId, videoInfoResult);
    }
    return videoInfoResult;
  };

  // ============================================================================
  // PHASE 1: Export stills (one per marker, regardless of grouping)
  // ============================================================================
  for (const marker of session.markers) {
    const mediaId = marker.playbackSnapshot.mediaId;
    if (mediaId === null) {
      stills.skipped++;
      continue;
    }

    if (typeof mediaId !== 'string' || mediaId === '') {
      console.error(`Marker ${marker.markerId} has invalid mediaId: ${JSON.stringify(mediaId)}`);
      stills.failed++;
      continue;
    }

    const mediaPath = mediaPathMap.get(mediaId);
    if (!mediaPath) {
      console.error(`Marker ${marker.markerId} references unknown mediaId: ${mediaId}`);
      stills.failed++;
      continue;
    }

    const videoInfoResult = await getCachedVideoInfo(mediaId, mediaPath);
    const hasDrawing = marker.drawing && marker.drawing.strokes.length > 0;

    if (hasDrawing && !videoInfoResult.ok) {
      console.error(`Failed to export still for marker ${marker.markerId}: drawing requires video info but probe failed: ${videoInfoResult.message}`);
      stills.failed++;
      continue;
    }

    try {
      let overlayPngBase64: string | null = null;
      if (hasDrawing && videoInfoResult.ok) {
        const canvas = renderDrawingToCanvas(marker.drawing!, videoInfoResult.info.width, videoInfoResult.info.height);
        overlayPngBase64 = await canvasToPngBase64(canvas);
      }

      const result = await api.session.exportMarkerStill(marker.markerId, overlayPngBase64);
      if (result.ok) {
        if (result.skipped) {
          stills.skipped++;
        } else {
          stills.exported++;
        }
      } else {
        stills.failed++;
      }
    } catch (err) {
      console.error(`Failed to export still for marker ${marker.markerId}:`, err);
      stills.failed++;
    }
  }

  // ============================================================================
  // PHASE 2: Export clips (one per standalone marker OR one per group)
  // ============================================================================

  // Separate markers into groups and standalone
  const groupedMarkers = new Map<string, typeof session.markers>();
  const standaloneMarkers: typeof session.markers = [];
  let invalidGroupIdCount = 0;

  for (const marker of session.markers) {
    if (marker.groupId === undefined) {
      // No groupId - standalone marker
      standaloneMarkers.push(marker);
    } else if (typeof marker.groupId === 'string' && marker.groupId !== '') {
      // Valid groupId - add to group
      const group = groupedMarkers.get(marker.groupId) || [];
      group.push(marker);
      groupedMarkers.set(marker.groupId, group);
    } else {
      // Invalid groupId (empty string or wrong type) - fail explicitly
      console.error(`Marker ${marker.markerId} has invalid groupId: ${JSON.stringify(marker.groupId)}`);
      invalidGroupIdCount++;
    }
  }

  if (invalidGroupIdCount > 0) {
    clips.failed += invalidGroupIdCount;
  }

  // Export clips for standalone markers (+/- 30s radius)
  for (const marker of standaloneMarkers) {
    const mediaId = marker.playbackSnapshot.mediaId;
    if (mediaId === null) {
      clips.skipped++;
      continue;
    }

    if (typeof mediaId !== 'string' || mediaId === '') {
      clips.failed++;
      continue;
    }

    const mediaPath = mediaPathMap.get(mediaId);
    if (!mediaPath) {
      clips.failed++;
      continue;
    }

    const videoInfoResult = await getCachedVideoInfo(mediaId, mediaPath);
    if (!videoInfoResult.ok) {
      console.error(`Failed to get video info for clip export: ${videoInfoResult.message}`);
      clips.failed++;
      continue;
    }

    const standaloneClip = getStandaloneClipRange({
      mediaTimeSec: marker.playbackSnapshot.mediaTimeSec,
      durationSec: videoInfoResult.info.durationSec,
    });
    if (standaloneClip.status !== 'ready') {
      const message =
        standaloneClip.status === 'invalid_clip_timing'
          ? `Marker ${marker.markerId} has invalid media timing: mediaTimeSec=${marker.playbackSnapshot.mediaTimeSec}`
          : `Marker ${marker.markerId} has out-of-bounds mediaTimeSec=${marker.playbackSnapshot.mediaTimeSec} for duration=${videoInfoResult.info.durationSec}`;
      console.error(message);
      clips.failed++;
      continue;
    }

    try {
      const result = await api.session.exportMarkerClip(
        marker.markerId,
        videoInfoResult.info.durationSec,
        STANDALONE_CLIP_RADIUS_SEC
      );
      if (result.ok) {
        if (result.skipped) {
          clips.skipped++;
        } else {
          clips.exported++;
        }
      } else {
        clips.failed++;
      }
    } catch (err) {
      console.error(`Failed to export clip for marker ${marker.markerId}:`, err);
      clips.failed++;
    }
  }

  // Export clips for grouped markers (one clip per group, inferred range + padding)
  for (const [groupId, markers] of groupedMarkers.entries()) {
    const initialGroupClip = computeGroupClip({
      markers: markers.map((marker) => ({
        mediaId: marker.playbackSnapshot.mediaId,
        mediaTimeSec: marker.playbackSnapshot.mediaTimeSec,
      })),
    });

    if (initialGroupClip.status === 'missing_media') {
      // No markers have media - skip this group
      clips.skipped++;
      continue;
    }

    if (initialGroupClip.status === 'partial_group_media') {
      // Some markers lack media - fail explicitly rather than export partial clip
      console.error(
        `Group ${groupId} has marker(s) without media; all group markers must have media for clip export`
      );
      clips.failed++;
      continue;
    }

    if (initialGroupClip.status === 'mixed_media') {
      console.error(
        `Group ${groupId} spans multiple media files; group clip export requires all markers to share the same media`
      );
      clips.failed++;
      continue;
    }
    if (initialGroupClip.status === 'invalid_clip_timing') {
      console.error(
        `Group ${groupId} has invalid media timing; all group markers must use finite non-negative media times`
      );
      clips.failed++;
      continue;
    }

    const mediaId = initialGroupClip.mediaId;

    const mediaPath = mediaPathMap.get(mediaId);

    if (!mediaPath) {
      console.error(`Group ${groupId} references unknown mediaId: ${mediaId}`);
      clips.failed++;
      continue;
    }

    const videoInfoResult = await getCachedVideoInfo(mediaId, mediaPath);
    if (!videoInfoResult.ok) {
      console.error(`Failed to get video info for group clip export: ${videoInfoResult.message}`);
      clips.failed++;
      continue;
    }

    const groupClip = computeGroupClip({
      markers: markers.map((marker) => ({
        mediaId: marker.playbackSnapshot.mediaId,
        mediaTimeSec: marker.playbackSnapshot.mediaTimeSec,
      })),
      durationSec: videoInfoResult.info.durationSec,
    });
    if (groupClip.status !== 'ready') {
      const message =
        groupClip.status === 'out_of_bounds_media_time'
          ? `Group ${groupId} resolves to an empty clip after clamping to duration=${videoInfoResult.info.durationSec}`
          : groupClip.status === 'invalid_clip_timing'
            ? `Group ${groupId} has invalid clip timing after duration probe`
          : `Group ${groupId} is not exportable after duration probe: ${groupClip.status}`;
      console.error(message);
      clips.failed++;
      continue;
    }

    try {
      const result = await api.session.exportGroupClip(
        groupId,
        mediaId,
        groupClip.startMediaTimeSec,
        groupClip.endMediaTimeSec,
        videoInfoResult.info.durationSec
      );
      if (result.ok) {
        clips.exported++;
      } else {
        clips.failed++;
      }
    } catch (err) {
      console.error(`Failed to export clip for group ${groupId}:`, err);
      clips.failed++;
    }
  }

  return { stills, clips };
}
