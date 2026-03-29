// src/main/ipc/media/mediaIpc.ts
// IPC handlers for media asset operations
//
// Canonical filesystem-level validation/canonicalization via fs.stat/fs.realpath.
// Session IPC (session/registerSessionIpc.ts) still validates payload shape defensively at its boundary.
//
// To add media to a session:
// 1. Call media:add-asset to get a validated/canonicalized MediaAsset
// 2. Call session:add-media-asset to append it to the active session

import { ipcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { MediaAsset, newId } from "../../../shared/sessionPackage/types";
import { MEDIA_IPC_CHANNELS } from "../../../shared/ipc/channels";
import type {
  MediaErrorCode,
  MediaAddAssetResult,
  MediaGetMetadataResult,
  MediaGetVideoInfoResult,
} from "../../../shared/ipc/types";
import { getVideoInfo } from "../../export/ffmpeg";
import { isSupportedMediaExtension, SUPPORTED_MEDIA_EXTENSIONS } from "../../../shared/mediaExtensions";

const SUPPORTED_EXTENSION_LABEL = SUPPORTED_MEDIA_EXTENSIONS.join(", ");

function extractCreatedAtIso(fileStat: {
  birthtimeMs: number;
}):
  | { ok: true; createdAtIso: string }
  | { ok: false; code: "metadata_read_failed"; message: string } {
  if (!Number.isFinite(fileStat.birthtimeMs) || fileStat.birthtimeMs <= 0) {
    return {
      ok: false,
      code: "metadata_read_failed",
      message: `Invalid file birthtimeMs: ${fileStat.birthtimeMs}`,
    };
  }
  return { ok: true, createdAtIso: new Date(fileStat.birthtimeMs).toISOString() };
}

/**
 * Validates that a file path points to a supported media file and returns canonicalized info.
 * Resolves symlinks and returns the canonical path plus canonical file stat.
 */
async function validateMediaFile(
  absolutePath: string,
): Promise<
  | { ok: true; canonicalPath: string; canonicalStat: { isFile(): boolean; birthtimeMs: number } }
  | { ok: false; code: MediaErrorCode; message: string }
> {
  if (!absolutePath || typeof absolutePath !== "string") {
    return {
      ok: false,
      code: "invalid_path",
      message: "absolutePath must be a non-empty string",
    };
  }

  // Must be absolute path
  if (!path.isAbsolute(absolutePath)) {
    return {
      ok: false,
      code: "invalid_path",
      message: `Path must be absolute: ${absolutePath}`,
    };
  }

  const ext = path.extname(absolutePath).toLowerCase();
  if (!isSupportedMediaExtension(ext)) {
    return {
      ok: false,
      code: "invalid_extension",
      message: `Unsupported file extension: ${ext}. Only ${SUPPORTED_EXTENSION_LABEL} is supported.`,
    };
  }

  // Canonicalize path (resolve symlinks) for consistent behavior
  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(absolutePath);
  } catch (err) {
    const errCode = (err as NodeJS.ErrnoException).code;
    if (errCode === "ENOENT" || errCode === "ENOTDIR") {
      return {
        ok: false,
        code: "file_not_found",
        message: `Failed to access file: ${absolutePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    return {
      ok: false,
      code: "canonicalize_failed",
      message: `Failed to canonicalize path: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  let canonicalStat: { isFile(): boolean; birthtimeMs: number };
  try {
    canonicalStat = await fs.stat(canonicalPath);
  } catch (err) {
    return {
      ok: false,
      code: "file_not_found",
      message: `Failed to access canonical file: ${canonicalPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!canonicalStat.isFile()) {
    return {
      ok: false,
      code: "file_not_found",
      message: `Path is not a file: ${canonicalPath}`,
    };
  }

  // Re-validate extension on canonical path (symlink could point to unsupported extension)
  const canonicalExt = path.extname(canonicalPath).toLowerCase();
  if (!isSupportedMediaExtension(canonicalExt)) {
    return {
      ok: false,
      code: "invalid_extension",
      message: `Canonical path has unsupported extension: ${canonicalExt}. Only ${SUPPORTED_EXTENSION_LABEL} is supported.`,
    };
  }

  return { ok: true, canonicalPath, canonicalStat };
}

/**
 * Registers all media-related IPC handlers.
 * Must be called once during app startup.
 */
export function registerMediaIpcHandlers(): void {
  ipcMain.handle(
    MEDIA_IPC_CHANNELS.addAsset,
    async (
      _event,
      absolutePath: string,
      displayName?: string,
    ): Promise<MediaAddAssetResult> => {
      // Validate displayName at IPC boundary
      if (displayName !== undefined) {
        if (typeof displayName !== "string") {
          return {
            ok: false,
            code: "invalid_display_name",
            message: "displayName must be a string or undefined",
          };
        }
        if (displayName.trim() === "") {
          return {
            ok: false,
            code: "invalid_display_name",
            message: "displayName must not be empty or whitespace-only",
          };
        }
      }

      const validation = await validateMediaFile(absolutePath);
      if (!validation.ok) {
        return validation;
      }
      const createdAtResult = extractCreatedAtIso(validation.canonicalStat);
      if (!createdAtResult.ok) {
        return createdAtResult;
      }

      // Fetch video info - fail if unavailable (no silent fallbacks)
      const videoInfo = await getVideoInfo(validation.canonicalPath);
      if (!videoInfo.ok) {
        return {
          ok: false,
          code: videoInfo.code,
          message: `Failed to read video info: ${videoInfo.message}`,
        };
      }

      const asset: MediaAsset = {
        mediaId: newId(),
        displayName: displayName ?? path.basename(validation.canonicalPath),
        absolutePath: validation.canonicalPath,
        createdAtIso: createdAtResult.createdAtIso,
        durationSec: videoInfo.durationSec,
        ...(videoInfo.fps !== null && { fps: videoInfo.fps }),
      };

      return { ok: true, asset };
    },
  );

  ipcMain.handle(
    MEDIA_IPC_CHANNELS.getMetadata,
    async (_event, absolutePath: string): Promise<MediaGetMetadataResult> => {
      const validation = await validateMediaFile(absolutePath);
      if (!validation.ok) {
        return validation;
      }

      // Duration extraction via ffprobe is deferred to future implementation.
      // For now, return null duration and empty metadata.
      return {
        ok: true,
        durationSec: null,
        metadata: {},
      };
    },
  );

  ipcMain.handle(
    MEDIA_IPC_CHANNELS.getVideoInfo,
    async (_event, absolutePath: string): Promise<MediaGetVideoInfoResult> => {
      const validation = await validateMediaFile(absolutePath);
      if (!validation.ok) {
        return validation;
      }

      return getVideoInfo(validation.canonicalPath);
    },
  );
}

/**
 * Unregisters all media IPC handlers.
 */
export function unregisterMediaIpcHandlers(): void {
  ipcMain.removeHandler(MEDIA_IPC_CHANNELS.addAsset);
  ipcMain.removeHandler(MEDIA_IPC_CHANNELS.getMetadata);
  ipcMain.removeHandler(MEDIA_IPC_CHANNELS.getVideoInfo);
}
