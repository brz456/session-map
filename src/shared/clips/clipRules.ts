export const STANDALONE_CLIP_RADIUS_SEC = 30;
export const GROUP_CLIP_PADDING_SEC = 5;

export type ClipKind = "standalone" | "group";
export type ClipStatus =
  | "ready"
  | "invalid_clip_timing"
  | "out_of_bounds_media_time"
  | "missing_media"
  | "partial_group_media"
  | "mixed_media";

export type StandaloneClipComputation =
  | {
      status: "ready";
      startMediaTimeSec: number;
      endMediaTimeSec: number;
    }
  | { status: "invalid_clip_timing" }
  | { status: "out_of_bounds_media_time" };

export type GroupClipComputation =
  | {
      status: "ready";
      mediaId: string;
      startMediaTimeSec: number;
      endMediaTimeSec: number;
    }
  | { status: "invalid_clip_timing" }
  | { status: "out_of_bounds_media_time" }
  | { status: "missing_media" }
  | { status: "partial_group_media" }
  | { status: "mixed_media" };

export type GroupClipPreflightComputation = Exclude<
  GroupClipComputation,
  { status: "out_of_bounds_media_time" }
>;

export interface ClipPlaybackSource {
  mediaId: string | null;
  mediaTimeSec: number | null;
}

function clampToRange(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function isValidNonNegativeFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function getStandaloneClipRange(params: {
  mediaTimeSec: number;
  durationSec?: number;
}): StandaloneClipComputation {
  if (!isValidNonNegativeFiniteNumber(params.mediaTimeSec)) {
    return { status: "invalid_clip_timing" };
  }
  if (
    params.durationSec !== undefined &&
    (!Number.isFinite(params.durationSec) || params.durationSec <= 0)
  ) {
    return { status: "invalid_clip_timing" };
  }

  const rawStart = Math.max(0, params.mediaTimeSec - STANDALONE_CLIP_RADIUS_SEC);
  const rawEnd = params.mediaTimeSec + STANDALONE_CLIP_RADIUS_SEC;
  if (params.durationSec === undefined) {
    return {
      status: "ready",
      startMediaTimeSec: rawStart,
      endMediaTimeSec: rawEnd,
    };
  }

  const startMediaTimeSec = clampToRange(rawStart, params.durationSec);
  const endMediaTimeSec = clampToRange(rawEnd, params.durationSec);
  if (endMediaTimeSec <= startMediaTimeSec) {
    return { status: "out_of_bounds_media_time" };
  }

  return {
    status: "ready",
    startMediaTimeSec,
    endMediaTimeSec,
  };
}

export function computeGroupClip(params: {
  markers: readonly ClipPlaybackSource[];
}): GroupClipPreflightComputation;
export function computeGroupClip(params: {
  markers: readonly ClipPlaybackSource[];
  durationSec: number;
}): GroupClipComputation;
export function computeGroupClip(params: {
  markers: readonly ClipPlaybackSource[];
  durationSec?: number;
}): GroupClipComputation {
  const markersWithMedia = params.markers.filter(
    (marker): marker is { mediaId: string; mediaTimeSec: number } =>
      marker.mediaId !== null && marker.mediaTimeSec !== null,
  );

  if (markersWithMedia.length === 0) {
    return { status: "missing_media" };
  }

  if (markersWithMedia.length !== params.markers.length) {
    return { status: "partial_group_media" };
  }
  if (
    params.durationSec !== undefined &&
    (!Number.isFinite(params.durationSec) || params.durationSec <= 0)
  ) {
    return { status: "invalid_clip_timing" };
  }

  const mediaId = markersWithMedia[0].mediaId;
  const hasMixedMedia = markersWithMedia.some((marker) => marker.mediaId !== mediaId);
  if (hasMixedMedia) {
    return { status: "mixed_media" };
  }

  const mediaTimes = markersWithMedia.map((marker) => marker.mediaTimeSec);
  if (mediaTimes.some((mediaTimeSec) => !isValidNonNegativeFiniteNumber(mediaTimeSec))) {
    return { status: "invalid_clip_timing" };
  }
  const rawStart = Math.max(0, Math.min(...mediaTimes) - GROUP_CLIP_PADDING_SEC);
  const rawEnd = Math.max(...mediaTimes) + GROUP_CLIP_PADDING_SEC;
  if (params.durationSec === undefined) {
    return {
      status: "ready",
      mediaId,
      startMediaTimeSec: rawStart,
      endMediaTimeSec: rawEnd,
    };
  }

  const startMediaTimeSec = clampToRange(rawStart, params.durationSec);
  const endMediaTimeSec = clampToRange(rawEnd, params.durationSec);
  if (endMediaTimeSec <= startMediaTimeSec) {
    return { status: "out_of_bounds_media_time" };
  }

  return {
    status: "ready",
    mediaId,
    startMediaTimeSec,
    endMediaTimeSec,
  };
}
