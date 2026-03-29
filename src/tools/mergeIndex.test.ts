import { describe, expect, it } from "vitest";

import type {
  Marker,
  SessionPackage,
  Transcript,
} from "../shared/sessionPackage/types";
import { buildAnnotatedTranscript } from "./mergeIndex";

function createSession(
  markers: Marker[],
  tagIds: string[] = ["tag-1", "tag-2"],
): SessionPackage {
  return {
    version: 1,
    sessionId: "session-1",
    name: "test-session",
    createdAtIso: "2026-03-04T00:00:00.000Z",
    updatedAtIso: "2026-03-04T00:00:00.000Z",
    platform: { os: "windows" },
    timebase: { origin: "obs_recording_started", timeUnit: "seconds" },
    recordings: [
      {
        id: "recording-1",
        startSessionTimeSec: 0,
        durationSec: 120,
        file: "recording/session.mp4",
      },
    ],
    media: {
      assets: [
        {
          mediaId: "media-a",
          displayName: "A.mp4",
          absolutePath: "C:/media/A.mp4",
          durationSec: 120,
        },
        {
          mediaId: "media-b",
          displayName: "B.mp4",
          absolutePath: "C:/media/B.mp4",
          durationSec: 30,
        },
        {
          mediaId: "media-c",
          displayName: "C.mp4",
          absolutePath: "C:/media/C.mp4",
          durationSec: 20,
        },
      ],
    },
    outline: {
      buckets: [{ bucketId: "bucket-1", title: "Bucket One", sortIndex: 0 }],
    },
    taxonomy: {
      tags: tagIds.map((tagId, index) => ({
        tagId,
        name: `Tag ${index + 1}`,
      })),
    },
    telemetry: {
      events: [
        {
          type: "load",
          sessionTimeSec: 0,
          playbackRate: 1,
          mediaId: "media-a",
          mediaTimeSec: 0,
        },
        {
          type: "play",
          sessionTimeSec: 0,
          playbackRate: 1,
          mediaId: "media-a",
          mediaTimeSec: 0,
        },
        {
          type: "seek",
          sessionTimeSec: 15,
          playbackRate: 1,
          mediaId: "media-b",
          mediaTimeSec: 0,
        },
      ],
    },
    markers,
    transcript: { relativePath: "transcript.json" },
  };
}

function createTranscript(): Transcript {
  return {
    provider: "internal-transcript-tool",
    importedAtIso: "2026-03-04T00:00:00.000Z",
    sections: [],
    speakers: [{ speakerId: "S1" }],
    utterances: [
      {
        utteranceId: "utt-b",
        speakerId: "S1",
        startTimeSec: 20,
        endTimeSec: 30,
        text: "later",
      },
      {
        utteranceId: "utt-c",
        speakerId: "S1",
        startTimeSec: 0,
        endTimeSec: 10,
        text: "first-c",
      },
      {
        utteranceId: "utt-a",
        speakerId: "S1",
        startTimeSec: 0,
        endTimeSec: 10,
        text: "first-a",
      },
    ],
  };
}

function marker(params: {
  markerId: string;
  anchorSessionTimeSec: number | null;
  tagIds: string[];
  mediaId: string | null;
  mediaTimeSec: number | null;
  groupId?: string;
  bucketId?: string | null;
  hasDrawing?: boolean;
}): Marker {
  const playbackSnapshot =
    params.mediaId === null
      ? {
          mediaId: null,
          mediaTimeSec: null,
          playbackRate: 1,
          paused: true as const,
        }
      : {
          mediaId: params.mediaId,
          mediaTimeSec: params.mediaTimeSec ?? 0,
          playbackRate: 1,
          paused: true as const,
        };

  return {
    markerId: params.markerId,
    createdAtIso: "2026-03-04T00:00:00.000Z",
    anchorSessionTimeSec: params.anchorSessionTimeSec,
    sourceType: "video",
    playbackSnapshot,
    bucketId: params.bucketId ?? "bucket-1",
    tagIds: params.tagIds,
    importance: 2,
    ...(params.hasDrawing
      ? {
          drawing: {
            coordinateSpace: "video_normalized" as const,
            strokeWidth: 3,
            strokes: [
              {
                color: "#FF0000",
                points: [
                  { x: 0.1, y: 0.1 },
                  { x: 0.2, y: 0.2 },
                ],
              },
            ],
          },
        }
      : {}),
    ...(params.groupId ? { groupId: params.groupId } : {}),
  };
}

describe("buildAnnotatedTranscript", () => {
  function createProjectedResult() {
    const session = createSession([
      marker({
        markerId: "marker-gap",
        anchorSessionTimeSec: 12,
        tagIds: ["tag-1"],
        mediaId: "media-a",
        mediaTimeSec: 5,
      }),
      marker({
        markerId: "marker-2",
        anchorSessionTimeSec: 5,
        tagIds: ["tag-1"],
        mediaId: "media-a",
        mediaTimeSec: 5,
      }),
      marker({
        markerId: "marker-1",
        anchorSessionTimeSec: 5,
        tagIds: ["tag-2"],
        mediaId: "media-a",
        mediaTimeSec: 6,
      }),
      marker({
        markerId: "marker-null",
        anchorSessionTimeSec: null,
        tagIds: ["tag-1"],
        mediaId: "media-c",
        mediaTimeSec: 11,
      }),
      marker({
        markerId: "marker-transcript-end",
        anchorSessionTimeSec: 30,
        tagIds: ["tag-2"],
        mediaId: "media-b",
        mediaTimeSec: 31,
      }),
      marker({
        markerId: "marker-out",
        anchorSessionTimeSec: 40,
        tagIds: ["tag-1"],
        mediaId: "media-c",
        mediaTimeSec: 12,
      }),
    ]);

    const result = buildAnnotatedTranscript({
      sessionPath: "session.json",
      transcriptPath: "transcript.json",
      session,
      transcript: createTranscript(),
      generatedAtIso: "2026-03-04T00:00:00.000Z",
    });

    return { result, session };
  }

  it("sorts utterances and inline markers deterministically", () => {
    const { result } = createProjectedResult();

    expect(result.utterances.map((u) => u.utteranceId)).toEqual([
      "utt-a",
      "utt-c",
      "utt-b",
    ]);
    expect(result.utterances[0].markers?.map((m) => m.markerId)).toEqual([
      "marker-1",
      "marker-2",
    ]);
  });

  it("keeps null-anchor markers as no_anchor_session_time orphans", () => {
    const { result } = createProjectedResult();

    expect(
      result.utterances.flatMap((u) => u.markers?.map((m) => m.markerId) ?? []),
    ).not.toContain("marker-null");
    expect(result.orphanMarkers.map((m) => m.markerId)).toEqual([
      "marker-gap",
      "marker-transcript-end",
      "marker-out",
      "marker-null",
    ]);
    expect(result.orphanMarkers.map((m) => m.orphanReason)).toEqual([
      "transcript_gap",
      "transcript_gap",
      "out_of_transcript_range",
      "no_anchor_session_time",
    ]);
  });

  it("keeps source counts aligned with projected marker totals", () => {
    const { result, session } = createProjectedResult();

    const inlineMarkers = result.utterances.flatMap((u) => u.markers ?? []);
    const allProjected = [...inlineMarkers, ...result.orphanMarkers];
    expect(allProjected).toHaveLength(session.markers.length);
    expect(new Set(allProjected.map((m) => m.markerId)).size).toBe(
      session.markers.length,
    );

    expect(result.source.counts.utterances).toBe(result.utterances.length);
    expect(result.source.counts.sections).toBe(result.sections.length);
    expect(result.source.counts.orphanMarkers).toBe(
      result.orphanMarkers.length,
    );
    expect(result.source.counts.markers).toBe(
      inlineMarkers.length + result.orphanMarkers.length,
    );
    expect(result.source.counts.markers).toBe(session.markers.length);
  });

  it("coalesces segments deterministically from sorted utterances", () => {
    const { result } = createProjectedResult();

    expect(result.segments).toEqual([
      {
        segmentIndex: 0,
        mediaId: "media-a",
        displayName: "A.mp4",
        startSessionTimeSec: 0,
        endSessionTimeSec: 10,
        startUtteranceId: "utt-a",
        endUtteranceId: "utt-c",
      },
      {
        segmentIndex: 1,
        mediaId: "media-b",
        displayName: "B.mp4",
        startSessionTimeSec: 20,
        endSessionTimeSec: 30,
        startUtteranceId: "utt-b",
        endUtteranceId: "utt-b",
      },
    ]);
  });

  it("builds mediaIndex in deterministic order", () => {
    const { result } = createProjectedResult();

    expect(result.mediaIndex).toEqual([
      { mediaId: "media-a", displayName: "A.mp4" },
      { mediaId: "media-b", displayName: "B.mp4" },
      { mediaId: "media-c", displayName: "C.mp4" },
    ]);
  });

  it("projects explicit clips and marker clip refs deterministically", () => {
    const session = createSession([
      marker({
        markerId: "marker-standalone",
        anchorSessionTimeSec: 5,
        tagIds: ["tag-1"],
        mediaId: "media-a",
        mediaTimeSec: 40,
      }),
      marker({
        markerId: "marker-group-b",
        anchorSessionTimeSec: 22,
        tagIds: ["tag-1"],
        mediaId: "media-b",
        mediaTimeSec: 20,
        groupId: "group-1",
        hasDrawing: true,
      }),
      marker({
        markerId: "marker-group-a",
        anchorSessionTimeSec: 21,
        tagIds: ["tag-2"],
        mediaId: "media-b",
        mediaTimeSec: 10,
        groupId: "group-1",
      }),
    ]);
    const transcript: Transcript = {
      provider: "internal-transcript-tool",
      importedAtIso: "2026-03-04T00:00:00.000Z",
      sections: [],
      speakers: [{ speakerId: "S1" }],
      utterances: [
        {
          utteranceId: "utt-1",
          speakerId: "S1",
          startTimeSec: 0,
          endTimeSec: 10,
          text: "standalone",
        },
        {
          utteranceId: "utt-2",
          speakerId: "S1",
          startTimeSec: 20,
          endTimeSec: 30,
          text: "grouped",
        },
      ],
    };

    const result = buildAnnotatedTranscript({
      sessionPath: "session.json",
      transcriptPath: "transcript.json",
      session,
      transcript,
      generatedAtIso: "2026-03-04T00:00:00.000Z",
    });

    expect(result.source.counts.clips).toBe(2);
    expect(result.utterances[0].markers?.[0]).toMatchObject({
      markerId: "marker-standalone",
      clipId: "marker-standalone",
    });
    expect(result.utterances[1].markers?.map((marker) => marker.clipId)).toEqual([
      "group-1",
      "group-1",
    ]);
    expect(result.utterances[1].markers?.[1]).toMatchObject({
      markerId: "marker-group-b",
      clipId: "group-1",
      drawingRef: "marker-group-b",
    });
    expect(result.clips).toEqual([
      {
        clipId: "marker-standalone",
        kind: "standalone",
        groupId: null,
        markerIds: ["marker-standalone"],
        mediaId: "media-a",
        displayName: "A.mp4",
        startMediaTimeSec: 10,
        endMediaTimeSec: 70,
        drawingRefs: [],
        status: "ready",
      },
      {
        clipId: "group-1",
        kind: "group",
        groupId: "group-1",
        markerIds: ["marker-group-a", "marker-group-b"],
        mediaId: "media-b",
        displayName: "B.mp4",
        startMediaTimeSec: 5,
        endMediaTimeSec: 25,
        drawingRefs: ["marker-group-b"],
        status: "ready",
      },
    ]);
  });

  it("fails closed when standalone markerId collides with a grouped clipId", () => {
    const session = createSession([
      marker({
        markerId: "shared-id",
        anchorSessionTimeSec: 5,
        tagIds: ["tag-1"],
        mediaId: "media-a",
        mediaTimeSec: 40,
      }),
      marker({
        markerId: "group-member",
        anchorSessionTimeSec: 21,
        tagIds: ["tag-2"],
        mediaId: "media-b",
        mediaTimeSec: 10,
        groupId: "shared-id",
      }),
    ]);
    const transcript: Transcript = {
      provider: "internal-transcript-tool",
      importedAtIso: "2026-03-04T00:00:00.000Z",
      sections: [],
      speakers: [{ speakerId: "S1" }],
      utterances: [
        {
          utteranceId: "utt-1",
          speakerId: "S1",
          startTimeSec: 0,
          endTimeSec: 10,
          text: "one",
        },
        {
          utteranceId: "utt-2",
          speakerId: "S1",
          startTimeSec: 20,
          endTimeSec: 30,
          text: "two",
        },
      ],
    };

    expect(() =>
      buildAnnotatedTranscript({
        sessionPath: "session.json",
        transcriptPath: "transcript.json",
        session,
        transcript,
        generatedAtIso: "2026-03-04T00:00:00.000Z",
      }),
    ).toThrow(
      "Clip identity collision while projecting marker group-member: clipId=shared-id reused across standalone:shared-id and group:shared-id",
    );
  });

  it("distinguishes partial group media from missing group media", () => {
    const session = createSession([
      marker({
        markerId: "group-with-media",
        anchorSessionTimeSec: 21,
        tagIds: ["tag-1"],
        mediaId: "media-b",
        mediaTimeSec: 10,
        groupId: "group-1",
      }),
      marker({
        markerId: "group-no-media",
        anchorSessionTimeSec: 22,
        tagIds: ["tag-2"],
        mediaId: null,
        mediaTimeSec: null,
        groupId: "group-1",
      }),
      marker({
        markerId: "all-missing-a",
        anchorSessionTimeSec: 41,
        tagIds: ["tag-1"],
        mediaId: null,
        mediaTimeSec: null,
        groupId: "group-2",
      }),
      marker({
        markerId: "all-missing-b",
        anchorSessionTimeSec: 42,
        tagIds: ["tag-2"],
        mediaId: null,
        mediaTimeSec: null,
        groupId: "group-2",
      }),
    ]);
    const transcript: Transcript = {
      provider: "internal-transcript-tool",
      importedAtIso: "2026-03-04T00:00:00.000Z",
      sections: [],
      speakers: [{ speakerId: "S1" }],
      utterances: [
        {
          utteranceId: "utt-1",
          speakerId: "S1",
          startTimeSec: 20,
          endTimeSec: 30,
          text: "partial",
        },
        {
          utteranceId: "utt-2",
          speakerId: "S1",
          startTimeSec: 40,
          endTimeSec: 50,
          text: "missing",
        },
      ],
    };

    const result = buildAnnotatedTranscript({
      sessionPath: "session.json",
      transcriptPath: "transcript.json",
      session,
      transcript,
      generatedAtIso: "2026-03-04T00:00:00.000Z",
    });

    expect(result.clips).toEqual([
      {
        clipId: "group-1",
        kind: "group",
        groupId: "group-1",
        markerIds: ["group-with-media", "group-no-media"],
        mediaId: null,
        displayName: null,
        startMediaTimeSec: null,
        endMediaTimeSec: null,
        drawingRefs: [],
        status: "partial_group_media",
      },
      {
        clipId: "group-2",
        kind: "group",
        groupId: "group-2",
        markerIds: ["all-missing-a", "all-missing-b"],
        mediaId: null,
        displayName: null,
        startMediaTimeSec: null,
        endMediaTimeSec: null,
        drawingRefs: [],
        status: "missing_media",
      },
    ]);
  });

  it("projects non-ready status for standalone and grouped clips that collapse after duration clamping", () => {
    const session = createSession([
      marker({
        markerId: "standalone-out-of-bounds",
        anchorSessionTimeSec: 5,
        tagIds: ["tag-1"],
        mediaId: "media-c",
        mediaTimeSec: 60,
      }),
      marker({
        markerId: "group-out-of-bounds-a",
        anchorSessionTimeSec: 21,
        tagIds: ["tag-1"],
        mediaId: "media-c",
        mediaTimeSec: 40,
        groupId: "group-out-of-bounds",
      }),
      marker({
        markerId: "group-out-of-bounds-b",
        anchorSessionTimeSec: 22,
        tagIds: ["tag-2"],
        mediaId: "media-c",
        mediaTimeSec: 45,
        groupId: "group-out-of-bounds",
      }),
    ]);
    const transcript: Transcript = {
      provider: "internal-transcript-tool",
      importedAtIso: "2026-03-04T00:00:00.000Z",
      sections: [],
      speakers: [{ speakerId: "S1" }],
      utterances: [
        {
          utteranceId: "utt-1",
          speakerId: "S1",
          startTimeSec: 0,
          endTimeSec: 10,
          text: "standalone",
        },
        {
          utteranceId: "utt-2",
          speakerId: "S1",
          startTimeSec: 20,
          endTimeSec: 30,
          text: "group",
        },
      ],
    };

    const result = buildAnnotatedTranscript({
      sessionPath: "session.json",
      transcriptPath: "transcript.json",
      session,
      transcript,
      generatedAtIso: "2026-03-04T00:00:00.000Z",
    });

    expect(result.clips).toEqual([
      {
        clipId: "standalone-out-of-bounds",
        kind: "standalone",
        groupId: null,
        markerIds: ["standalone-out-of-bounds"],
        mediaId: null,
        displayName: null,
        startMediaTimeSec: null,
        endMediaTimeSec: null,
        drawingRefs: [],
        status: "out_of_bounds_media_time",
      },
      {
        clipId: "group-out-of-bounds",
        kind: "group",
        groupId: "group-out-of-bounds",
        markerIds: ["group-out-of-bounds-a", "group-out-of-bounds-b"],
        mediaId: null,
        displayName: null,
        startMediaTimeSec: null,
        endMediaTimeSec: null,
        drawingRefs: [],
        status: "out_of_bounds_media_time",
      },
    ]);
  });

  it("fails closed when marker tagId cannot be resolved to a tag name", () => {
    const session = createSession(
      [
        marker({
          markerId: "marker-unknown-tag",
          anchorSessionTimeSec: 5,
          tagIds: ["missing-tag"],
          mediaId: "media-a",
          mediaTimeSec: 5,
        }),
      ],
      ["tag-1"],
    );

    expect(() =>
      buildAnnotatedTranscript({
        sessionPath: "session.json",
        transcriptPath: "transcript.json",
        session,
        transcript: createTranscript(),
        generatedAtIso: "2026-03-04T00:00:00.000Z",
      }),
    ).toThrow(
      "Unknown tagId while projecting marker marker-unknown-tag: missing-tag",
    );
  });

  it("fails closed when marker bucketId cannot be resolved", () => {
    const session = createSession([
      marker({
        markerId: "marker-unknown-bucket",
        anchorSessionTimeSec: 5,
        bucketId: "missing-bucket",
        tagIds: ["tag-1"],
        mediaId: "media-a",
        mediaTimeSec: 5,
      }),
    ]);

    expect(() =>
      buildAnnotatedTranscript({
        sessionPath: "session.json",
        transcriptPath: "transcript.json",
        session,
        transcript: createTranscript(),
        generatedAtIso: "2026-03-04T00:00:00.000Z",
      }),
    ).toThrow(
      "Unknown bucketId while projecting marker marker-unknown-bucket: missing-bucket",
    );
  });

  it("fails closed when resolved bucket title is blank", () => {
    const session = createSession([
      marker({
        markerId: "marker-blank-bucket",
        anchorSessionTimeSec: 5,
        tagIds: ["tag-1"],
        mediaId: "media-a",
        mediaTimeSec: 5,
      }),
    ]);
    session.outline.buckets[0].title = "   ";

    expect(() =>
      buildAnnotatedTranscript({
        sessionPath: "session.json",
        transcriptPath: "transcript.json",
        session,
        transcript: createTranscript(),
        generatedAtIso: "2026-03-04T00:00:00.000Z",
      }),
    ).toThrow(
      "Empty bucket title while projecting marker marker-blank-bucket: bucket-1",
    );
  });
});
