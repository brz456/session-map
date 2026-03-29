import { describe, expect, it } from "vitest";

import { computeGroupClip, getStandaloneClipRange } from "./clipRules";

describe("clipRules", () => {
  it("returns missing_media when no group markers have media", () => {
    expect(
      computeGroupClip({
        markers: [
          { mediaId: null, mediaTimeSec: null },
          { mediaId: null, mediaTimeSec: null },
        ],
      }),
    ).toEqual({
      status: "missing_media",
    });
  });

  it("returns partial_group_media when only some group markers have media", () => {
    expect(
      computeGroupClip({
        markers: [
          { mediaId: "media-a", mediaTimeSec: 10 },
          { mediaId: null, mediaTimeSec: null },
        ],
      }),
    ).toEqual({
      status: "partial_group_media",
    });
  });

  it("returns mixed_media when group markers span multiple media assets", () => {
    expect(
      computeGroupClip({
        markers: [
          { mediaId: "media-a", mediaTimeSec: 10 },
          { mediaId: "media-b", mediaTimeSec: 20 },
        ],
      }),
    ).toEqual({
      status: "mixed_media",
    });
  });

  it("clamps standalone clip ranges to known duration when the interval remains valid", () => {
    expect(
      getStandaloneClipRange({
        mediaTimeSec: 105,
        durationSec: 100,
      }),
    ).toEqual({
      status: "ready",
      startMediaTimeSec: 75,
      endMediaTimeSec: 100,
    });
  });

  it("fails closed for standalone clip ranges that collapse after duration clamping", () => {
    expect(
      getStandaloneClipRange({
        mediaTimeSec: 140,
        durationSec: 100,
      }),
    ).toEqual({
      status: "out_of_bounds_media_time",
    });
  });

  it("fails closed for standalone clip ranges with invalid source timing", () => {
    expect(
      getStandaloneClipRange({
        mediaTimeSec: -1,
      }),
    ).toEqual({
      status: "invalid_clip_timing",
    });

    expect(
      getStandaloneClipRange({
        mediaTimeSec: Number.NaN,
        durationSec: 100,
      }),
    ).toEqual({
      status: "invalid_clip_timing",
    });

    expect(
      getStandaloneClipRange({
        mediaTimeSec: 10,
        durationSec: 0,
      }),
    ).toEqual({
      status: "invalid_clip_timing",
    });
  });

  it("fails closed for grouped clip ranges that collapse after duration clamping", () => {
    expect(
      computeGroupClip({
        markers: [
          { mediaId: "media-a", mediaTimeSec: 130 },
          { mediaId: "media-a", mediaTimeSec: 140 },
        ],
        durationSec: 120,
      }),
    ).toEqual({
      status: "out_of_bounds_media_time",
    });
  });

  it("fails closed for grouped clip ranges with invalid source timing", () => {
    expect(
      computeGroupClip({
        markers: [
          { mediaId: "media-a", mediaTimeSec: -1 },
          { mediaId: "media-a", mediaTimeSec: 10 },
        ],
      }),
    ).toEqual({
      status: "invalid_clip_timing",
    });

    expect(
      computeGroupClip({
        markers: [
          { mediaId: "media-a", mediaTimeSec: Number.POSITIVE_INFINITY },
          { mediaId: "media-a", mediaTimeSec: 10 },
        ],
        durationSec: 120,
      }),
    ).toEqual({
      status: "invalid_clip_timing",
    });

    expect(
      computeGroupClip({
        markers: [
          { mediaId: "media-a", mediaTimeSec: 10 },
          { mediaId: "media-a", mediaTimeSec: 20 },
        ],
        durationSec: Number.NaN,
      }),
    ).toEqual({
      status: "invalid_clip_timing",
    });
  });
});
