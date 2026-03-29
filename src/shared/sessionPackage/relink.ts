// src/shared/sessionPackage/relink.ts
// Canonical media relink helper (SSoT behavior; used by main + renderer)
// Input path MUST already be canonicalized (fs.realpath) and readable; this helper is pure and does not touch filesystem.

import type { SessionPackage, UUID } from './types';
import { nowIso } from './types';
import { hasSupportedMediaExtension, SUPPORTED_MEDIA_EXTENSIONS } from '../mediaExtensions';

export type RelinkMediaErrorCode = 'media_not_found' | 'duplicate_media_path' | 'invalid_path';

export type RelinkMediaResult =
  | { ok: true; session: SessionPackage }
  | { ok: false; code: RelinkMediaErrorCode; message: string };

/** Preserves mediaId; updates only the target asset path; fails closed on conflicts. */
export function relinkMediaAsset(
  session: SessionPackage,
  mediaId: UUID,
  canonicalAbsolutePath: string
): RelinkMediaResult {
  // Validate path is non-empty and looks like a path
  if (!canonicalAbsolutePath || typeof canonicalAbsolutePath !== 'string') {
    return { ok: false, code: 'invalid_path', message: 'Path must be a non-empty string' };
  }

  // Validate supported extension (case-insensitive on Windows)
  if (!hasSupportedMediaExtension(canonicalAbsolutePath)) {
    return {
      ok: false,
      code: 'invalid_path',
      message: `Path must have extension ${SUPPORTED_MEDIA_EXTENSIONS.join(', ')}`,
    };
  }

  // Find the asset to relink
  const assetIndex = session.media.assets.findIndex((a) => a.mediaId === mediaId);
  if (assetIndex === -1) {
    return { ok: false, code: 'media_not_found', message: `No media asset found with mediaId: ${mediaId}` };
  }

  // Check for duplicate paths (case-insensitive on Windows)
  const normalizedNewPath = canonicalAbsolutePath.toLowerCase();
  for (let i = 0; i < session.media.assets.length; i++) {
    if (i === assetIndex) continue;
    if (session.media.assets[i].absolutePath.toLowerCase() === normalizedNewPath) {
      return {
        ok: false,
        code: 'duplicate_media_path',
        message: `Path already exists for another asset: ${canonicalAbsolutePath}`,
      };
    }
  }

  // Create updated session with relinked asset
  const updatedAssets = session.media.assets.map((asset, i) => {
    if (i === assetIndex) {
      return {
        ...asset,
        absolutePath: canonicalAbsolutePath,
      };
    }
    return asset;
  });

  const updatedSession: SessionPackage = {
    ...session,
    updatedAtIso: nowIso(),
    media: {
      ...session.media,
      assets: updatedAssets,
    },
  };

  return { ok: true, session: updatedSession };
}
