// v2 merged-output projection contract:
// - transcript utterances are the deterministic spine (sorted by start/end/id)
// - every source marker is projected exactly once (inline or orphan with reason)
// - marker identity + playback are preserved using a playbackSnapshot-equivalent union:
//   { mediaId: null, mediaTimeSec: null } or { mediaId, mediaTimeSec }
// - segments/mediaIndex are derived deterministically from projected utterances/markers
// - output intentionally excludes binary payloads and filesystem probing in core mode

import type {
  SessionPackage,
  Transcript,
  TranscriptSection,
  TranscriptSpeaker,
  TranscriptUtterance,
  PlaybackEvent,
  Marker,
  Bucket,
  Tag,
  MediaAsset,
} from "../shared/sessionPackage/types";
import {
  computeGroupClip,
  getStandaloneClipRange,
  type ClipKind,
  type ClipStatus,
} from "../shared/clips/clipRules";

type MarkerPlayback =
  | { mediaId: null; mediaTimeSec: null; playbackRate: number; paused: boolean }
  | {
      mediaId: string;
      mediaTimeSec: number;
      playbackRate: number;
      paused: boolean;
      displayName: string;
    };

export interface AnnotatedMarker {
  markerId: string;
  clipId: string;
  anchorSessionTimeSec: number | null;
  createdAtIso: string;
  sourceType: Marker["sourceType"];
  importance: 1 | 2 | 3;
  bucketId: string | null;
  tagIds: string[];
  groupId: string | null;
  playback: MarkerPlayback;
  note?: string;
  bucket?: string;
  tags: string[];
  hasDrawing: boolean;
  drawingRef?: string;
}

export type OrphanReason =
  | "no_anchor_session_time"
  | "no_transcript_utterances"
  | "out_of_transcript_range"
  | "transcript_gap";

export interface AnnotatedOrphanMarker extends AnnotatedMarker {
  orphanReason: OrphanReason;
}

export interface Engagement {
  rewindCount: number;
  pauseCount: number;
  totalPauseDurationSec: number;
  playbackRates: number[];
}

export interface MediaSnapshot {
  mediaId: string;
  displayName: string;
  mediaTimeSec: number;
}

export interface AnnotatedUtterance {
  utteranceId: string;
  speakerId: string;
  startTimeSec: number;
  endTimeSec: number;
  text: string;
  markers?: AnnotatedMarker[];
  engagement?: Engagement;
  media?: MediaSnapshot;
}

export interface MediaIndexItem {
  mediaId: string;
  displayName: string;
}

export interface Segment {
  segmentIndex: number;
  mediaId: string;
  displayName: string;
  startSessionTimeSec: number;
  endSessionTimeSec: number;
  startUtteranceId: string;
  endUtteranceId: string;
}

export interface Clip {
  clipId: string;
  kind: ClipKind;
  groupId: string | null;
  markerIds: string[];
  mediaId: string | null;
  displayName: string | null;
  startMediaTimeSec: number | null;
  endMediaTimeSec: number | null;
  drawingRefs: string[];
  status: ClipStatus;
}

export interface AnnotatedTranscript {
  source: {
    sessionPath: string;
    transcriptPath: string;
    sessionId: string;
    sessionName: string;
    generatedAtIso: string;
    counts: {
      utterances: number;
      markers: number;
      clips: number;
      sections: number;
      orphanMarkers: number;
    };
  };
  speakers: TranscriptSpeaker[];
  sections: TranscriptSection[];
  utterances: AnnotatedUtterance[];
  orphanMarkers: AnnotatedOrphanMarker[];
  clips: Clip[];
  mediaIndex: MediaIndexItem[];
  segments: Segment[];
}

interface PlaybackState {
  mediaId: string | null;
  mediaTimeSec: number | null;
  playbackRate: number;
  paused: boolean;
}

interface PlaybackSegment {
  startTimeSec: number;
  endTimeSec: number;
  mediaId: string | null;
  mediaStartTimeSec: number | null;
  playbackRate: number;
  paused: boolean;
}

interface UtteranceProjectionState {
  utteranceId: string;
  speakerId: string;
  startTimeSec: number;
  endTimeSec: number;
  text: string;
  markers: AnnotatedMarker[];
  engagement?: Engagement;
  media?: MediaSnapshot;
}

interface SegmentBuildState {
  mediaId: string;
  displayName: string;
  startSessionTimeSec: number;
  endSessionTimeSec: number;
  startUtteranceId: string;
  endUtteranceId: string;
}

interface ClipBuildState {
  clipId: string;
  kind: ClipKind;
  groupId: string | null;
  markers: AnnotatedMarker[];
  sortAnchor: number | null;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function roundClipTimeSec(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function getClipAggregationKey(marker: AnnotatedMarker): string {
  return marker.groupId === null
    ? `standalone:${marker.markerId}`
    : `group:${marker.groupId}`;
}

function applyEvent(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  let mediaId = state.mediaId;
  let mediaTimeSec = state.mediaTimeSec;
  let playbackRate = state.playbackRate;
  let paused = state.paused;

  if (event.mediaId === null) {
    mediaId = null;
    mediaTimeSec = null;
    playbackRate = event.playbackRate;
    paused = true;
  } else {
    mediaId = event.mediaId;
    mediaTimeSec = event.mediaTimeSec;
    playbackRate = event.playbackRate;
  }

  if (event.type === "load") paused = true;
  if (event.type === "play") paused = false;
  if (event.type === "pause") paused = true;

  return { mediaId, mediaTimeSec, playbackRate, paused };
}

function buildPlaybackSegments(
  events: PlaybackEvent[],
  endTimeSec: number,
): PlaybackSegment[] {
  const segments: PlaybackSegment[] = [];
  let state: PlaybackState = {
    mediaId: null,
    mediaTimeSec: null,
    playbackRate: 1,
    paused: true,
  };
  let cursor = 0;
  let prevTime = -1;

  for (const event of events) {
    const t = event.sessionTimeSec;
    if (t < prevTime) {
      throw new Error(
        `telemetry.events must be sorted by sessionTimeSec (got ${t} after ${prevTime})`,
      );
    }
    prevTime = t;
    if (t > cursor) {
      segments.push({
        startTimeSec: cursor,
        endTimeSec: t,
        mediaId: state.mediaId,
        mediaStartTimeSec: state.mediaTimeSec,
        playbackRate: state.playbackRate,
        paused: state.paused,
      });
    }
    state = applyEvent(state, event);
    cursor = t;
  }

  if (cursor <= endTimeSec) {
    segments.push({
      startTimeSec: cursor,
      endTimeSec: endTimeSec + 1,
      mediaId: state.mediaId,
      mediaStartTimeSec: state.mediaTimeSec,
      playbackRate: state.playbackRate,
      paused: state.paused,
    });
  }

  if (segments.length === 0) {
    segments.push({
      startTimeSec: 0,
      endTimeSec: endTimeSec + 1,
      mediaId: null,
      mediaStartTimeSec: null,
      playbackRate: 1,
      paused: true,
    });
  }

  return segments;
}

function mediaSnapshotAtTime(
  segments: PlaybackSegment[],
  t: number,
  assetMap: Map<string, MediaAsset>,
): MediaSnapshot | undefined {
  for (const seg of segments) {
    if (t >= seg.startTimeSec && t < seg.endTimeSec) {
      if (seg.mediaId === null || seg.mediaStartTimeSec === null)
        return undefined;
      const asset = assetMap.get(seg.mediaId);
      const mediaTimeSec = seg.paused
        ? seg.mediaStartTimeSec
        : seg.mediaStartTimeSec + (t - seg.startTimeSec) * seg.playbackRate;
      return {
        mediaId: seg.mediaId,
        displayName: asset?.displayName ?? seg.mediaId,
        mediaTimeSec: Math.round(mediaTimeSec * 100) / 100,
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Engagement computation
// ---------------------------------------------------------------------------

function computeEngagement(
  utteranceStart: number,
  utteranceEnd: number,
  events: PlaybackEvent[],
  segments: PlaybackSegment[],
): Engagement | undefined {
  let rewindCount = 0;
  let pauseCount = 0;
  let totalPauseDurationSec = 0;
  const playbackRateSet = new Set<number>();

  // Count rewinds and pauses from events within utterance window
  let prevMediaTimeSec: number | null = null;
  let prevMediaId: string | null = null;
  for (const event of events) {
    const t = event.sessionTimeSec;
    if (t < utteranceStart) {
      // Track state leading up to utterance for rewind detection
      if (event.mediaId !== null) {
        prevMediaTimeSec = event.mediaTimeSec;
        prevMediaId = event.mediaId;
      } else {
        prevMediaTimeSec = null;
        prevMediaId = null;
      }
      continue;
    }
    if (t >= utteranceEnd) break;

    if (
      event.type === "seek" &&
      event.mediaId !== null &&
      event.mediaId === prevMediaId
    ) {
      if (prevMediaTimeSec !== null && event.mediaTimeSec < prevMediaTimeSec) {
        rewindCount++;
      }
    }
    if (event.type === "pause") {
      pauseCount++;
    }

    if (event.mediaId !== null) {
      prevMediaTimeSec = event.mediaTimeSec;
      prevMediaId = event.mediaId;
    } else {
      prevMediaTimeSec = null;
      prevMediaId = null;
    }
  }

  // Compute pause duration and playback rates from segments overlapping utterance
  for (const seg of segments) {
    if (seg.startTimeSec >= utteranceEnd || seg.endTimeSec <= utteranceStart)
      continue;
    const overlapStart = Math.max(seg.startTimeSec, utteranceStart);
    const overlapEnd = Math.min(seg.endTimeSec, utteranceEnd);
    const duration = overlapEnd - overlapStart;
    if (duration <= 0) continue;

    if (seg.paused && seg.mediaId !== null) {
      totalPauseDurationSec += duration;
    }
    if (!seg.paused && seg.mediaId !== null) {
      playbackRateSet.add(seg.playbackRate);
    }
  }

  const roundedPauseDuration = Math.round(totalPauseDurationSec);
  const playbackRates = Array.from(playbackRateSet)
    .filter((r) => r !== 1)
    .sort((a, b) => a - b);

  const hasEngagement =
    rewindCount > 0 ||
    pauseCount > 0 ||
    roundedPauseDuration > 0 ||
    playbackRates.length > 0;

  if (!hasEngagement) return undefined;

  return {
    rewindCount,
    pauseCount,
    totalPauseDurationSec: roundedPauseDuration,
    playbackRates,
  };
}

function resolveMarkerPlayback(
  marker: Marker,
  assetMap: Map<string, MediaAsset>,
): MarkerPlayback {
  const playback = marker.playbackSnapshot;
  if (playback.mediaId === null) {
    return {
      mediaId: null,
      mediaTimeSec: null,
      playbackRate: playback.playbackRate,
      paused: playback.paused,
    };
  }
  return {
    mediaId: playback.mediaId,
    mediaTimeSec: playback.mediaTimeSec,
    playbackRate: playback.playbackRate,
    paused: playback.paused,
    displayName:
      assetMap.get(playback.mediaId)?.displayName ?? playback.mediaId,
  };
}

function compareMarkerAnchors(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function sortMarkers(markers: AnnotatedMarker[]): AnnotatedMarker[] {
  return [...markers].sort((a, b) => {
    const anchorDiff = compareMarkerAnchors(
      a.anchorSessionTimeSec,
      b.anchorSessionTimeSec,
    );
    if (anchorDiff !== 0) return anchorDiff;
    return compareStrings(a.markerId, b.markerId);
  });
}

function sortUtterances(
  utterances: TranscriptUtterance[],
): TranscriptUtterance[] {
  return [...utterances].sort((a, b) => {
    if (a.startTimeSec !== b.startTimeSec)
      return a.startTimeSec - b.startTimeSec;
    if (a.endTimeSec !== b.endTimeSec) return a.endTimeSec - b.endTimeSec;
    return compareStrings(a.utteranceId, b.utteranceId);
  });
}

function assertUniqueUtteranceIds(utterances: TranscriptUtterance[]): void {
  const seen = new Set<string>();
  for (const utt of utterances) {
    if (seen.has(utt.utteranceId)) {
      throw new Error(
        `Duplicate utteranceId in transcript: ${utt.utteranceId}`,
      );
    }
    seen.add(utt.utteranceId);
  }
}

function resolveMarker(
  marker: Marker,
  bucketMap: Map<string, Bucket>,
  tagMap: Map<string, Tag>,
  assetMap: Map<string, MediaAsset>,
): AnnotatedMarker {
  const bucket =
    marker.bucketId === null
      ? null
      : (() => {
          const resolved = bucketMap.get(marker.bucketId);
          if (!resolved) {
            throw new Error(
              `Unknown bucketId while projecting marker ${marker.markerId}: ${marker.bucketId}`,
            );
          }
          return resolved;
        })();
  const bucketTitle =
    bucket === null
      ? null
      : (() => {
          const title = bucket.title.trim();
          if (title.length === 0) {
            throw new Error(
              `Empty bucket title while projecting marker ${marker.markerId}: ${bucket.bucketId}`,
            );
          }
          return title;
        })();
  const tags = marker.tagIds.map((id) => {
    const tag = tagMap.get(id);
    if (!tag) {
      throw new Error(
        `Unknown tagId while projecting marker ${marker.markerId}: ${id}`,
      );
    }
    return tag.name;
  });

  return {
    markerId: marker.markerId,
    clipId: marker.groupId ?? marker.markerId,
    createdAtIso: marker.createdAtIso,
    anchorSessionTimeSec: marker.anchorSessionTimeSec,
    sourceType: marker.sourceType,
    importance: marker.importance,
    bucketId: marker.bucketId,
    tagIds: [...marker.tagIds],
    groupId: marker.groupId ?? null,
    playback: resolveMarkerPlayback(marker, assetMap),
    ...(marker.note ? { note: marker.note } : {}),
    ...(bucketTitle !== null ? { bucket: bucketTitle } : {}),
    tags,
    hasDrawing:
      marker.drawing !== undefined && marker.drawing.strokes.length > 0,
    ...(marker.drawing !== undefined && marker.drawing.strokes.length > 0
      ? { drawingRef: marker.markerId }
      : {}),
  };
}

function computeSessionEnd(
  session: SessionPackage,
  transcript: Transcript,
): number {
  let maxEnd = 0;
  for (const rec of session.recordings) {
    maxEnd = Math.max(maxEnd, rec.startSessionTimeSec + rec.durationSec);
  }
  for (const utt of transcript.utterances) {
    maxEnd = Math.max(maxEnd, utt.endTimeSec);
  }
  return Math.max(0, Math.ceil(maxEnd) - 1);
}

function buildSegments(utterances: AnnotatedUtterance[]): Segment[] {
  const segments: Segment[] = [];
  let current: SegmentBuildState | null = null;

  const pushCurrent = () => {
    if (current === null) return;
    segments.push({
      segmentIndex: segments.length,
      mediaId: current.mediaId,
      displayName: current.displayName,
      startSessionTimeSec: current.startSessionTimeSec,
      endSessionTimeSec: current.endSessionTimeSec,
      startUtteranceId: current.startUtteranceId,
      endUtteranceId: current.endUtteranceId,
    });
    current = null;
  };

  for (const utt of utterances) {
    if (!utt.media) {
      pushCurrent();
      continue;
    }

    if (current === null || current.mediaId !== utt.media.mediaId) {
      pushCurrent();
      current = {
        mediaId: utt.media.mediaId,
        displayName: utt.media.displayName,
        startSessionTimeSec: utt.startTimeSec,
        endSessionTimeSec: utt.endTimeSec,
        startUtteranceId: utt.utteranceId,
        endUtteranceId: utt.utteranceId,
      };
      continue;
    }

    if (utt.endTimeSec > current.endSessionTimeSec) {
      current.endSessionTimeSec = utt.endTimeSec;
      current.endUtteranceId = utt.utteranceId;
    } else if (utt.endTimeSec === current.endSessionTimeSec) {
      current.endUtteranceId = utt.utteranceId;
    }
  }

  pushCurrent();
  return segments;
}

function buildMediaIndex(params: {
  segments: Segment[];
  utterances: AnnotatedUtterance[];
  markers: AnnotatedMarker[];
  assetMap: Map<string, MediaAsset>;
}): MediaIndexItem[] {
  const orderedFromSegments: string[] = [];
  const segmentIds = new Set<string>();
  for (const segment of params.segments) {
    if (segmentIds.has(segment.mediaId)) continue;
    segmentIds.add(segment.mediaId);
    orderedFromSegments.push(segment.mediaId);
  }

  const referenced = new Set<string>();
  for (const mediaId of orderedFromSegments) referenced.add(mediaId);
  for (const utt of params.utterances) {
    if (utt.media) referenced.add(utt.media.mediaId);
  }
  for (const marker of params.markers) {
    if (marker.playback.mediaId !== null)
      referenced.add(marker.playback.mediaId);
  }

  const remaining = Array.from(referenced)
    .filter((mediaId) => !segmentIds.has(mediaId))
    .sort(compareStrings);

  const orderedIds = [...orderedFromSegments, ...remaining];
  return orderedIds.map((mediaId) => ({
    mediaId,
    displayName: params.assetMap.get(mediaId)?.displayName ?? mediaId,
  }));
}

function buildClips(params: {
  markers: AnnotatedMarker[];
  assetMap: Map<string, MediaAsset>;
}): Clip[] {
  const clipStates = new Map<string, ClipBuildState>();
  const clipKeyByPublicId = new Map<string, string>();

  for (const marker of params.markers) {
    const key = getClipAggregationKey(marker);
    const clipId = marker.clipId;
    const kind: ClipKind = marker.groupId === null ? "standalone" : "group";
    const existingKey = clipKeyByPublicId.get(clipId);
    if (existingKey !== undefined && existingKey !== key) {
      throw new Error(
        `Clip identity collision while projecting marker ${marker.markerId}: clipId=${clipId} reused across ${existingKey} and ${key}`,
      );
    }

    const existing = clipStates.get(key);
    if (existing) {
      if (existing.kind !== kind || existing.groupId !== marker.groupId) {
        throw new Error(
          `Clip aggregation mismatch while projecting marker ${marker.markerId}: expected kind=${existing.kind} groupId=${existing.groupId}, got kind=${kind} groupId=${marker.groupId}`,
        );
      }
      existing.markers.push(marker);
      continue;
    }
    clipKeyByPublicId.set(clipId, key);
    clipStates.set(key, {
      clipId,
      kind,
      groupId: marker.groupId,
      markers: [marker],
      sortAnchor: marker.anchorSessionTimeSec,
    });
  }

  const sortedClipStates = Array.from(clipStates.values()).sort((a, b) => {
    const anchorDiff = compareMarkerAnchors(a.sortAnchor, b.sortAnchor);
    if (anchorDiff !== 0) return anchorDiff;
    return compareStrings(a.clipId, b.clipId);
  });

  return sortedClipStates.map((state) => {
    const markerIds = state.markers.map((marker) => marker.markerId);
    const drawingRefs = state.markers
      .flatMap((marker) => (marker.drawingRef ? [marker.drawingRef] : []));

    if (state.kind === "standalone") {
      if (state.markers.length !== 1) {
        throw new Error(
          `Standalone clip aggregated multiple markers: clipId=${state.clipId}, count=${state.markers.length}`,
        );
      }
      const marker = state.markers[0];
      if (marker.playback.mediaId === null) {
        return {
          clipId: state.clipId,
          kind: state.kind,
          groupId: state.groupId,
          markerIds,
          mediaId: null,
          displayName: null,
          startMediaTimeSec: null,
          endMediaTimeSec: null,
          drawingRefs,
          status: "missing_media",
        };
      }

      const asset = params.assetMap.get(marker.playback.mediaId);
      const range = getStandaloneClipRange({
        mediaTimeSec: marker.playback.mediaTimeSec,
        durationSec: asset?.durationSec,
      });
      if (range.status !== "ready") {
        return {
          clipId: state.clipId,
          kind: state.kind,
          groupId: state.groupId,
          markerIds,
          mediaId: null,
          displayName: null,
          startMediaTimeSec: null,
          endMediaTimeSec: null,
          drawingRefs,
          status: range.status,
        };
      }

      return {
        clipId: state.clipId,
        kind: state.kind,
        groupId: state.groupId,
        markerIds,
        mediaId: marker.playback.mediaId,
        displayName: asset?.displayName ?? marker.playback.displayName,
        startMediaTimeSec: roundClipTimeSec(range.startMediaTimeSec),
        endMediaTimeSec: roundClipTimeSec(range.endMediaTimeSec),
        drawingRefs,
        status: "ready",
      };
    }

    const groupClipMarkers = state.markers.map((marker) => ({
      mediaId: marker.playback.mediaId,
      mediaTimeSec: marker.playback.mediaTimeSec,
    }));
    const groupDurationSec =
      state.markers[0].playback.mediaId === null
        ? undefined
        : params.assetMap.get(state.markers[0].playback.mediaId)?.durationSec;
    const groupClip =
      groupDurationSec === undefined
        ? computeGroupClip({ markers: groupClipMarkers })
        : computeGroupClip({
            markers: groupClipMarkers,
            durationSec: groupDurationSec,
          });
    if (groupClip.status !== "ready") {
      return {
        clipId: state.clipId,
        kind: state.kind,
        groupId: state.groupId,
        markerIds,
        mediaId: null,
        displayName: null,
        startMediaTimeSec: null,
        endMediaTimeSec: null,
        drawingRefs,
        status: groupClip.status,
      };
    }

    const asset = params.assetMap.get(groupClip.mediaId);
    const firstMarkerWithMedia = state.markers.find(
      (
        marker,
      ): marker is AnnotatedMarker & {
        playback: Extract<MarkerPlayback, { mediaId: string }>;
      } => marker.playback.mediaId === groupClip.mediaId,
    );

    return {
      clipId: state.clipId,
      kind: state.kind,
      groupId: state.groupId,
      markerIds,
      mediaId: groupClip.mediaId,
      displayName:
        asset?.displayName ??
        firstMarkerWithMedia?.playback.displayName ??
        groupClip.mediaId,
      startMediaTimeSec: roundClipTimeSec(groupClip.startMediaTimeSec),
      endMediaTimeSec: roundClipTimeSec(groupClip.endMediaTimeSec),
      drawingRefs,
      status: "ready",
    };
  });
}

export function buildAnnotatedTranscript(params: {
  sessionPath: string;
  transcriptPath: string;
  session: SessionPackage;
  transcript: Transcript;
  generatedAtIso: string;
}): AnnotatedTranscript {
  const { session, transcript } = params;

  const bucketMap = new Map<string, Bucket>();
  for (const b of session.outline.buckets) bucketMap.set(b.bucketId, b);

  const tagMap = new Map<string, Tag>();
  for (const t of session.taxonomy.tags) tagMap.set(t.tagId, t);

  const assetMap = new Map<string, MediaAsset>();
  for (const a of session.media.assets) assetMap.set(a.mediaId, a);

  const endTimeSec = computeSessionEnd(session, transcript);
  const playbackSegments = buildPlaybackSegments(
    session.telemetry.events,
    endTimeSec,
  );

  const sortedUtterances = sortUtterances(transcript.utterances);
  assertUniqueUtteranceIds(sortedUtterances);

  const resolvedMarkers: AnnotatedMarker[] = [];
  for (const m of session.markers) {
    resolvedMarkers.push(resolveMarker(m, bucketMap, tagMap, assetMap));
  }
  const sortedMarkers = sortMarkers(resolvedMarkers);

  const utteranceStates: UtteranceProjectionState[] = sortedUtterances.map(
    (utt) => {
      const engagement = computeEngagement(
        utt.startTimeSec,
        utt.endTimeSec,
        session.telemetry.events,
        playbackSegments,
      );
      const media = mediaSnapshotAtTime(
        playbackSegments,
        utt.startTimeSec,
        assetMap,
      );
      return {
        utteranceId: utt.utteranceId,
        speakerId: utt.speakerId,
        startTimeSec: utt.startTimeSec,
        endTimeSec: utt.endTimeSec,
        text: utt.text,
        markers: [],
        engagement,
        media,
      };
    },
  );

  const minTranscriptStart =
    sortedUtterances.length > 0 ? sortedUtterances[0].startTimeSec : null;
  let maxTranscriptEnd: number | null = null;
  for (const utt of sortedUtterances) {
    if (maxTranscriptEnd === null || utt.endTimeSec > maxTranscriptEnd) {
      maxTranscriptEnd = utt.endTimeSec;
    }
  }

  const orphanMarkers: AnnotatedOrphanMarker[] = [];
  const seenProjectedMarkerIds = new Set<string>();

  const addInlineMarker = (
    utteranceIndex: number,
    marker: AnnotatedMarker,
  ): void => {
    if (seenProjectedMarkerIds.has(marker.markerId)) {
      throw new Error(`Marker projected more than once: ${marker.markerId}`);
    }
    seenProjectedMarkerIds.add(marker.markerId);
    utteranceStates[utteranceIndex].markers.push(marker);
  };

  const addOrphan = (
    marker: AnnotatedMarker,
    orphanReason: OrphanReason,
  ): void => {
    if (seenProjectedMarkerIds.has(marker.markerId)) {
      throw new Error(`Marker projected more than once: ${marker.markerId}`);
    }
    seenProjectedMarkerIds.add(marker.markerId);
    orphanMarkers.push({ ...marker, orphanReason });
  };

  // Marker assignment contract:
  // - half-open containment [startTimeSec, endTimeSec)
  // - if utterances overlap and multiple match the same marker time,
  //   first-match in deterministically sorted utterances wins
  // This enforces "each markerId appears exactly once" across inline + orphan projections.
  for (const marker of sortedMarkers) {
    if (marker.anchorSessionTimeSec === null) {
      addOrphan(marker, "no_anchor_session_time");
      continue;
    }

    if (sortedUtterances.length === 0) {
      addOrphan(marker, "no_transcript_utterances");
      continue;
    }

    if (
      minTranscriptStart === null ||
      maxTranscriptEnd === null ||
      marker.anchorSessionTimeSec < minTranscriptStart ||
      marker.anchorSessionTimeSec > maxTranscriptEnd
    ) {
      addOrphan(marker, "out_of_transcript_range");
      continue;
    }

    let assignedUtteranceIndex = -1;
    for (let index = 0; index < sortedUtterances.length; index++) {
      const utterance = sortedUtterances[index];
      if (utterance.startTimeSec > marker.anchorSessionTimeSec) break;
      if (
        marker.anchorSessionTimeSec >= utterance.startTimeSec &&
        marker.anchorSessionTimeSec < utterance.endTimeSec
      ) {
        assignedUtteranceIndex = index;
        break;
      }
    }

    if (assignedUtteranceIndex >= 0) {
      addInlineMarker(assignedUtteranceIndex, marker);
      continue;
    }

    addOrphan(marker, "transcript_gap");
  }

  if (seenProjectedMarkerIds.size !== session.markers.length) {
    throw new Error(
      `Projected marker count mismatch: projected=${seenProjectedMarkerIds.size}, source=${session.markers.length}`,
    );
  }

  const utterances: AnnotatedUtterance[] = utteranceStates.map((utt) => ({
    utteranceId: utt.utteranceId,
    speakerId: utt.speakerId,
    startTimeSec: utt.startTimeSec,
    endTimeSec: utt.endTimeSec,
    text: utt.text,
    ...(utt.markers.length > 0 ? { markers: utt.markers } : {}),
    ...(utt.engagement ? { engagement: utt.engagement } : {}),
    ...(utt.media ? { media: utt.media } : {}),
  }));

  const segments = buildSegments(utterances);
  const clips = buildClips({
    markers: sortedMarkers,
    assetMap,
  });
  const mediaIndex = buildMediaIndex({
    segments,
    utterances,
    markers: sortedMarkers,
    assetMap,
  });

  let inlineMarkerCount = 0;
  for (const utt of utterances) inlineMarkerCount += utt.markers?.length ?? 0;
  const totalProjectedMarkers = inlineMarkerCount + orphanMarkers.length;
  if (totalProjectedMarkers !== session.markers.length) {
    throw new Error(
      `Projected marker totals mismatch: inline=${inlineMarkerCount}, orphan=${orphanMarkers.length}, source=${session.markers.length}`,
    );
  }

  return {
    source: {
      sessionPath: params.sessionPath,
      transcriptPath: params.transcriptPath,
      sessionId: session.sessionId,
      sessionName: session.name,
      generatedAtIso: params.generatedAtIso,
      counts: {
        utterances: utterances.length,
        markers: totalProjectedMarkers,
        clips: clips.length,
        sections: transcript.sections.length,
        orphanMarkers: orphanMarkers.length,
      },
    },
    speakers: transcript.speakers,
    sections: transcript.sections,
    utterances,
    orphanMarkers,
    clips,
    mediaIndex,
    segments,
  };
}
