import type { MediaAsset } from '../../../shared/sessionPackage/types';
import type { MediaReferenceCountResult, SessionUpdateResult } from '../../../shared/ipc/types';
import type { SessionStoreMutatorContext } from './types';

function parseMediaCreatedAtMs(asset: MediaAsset): number | null {
  if (typeof asset.createdAtIso !== 'string') {
    return null;
  }
  const timestamp = Date.parse(asset.createdAtIso);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sortMediaAssetsByCreatedAt(assets: readonly MediaAsset[]): MediaAsset[] {
  return assets
    .map((asset, originalIndex) => ({
      asset,
      originalIndex,
      createdAtMs: parseMediaCreatedAtMs(asset),
    }))
    .sort((left, right) => {
      const leftHasDate = left.createdAtMs !== null;
      const rightHasDate = right.createdAtMs !== null;

      if (leftHasDate && rightHasDate && left.createdAtMs !== right.createdAtMs) {
        const leftTimestamp = left.createdAtMs as number;
        const rightTimestamp = right.createdAtMs as number;
        return rightTimestamp - leftTimestamp;
      }
      if (leftHasDate !== rightHasDate) {
        return leftHasDate ? -1 : 1;
      }
      return left.originalIndex - right.originalIndex;
    })
    .map((entry) => entry.asset);
}

export function addMediaAsset(
  ctx: SessionStoreMutatorContext,
  asset: MediaAsset
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated({
    ...currentSession,
    media: {
      ...currentSession.media,
      assets: sortMediaAssetsByCreatedAt([...currentSession.media.assets, asset]),
    },
  });
}

export function removeMediaAsset(
  ctx: SessionStoreMutatorContext,
  mediaId: string
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const removedIndex = currentSession.media.assets.findIndex((a) => a.mediaId === mediaId);
  if (removedIndex === -1) {
    return {
      ok: false,
      code: 'media_not_found',
      message: `Media asset not found: ${mediaId}`,
    };
  }

  const remainingAssets = currentSession.media.assets.filter((asset) => asset.mediaId !== mediaId);
  const nextEvents = currentSession.telemetry.events.filter((event) => event.mediaId !== mediaId);
  const nextMarkers = currentSession.markers.filter((marker) => marker.playbackSnapshot.mediaId !== mediaId);

  const nextPlaybackState = (() => {
    const playbackState = currentSession.playbackState;
    if (playbackState === undefined) {
      return undefined;
    }

    const { [mediaId]: _removed, ...remainingPositions } = playbackState.mediaPositions;
    let nextActiveMediaId = playbackState.activeMediaId;
    if (playbackState.activeMediaId === mediaId) {
      nextActiveMediaId = remainingAssets[Math.min(removedIndex, remainingAssets.length - 1)]?.mediaId ?? null;
    }

    if (
      nextActiveMediaId !== null &&
      !Object.hasOwn(remainingPositions, nextActiveMediaId)
    ) {
      remainingPositions[nextActiveMediaId] = 0;
    }

    return {
      activeMediaId: nextActiveMediaId,
      mediaPositions: remainingPositions,
    };
  })();

  // Build prospective next session and validate via SSoT
  const nextSession = {
    ...currentSession,
    telemetry: {
      ...currentSession.telemetry,
      events: nextEvents,
    },
    markers: nextMarkers,
    media: {
      ...currentSession.media,
      assets: remainingAssets,
    },
    ...(nextPlaybackState !== undefined && { playbackState: nextPlaybackState }),
  };

  return ctx.commitValidated(nextSession);
}

export function getMediaReferenceCount(
  ctx: SessionStoreMutatorContext,
  mediaId: string
): MediaReferenceCountResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const assetExists = currentSession.media.assets.some((asset) => asset.mediaId === mediaId);
  if (!assetExists) {
    return {
      ok: false,
      code: 'media_not_found',
      message: `Media asset not found: ${mediaId}`,
    };
  }

  const markerCount = currentSession.markers.filter(
    (marker) => marker.playbackSnapshot.mediaId === mediaId
  ).length;
  const eventCount = currentSession.telemetry.events.filter((event) => event.mediaId === mediaId).length;

  return { ok: true, markerCount, eventCount };
}
