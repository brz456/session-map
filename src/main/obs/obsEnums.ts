// src/main/obs/obsEnums.ts
// OBS Studio enum values for obs-studio-node integration
// These match the native OBS C API constants

/**
 * Video pixel formats supported by OBS.
 * NV12 is most common for hardware encoding.
 */
export const enum ObsVideoFormat {
  None = 0,
  I420 = 1,
  NV12 = 2,
  YVYU = 3,
  YUY2 = 4,
  UYVY = 5,
  RGBA = 6,
  BGRA = 7,
  BGRX = 8,
  Y800 = 9,
  I444 = 10,
}

/**
 * Color space definitions for video output.
 */
export const enum ObsColorSpace {
  Default = 0,
  CS601 = 1,
  CS709 = 2,
  SRGB = 3,
}

/**
 * Color range for video output.
 */
export const enum ObsColorRange {
  Default = 0,
  Partial = 1,
  Full = 2,
}

/**
 * Video scaling algorithms.
 */
export const enum ObsScaleType {
  Disable = 0,
  Point = 1,
  Bicubic = 2,
  Bilinear = 3,
  Lanczos = 4,
  Area = 5,
}

/**
 * FPS specification type.
 */
export const enum ObsFpsType {
  Common = 0,
  Integer = 1,
  Fractional = 2,
}

/**
 * Speaker layout for audio output.
 */
export const enum ObsSpeakerLayout {
  Unknown = 0,
  Mono = 1,
  Stereo = 2,
  TwoPointOne = 3,
  Four = 4,
  FourPointOne = 5,
  FivePointOne = 6,
  SevenPointOne = 8,
}

/**
 * Property types for OBS source properties.
 * EPropertyType is not exported by obs-studio-node.
 */
export const enum ObsPropertyType {
  Invalid = 0,
  Bool = 1,
  Int = 2,
  Float = 3,
  Text = 4,
  Path = 5,
  List = 6,
  Color = 7,
  Button = 8,
  Font = 9,
  EditableList = 10,
  FrameRate = 11,
}
