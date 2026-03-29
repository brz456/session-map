import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { SessionUiSnapshot } from "../../shared/ipc/sessionUi";
import type { Marker, SessionPackage } from "../../shared/sessionPackage/types";
import { STANDALONE_CLIP_RADIUS_SEC } from "../../shared/clips/clipRules";
import {
  exportAllMarkerMedia,
  type ExportCoordinatorApi,
} from "./exportCoordinator";

function createMarker(params: {
  markerId: string;
  groupId?: string;
  mediaId: string | null;
  mediaTimeSec: number | null;
}): Marker {
  return {
    markerId: params.markerId,
    createdAtIso: "2026-03-10T00:00:00.000Z",
    anchorSessionTimeSec: 10,
    sourceType: "video",
    playbackSnapshot:
      params.mediaId === null
        ? {
            mediaId: null,
            mediaTimeSec: null,
            playbackRate: 1,
            paused: true,
          }
        : {
            mediaId: params.mediaId,
            mediaTimeSec: params.mediaTimeSec ?? 0,
            playbackRate: 1,
            paused: true,
          },
    bucketId: null,
    tagIds: [],
    importance: 2,
    ...(params.groupId ? { groupId: params.groupId } : {}),
  };
}

function createSession(markers: Marker[]): SessionUiSnapshot {
  const session: SessionPackage = {
    version: 1,
    sessionId: "session-1",
    name: "test-session",
    createdAtIso: "2026-03-10T00:00:00.000Z",
    updatedAtIso: "2026-03-10T00:00:00.000Z",
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
        },
        {
          mediaId: "media-b",
          displayName: "B.mp4",
          absolutePath: "C:/media/B.mp4",
        },
      ],
    },
    outline: { buckets: [] },
    taxonomy: { tags: [] },
    telemetry: { events: [] },
    markers,
    transcript: null,
  };

  return {
    ...session,
    telemetry: { events: [] as readonly never[] },
  };
}

function createApi(): ExportCoordinatorApi & {
  session: {
    exportMarkerStill: ReturnType<typeof vi.fn>;
    exportMarkerClip: ReturnType<typeof vi.fn>;
    exportGroupClip: ReturnType<typeof vi.fn>;
  };
  media: {
    getVideoInfo: ReturnType<typeof vi.fn>;
  };
} {
  return {
    session: {
      exportMarkerStill: vi.fn().mockResolvedValue({
        ok: true,
        outputRelativePath: "marker.png",
        skipped: false,
      }),
      exportMarkerClip: vi.fn().mockResolvedValue({
        ok: true,
        outputRelativePath: "marker.mp4",
        skipped: false,
      }),
      exportGroupClip: vi.fn().mockResolvedValue({
        ok: true,
        outputRelativePath: "group.mp4",
        skipped: false,
      }),
    },
    media: {
      getVideoInfo: vi.fn().mockResolvedValue({
        ok: true,
        width: 1920,
        height: 1080,
        durationSec: 120,
      }),
    },
  };
}

describe("exportAllMarkerMedia grouped clip statuses", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips grouped clip export when all markers in a group have no media", async () => {
    const api = createApi();
    const session = createSession([
      createMarker({
        markerId: "marker-1",
        groupId: "group-1",
        mediaId: null,
        mediaTimeSec: null,
      }),
      createMarker({
        markerId: "marker-2",
        groupId: "group-1",
        mediaId: null,
        mediaTimeSec: null,
      }),
    ]);

    const result = await exportAllMarkerMedia(api, session);

    expect(result.clips).toEqual({ exported: 0, skipped: 1, failed: 0 });
    expect(api.session.exportGroupClip).not.toHaveBeenCalled();
  });

  it("fails grouped clip export when only some markers in a group have media", async () => {
    const api = createApi();
    const session = createSession([
      createMarker({
        markerId: "marker-1",
        groupId: "group-1",
        mediaId: "media-a",
        mediaTimeSec: 10,
      }),
      createMarker({
        markerId: "marker-2",
        groupId: "group-1",
        mediaId: null,
        mediaTimeSec: null,
      }),
    ]);

    const result = await exportAllMarkerMedia(api, session);

    expect(result.clips).toEqual({ exported: 0, skipped: 0, failed: 1 });
    expect(api.session.exportGroupClip).not.toHaveBeenCalled();
  });

  it("fails grouped clip export when markers in a group span multiple media files", async () => {
    const api = createApi();
    const session = createSession([
      createMarker({
        markerId: "marker-1",
        groupId: "group-1",
        mediaId: "media-a",
        mediaTimeSec: 10,
      }),
      createMarker({
        markerId: "marker-2",
        groupId: "group-1",
        mediaId: "media-b",
        mediaTimeSec: 20,
      }),
    ]);

    const result = await exportAllMarkerMedia(api, session);

    expect(result.clips).toEqual({ exported: 0, skipped: 0, failed: 1 });
    expect(api.session.exportGroupClip).not.toHaveBeenCalled();
  });

  it("exports grouped clips with computed start and end times from the shared helper", async () => {
    const api = createApi();
    const session = createSession([
      createMarker({
        markerId: "marker-1",
        groupId: "group-1",
        mediaId: "media-a",
        mediaTimeSec: 10,
      }),
      createMarker({
        markerId: "marker-2",
        groupId: "group-1",
        mediaId: "media-a",
        mediaTimeSec: 20,
      }),
    ]);

    const result = await exportAllMarkerMedia(api, session);

    expect(result.clips).toEqual({ exported: 1, skipped: 0, failed: 0 });
    expect(api.session.exportGroupClip).toHaveBeenCalledTimes(1);
    expect(api.session.exportGroupClip).toHaveBeenCalledWith(
      "group-1",
      "media-a",
      5,
      25,
      120,
    );
  });

  it("exports standalone clips with the shared standalone radius", async () => {
    const api = createApi();
    const session = createSession([
      createMarker({
        markerId: "marker-1",
        mediaId: "media-a",
        mediaTimeSec: 10,
      }),
    ]);

    const result = await exportAllMarkerMedia(api, session);

    expect(result.clips).toEqual({ exported: 1, skipped: 0, failed: 0 });
    expect(api.session.exportMarkerClip).toHaveBeenCalledTimes(1);
    expect(api.session.exportMarkerClip).toHaveBeenCalledWith(
      "marker-1",
      120,
      STANDALONE_CLIP_RADIUS_SEC,
    );
  });

  it("fails standalone clip export when the marker time collapses after duration clamping", async () => {
    const api = createApi();
    const session = createSession([
      createMarker({
        markerId: "marker-1",
        mediaId: "media-a",
        mediaTimeSec: 200,
      }),
    ]);

    const result = await exportAllMarkerMedia(api, session);

    expect(result.clips).toEqual({ exported: 0, skipped: 0, failed: 1 });
    expect(api.session.exportMarkerClip).not.toHaveBeenCalled();
  });

  it("fails standalone clip export when the marker time is invalid", async () => {
    const api = createApi();
    const session = createSession([
      createMarker({
        markerId: "marker-1",
        mediaId: "media-a",
        mediaTimeSec: Number.NEGATIVE_INFINITY,
      }),
    ]);

    const result = await exportAllMarkerMedia(api, session);

    expect(result.clips).toEqual({ exported: 0, skipped: 0, failed: 1 });
    expect(api.session.exportMarkerClip).not.toHaveBeenCalled();
  });

  it("fails grouped clip export when marker times collapse after duration clamping", async () => {
    const api = createApi();
    const session = createSession([
      createMarker({
        markerId: "marker-1",
        groupId: "group-1",
        mediaId: "media-a",
        mediaTimeSec: 130,
      }),
      createMarker({
        markerId: "marker-2",
        groupId: "group-1",
        mediaId: "media-a",
        mediaTimeSec: 140,
      }),
    ]);

    const result = await exportAllMarkerMedia(api, session);

    expect(result.clips).toEqual({ exported: 0, skipped: 0, failed: 1 });
    expect(api.session.exportGroupClip).not.toHaveBeenCalled();
  });

  it("fails grouped clip export when marker times are invalid", async () => {
    const api = createApi();
    const session = createSession([
      createMarker({
        markerId: "marker-1",
        groupId: "group-1",
        mediaId: "media-a",
        mediaTimeSec: -1,
      }),
      createMarker({
        markerId: "marker-2",
        groupId: "group-1",
        mediaId: "media-a",
        mediaTimeSec: 10,
      }),
    ]);

    const result = await exportAllMarkerMedia(api, session);

    expect(result.clips).toEqual({ exported: 0, skipped: 0, failed: 1 });
    expect(api.session.exportGroupClip).not.toHaveBeenCalled();
  });
});
