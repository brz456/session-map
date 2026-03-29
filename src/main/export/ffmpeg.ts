// src/main/export/ffmpeg.ts
// FFmpeg wrapper for frame extraction and overlay compositing

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { toAsarUnpackedPath } from '../app/asarPath';

// ffmpeg-static provides the path to the bundled ffmpeg binary
// eslint-disable-next-line @typescript-eslint/no-var-requires
let ffmpegPath: string | null = null;
let ffmpegResolutionError: string | null = null;

function resolveFfmpegStaticPath(
  candidatePath: string,
  pathExists: (candidatePath: string) => boolean = existsSync,
): { path: string | null; attemptedPaths: string[]; resolvedFromAsar: boolean } {
  const unpackedPath = toAsarUnpackedPath(candidatePath);
  const resolvedFromAsar = unpackedPath !== candidatePath;

  // If ffmpeg-static resolves inside app.asar, only trust the unpacked path.
  // app.asar may appear to exist virtually but is not spawnable as a binary.
  if (resolvedFromAsar) {
    if (pathExists(unpackedPath)) {
      return { path: unpackedPath, attemptedPaths: [unpackedPath], resolvedFromAsar };
    }
    return { path: null, attemptedPaths: [unpackedPath, candidatePath], resolvedFromAsar };
  }

  if (pathExists(candidatePath)) {
    return { path: candidatePath, attemptedPaths: [candidatePath], resolvedFromAsar };
  }
  return { path: null, attemptedPaths: [candidatePath], resolvedFromAsar };
}

export type ResolveFfmpegStaticExportResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

/**
 * Exported as a narrow deterministic seam for unit tests of path/error handling.
 * Runtime callers should continue using getFfmpegPath().
 */
export function resolveFfmpegStaticExport(
  ffmpegStatic: unknown,
  pathExists: (candidatePath: string) => boolean = existsSync,
): ResolveFfmpegStaticExportResult {
  if (typeof ffmpegStatic !== 'string') {
    return { ok: false, message: `ffmpeg-static returned non-string value: ${String(ffmpegStatic)}` };
  }

  const resolved = resolveFfmpegStaticPath(ffmpegStatic, pathExists);
  if (resolved.path) {
    return { ok: true, path: resolved.path };
  }

  if (resolved.resolvedFromAsar) {
    return {
      ok: false,
      message: `ffmpeg-static resolved inside app.asar, but unpacked binary was not found (attempted: ${resolved.attemptedPaths.join(', ')})`,
    };
  }

  return { ok: false, message: `ffmpeg-static resolved to '${ffmpegStatic}' but file does not exist` };
}

/**
 * Gets the path to the ffmpeg binary.
 * Uses ffmpeg-static which bundles a platform-specific binary.
 * Returns null if not found; use getFfmpegError() to get the reason.
 */
export function getFfmpegPath(): string | null {
  if (ffmpegPath !== null) {
    return ffmpegPath;
  }

  // Already tried and failed
  if (ffmpegResolutionError !== null) {
    return null;
  }

  try {
    // ffmpeg-static exports the path to the binary
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegStatic = require('ffmpeg-static');
    const resolved = resolveFfmpegStaticExport(ffmpegStatic);
    if (resolved.ok) {
      ffmpegPath = resolved.path;
      return ffmpegPath;
    }
    ffmpegResolutionError = resolved.message;
  } catch (err) {
    ffmpegResolutionError = `Failed to load ffmpeg-static: ${err instanceof Error ? err.message : String(err)}`;
  }

  return null;
}

/**
 * Returns the error message if ffmpeg resolution failed, or null if not yet attempted or succeeded.
 */
export function getFfmpegError(): string | null {
  return ffmpegResolutionError;
}

export type GetVideoInfoResult =
  | { ok: true; width: number; height: number; durationSec: number; fps: number | null }
  | { ok: false; code: 'ffmpeg_missing' | 'ffmpeg_failed'; message: string };

/**
 * Gets video dimensions and duration using ffmpeg.
 * Parses the stream info from ffmpeg stderr output.
 */
export async function getVideoInfo(inputPath: string): Promise<GetVideoInfoResult> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    return {
      ok: false,
      code: 'ffmpeg_missing',
      message: getFfmpegError() ?? 'ffmpeg binary not found',
    };
  }

  // Use ffmpeg to probe the file - it outputs stream info to stderr
  const args = [
    '-hide_banner',
    '-i', inputPath,
    '-f', 'null',
    '-frames:v', '0',
    '-',
  ];

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        ok: false,
        code: 'ffmpeg_failed',
        message: `Failed to spawn ffmpeg: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      // Fail-closed: require successful exit before parsing
      if (code !== 0) {
        resolve({
          ok: false,
          code: 'ffmpeg_failed',
          message: `ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`,
        });
        return;
      }

      // Parse dimensions from stderr - look for pattern like "1920x1080" or "1280x720"
      // Format is usually: "Stream #0:0: Video: h264 ... 1920x1080 ..."
      const dimensionsMatch = stderr.match(/Stream.*Video.*?(\d{2,5})x(\d{2,5})/);

      // Parse duration - format is "Duration: HH:MM:SS.ms" or "Duration: HH:MM:SS"
      const durationMatch = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);

      // Parse fps - format is usually "29.97 fps" or "30 fps" in the Video stream line
      const fpsMatch = stderr.match(/Stream.*Video.*?(\d+(?:\.\d+)?)\s*fps/);

      if (dimensionsMatch && durationMatch) {
        const width = parseInt(dimensionsMatch[1], 10);
        const height = parseInt(dimensionsMatch[2], 10);

        const hours = parseInt(durationMatch[1], 10);
        const minutes = parseInt(durationMatch[2], 10);
        const seconds = parseInt(durationMatch[3], 10);
        const ms = durationMatch[4] ? parseInt(durationMatch[4].padEnd(3, '0').slice(0, 3), 10) : 0;
        const durationSec = hours * 3600 + minutes * 60 + seconds + ms / 1000;

        // fps is optional - null if not found or invalid
        let fps: number | null = null;
        if (fpsMatch) {
          const parsedFps = parseFloat(fpsMatch[1]);
          if (Number.isFinite(parsedFps) && parsedFps > 0) {
            fps = parsedFps;
          }
        }

        if (width > 0 && height > 0 && durationSec > 0) {
          resolve({ ok: true, width, height, durationSec, fps });
          return;
        }
      }

      resolve({
        ok: false,
        code: 'ffmpeg_failed',
        message: `Could not parse video info: ${stderr.slice(0, 500)}`,
      });
    });
  });
}

export interface ExtractFrameOptions {
  inputPath: string;
  timeSec: number;
  outputPath: string;
}

export type ExtractFrameResult =
  | { ok: true }
  | { ok: false; code: 'ffmpeg_missing' | 'ffmpeg_failed'; message: string };

/**
 * Extracts a single frame from a video at the specified time.
 */
export async function extractFrame(options: ExtractFrameOptions): Promise<ExtractFrameResult> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    return {
      ok: false,
      code: 'ffmpeg_missing',
      message: getFfmpegError() ?? 'ffmpeg binary not found',
    };
  }

  const { inputPath, timeSec, outputPath } = options;

  // Validate numeric input (fail-closed: reject NaN, Infinity, negative)
  if (!Number.isFinite(timeSec) || timeSec < 0) {
    return {
      ok: false,
      code: 'ffmpeg_failed',
      message: `Invalid timeSec: ${timeSec} (must be finite and >= 0)`,
    };
  }

  // Build ffmpeg command:
  // -ss before -i for fast input seeking (jumps to nearest keyframe)
  // Trade-off: may be off by up to a GOP (typically 1-2s) but ~100x faster
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', timeSec.toString(),
    '-i', inputPath,
    '-frames:v', '1',
    '-y', // Overwrite output
    outputPath,
  ];

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        ok: false,
        code: 'ffmpeg_failed',
        message: `Failed to spawn ffmpeg: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          code: 'ffmpeg_failed',
          message: `ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`,
        });
      }
    });
  });
}

export interface CompositeOverlayOptions {
  basePath: string;
  overlayPath: string;
  outputPath: string;
}

export type CompositeOverlayResult =
  | { ok: true }
  | { ok: false; code: 'ffmpeg_missing' | 'ffmpeg_failed'; message: string };

/**
 * Composites a PNG overlay on top of a base image.
 */
export async function compositeOverlay(options: CompositeOverlayOptions): Promise<CompositeOverlayResult> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    return {
      ok: false,
      code: 'ffmpeg_missing',
      message: getFfmpegError() ?? 'ffmpeg binary not found',
    };
  }

  const { basePath, overlayPath, outputPath } = options;

  // Build ffmpeg command for overlay compositing:
  // -i <base> -i <overlay> -filter_complex "[0:v][1:v]overlay=0:0" -y <output>
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', basePath,
    '-i', overlayPath,
    '-filter_complex', '[0:v][1:v]overlay=0:0',
    '-y', // Overwrite output
    outputPath,
  ];

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        ok: false,
        code: 'ffmpeg_failed',
        message: `Failed to spawn ffmpeg: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          code: 'ffmpeg_failed',
          message: `ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`,
        });
      }
    });
  });
}

export interface ExtractClipRangeOptions {
  inputPath: string;
  /** Start time of the clip in seconds */
  startSec: number;
  /** End time of the clip in seconds */
  endSec: number;
  /** Total duration of the source video in seconds (for clamping) */
  videoDurationSec: number;
  outputPath: string;
}

export interface ExtractClipOptions {
  inputPath: string;
  /** Center time of the clip in seconds */
  centerTimeSec: number;
  /** Total duration of the source video in seconds (for clamping) */
  videoDurationSec: number;
  /** Desired radius in seconds (clip will be +-radius around center, clamped to video bounds) */
  radiusSec: number;
  outputPath: string;
}

export type ExtractClipResult =
  | {
      ok: true;
      /** Requested start time (actual clip may start earlier due to keyframe alignment) */
      requestedStartSec: number;
      /** Requested end time (actual clip may end later due to keyframe alignment) */
      requestedEndSec: number;
      /** Requested duration (actual clip duration may differ due to keyframe alignment) */
      requestedDurationSec: number;
    }
  | { ok: false; code: 'ffmpeg_missing' | 'ffmpeg_failed'; message: string };

/**
 * Extracts a clip from a video centered around a specific time.
 * The clip is +-radiusSec around centerTimeSec, clamped to video bounds.
 *
 * Uses keyframe seeking + stream copy for fast extraction (~1s vs 30s+ for re-encoding).
 * Trade-off: actual clip boundaries may differ slightly from requested times due to
 * keyframe alignment. For a context clip around a marker, this is acceptable.
 */
export async function extractClip(options: ExtractClipOptions): Promise<ExtractClipResult> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    return {
      ok: false,
      code: 'ffmpeg_missing',
      message: getFfmpegError() ?? 'ffmpeg binary not found',
    };
  }

  const { inputPath, centerTimeSec, videoDurationSec, radiusSec, outputPath } = options;

  // Validate numeric inputs (fail-closed: reject NaN, Infinity, negative where applicable)
  if (!Number.isFinite(centerTimeSec) || centerTimeSec < 0) {
    return {
      ok: false,
      code: 'ffmpeg_failed',
      message: `Invalid centerTimeSec: ${centerTimeSec} (must be finite and >= 0)`,
    };
  }
  if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
    return {
      ok: false,
      code: 'ffmpeg_failed',
      message: `Invalid videoDurationSec: ${videoDurationSec} (must be finite and > 0)`,
    };
  }
  if (!Number.isFinite(radiusSec) || radiusSec <= 0) {
    return {
      ok: false,
      code: 'ffmpeg_failed',
      message: `Invalid radiusSec: ${radiusSec} (must be finite and > 0)`,
    };
  }

  // Calculate start and end times, clamped to video bounds
  const startSec = Math.max(0, centerTimeSec - radiusSec);
  const endSec = Math.min(videoDurationSec, centerTimeSec + radiusSec);
  const durationSec = endSec - startSec;

  if (durationSec <= 0) {
    return {
      ok: false,
      code: 'ffmpeg_failed',
      message: `Invalid clip duration: ${durationSec}s (start=${startSec}, end=${endSec})`,
    };
  }

  // Build ffmpeg command:
  // -ss before -i for fast input seeking (jumps to nearest keyframe)
  // -map 0:v maps video stream (required)
  // -map 0:a? maps audio stream if present (optional - ? prevents error on videos without audio)
  // -c copy for stream copy without re-encoding
  // -avoid_negative_ts fixes timestamp issues with stream copy
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', startSec.toString(),
    '-i', inputPath,
    '-t', durationSec.toString(),
    '-map', '0:v',
    '-map', '0:a?',
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    '-y', // Overwrite output
    outputPath,
  ];

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        ok: false,
        code: 'ffmpeg_failed',
        message: `Failed to spawn ffmpeg: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, requestedStartSec: startSec, requestedEndSec: endSec, requestedDurationSec: durationSec });
      } else {
        resolve({
          ok: false,
          code: 'ffmpeg_failed',
          message: `ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`,
        });
      }
    });
  });
}

/**
 * Extracts a clip from a video with explicit start/end times.
 * Times are clamped to video bounds.
 *
 * Uses keyframe seeking + stream copy for fast extraction.
 */
export async function extractClipRange(options: ExtractClipRangeOptions): Promise<ExtractClipResult> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    return {
      ok: false,
      code: 'ffmpeg_missing',
      message: getFfmpegError() ?? 'ffmpeg binary not found',
    };
  }

  const { inputPath, startSec: rawStartSec, endSec: rawEndSec, videoDurationSec, outputPath } = options;

  // Validate numeric inputs
  if (!Number.isFinite(rawStartSec) || rawStartSec < 0) {
    return {
      ok: false,
      code: 'ffmpeg_failed',
      message: `Invalid startSec: ${rawStartSec} (must be finite and >= 0)`,
    };
  }
  if (!Number.isFinite(rawEndSec) || rawEndSec < 0) {
    return {
      ok: false,
      code: 'ffmpeg_failed',
      message: `Invalid endSec: ${rawEndSec} (must be finite and >= 0)`,
    };
  }
  if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
    return {
      ok: false,
      code: 'ffmpeg_failed',
      message: `Invalid videoDurationSec: ${videoDurationSec} (must be finite and > 0)`,
    };
  }

  // Clamp to video bounds
  const startSec = Math.max(0, rawStartSec);
  const endSec = Math.min(videoDurationSec, rawEndSec);
  const durationSec = endSec - startSec;

  if (durationSec <= 0) {
    return {
      ok: false,
      code: 'ffmpeg_failed',
      message: `Invalid clip duration: ${durationSec}s (start=${startSec}, end=${endSec})`,
    };
  }

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', startSec.toString(),
    '-i', inputPath,
    '-t', durationSec.toString(),
    '-map', '0:v',
    '-map', '0:a?',
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    '-y',
    outputPath,
  ];

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        ok: false,
        code: 'ffmpeg_failed',
        message: `Failed to spawn ffmpeg: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, requestedStartSec: startSec, requestedEndSec: endSec, requestedDurationSec: durationSec });
      } else {
        resolve({
          ok: false,
          code: 'ffmpeg_failed',
          message: `ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`,
        });
      }
    });
  });
}
