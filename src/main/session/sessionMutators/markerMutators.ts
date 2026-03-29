import type { Marker } from '../../../shared/sessionPackage/types';
import type { SessionUpdateResult } from '../../../shared/ipc/types';
import type { SessionStoreMutatorContext } from './types';

export function addMarker(ctx: SessionStoreMutatorContext, marker: Marker): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  return ctx.commitValidated({
    ...currentSession,
    markers: [...currentSession.markers, marker],
  });
}

export function removeMarker(
  ctx: SessionStoreMutatorContext,
  markerId: string
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const exists = currentSession.markers.some((m) => m.markerId === markerId);
  if (!exists) {
    return {
      ok: false,
      code: 'marker_not_found',
      message: `Marker not found: ${markerId}`,
    };
  }

  return ctx.commitValidated({
    ...currentSession,
    markers: currentSession.markers.filter((m) => m.markerId !== markerId),
  });
}

export function updateMarker(
  ctx: SessionStoreMutatorContext,
  markerId: string,
  patch: Partial<Pick<Marker, 'bucketId' | 'tagIds' | 'importance' | 'note'>> & {
    drawing?: Marker['drawing'] | null;
    mediaTimeSec?: number;
    groupId?: string | null;
  }
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const marker = currentSession.markers.find((m) => m.markerId === markerId);
  if (!marker) {
    return {
      ok: false,
      code: 'marker_not_found',
      message: `Marker not found: ${markerId}`,
    };
  }

  // Validate referential integrity before building next session (fail-closed)
  if (patch.bucketId !== undefined && patch.bucketId !== null) {
    const bucketExists = currentSession.outline.buckets.some((b) => b.bucketId === patch.bucketId);
    if (!bucketExists) {
      return {
        ok: false,
        code: 'invalid_input',
        message: `Bucket not found: ${patch.bucketId}`,
      };
    }
  }
  if (patch.tagIds !== undefined) {
    const validTagIds = new Set(currentSession.taxonomy.tags.map((t) => t.tagId));
    const invalidTagIds = patch.tagIds.filter((id) => !validTagIds.has(id));
    if (invalidTagIds.length > 0) {
      return {
        ok: false,
        code: 'invalid_input',
        message: `Tags not found: ${invalidTagIds.join(', ')}`,
      };
    }
  }

  // Build updated marker (only patch defined fields)
  const updatedMarker: Marker = {
    ...marker,
    ...(patch.bucketId !== undefined && { bucketId: patch.bucketId }),
    ...(patch.tagIds !== undefined && { tagIds: patch.tagIds }),
    ...(patch.importance !== undefined && { importance: patch.importance }),
    ...(patch.note !== undefined && { note: patch.note === '' ? undefined : patch.note }),
  };

  // Handle drawing field separately: null removes, undefined ignores, value sets
  if (patch.drawing !== undefined) {
    if (patch.drawing === null) {
      delete updatedMarker.drawing;
    } else {
      updatedMarker.drawing = patch.drawing;
    }
  }

  // Handle groupId: null removes, undefined ignores, string sets
  if (patch.groupId !== undefined) {
    if (patch.groupId === null) {
      delete updatedMarker.groupId;
    } else {
      updatedMarker.groupId = patch.groupId;
    }
  }

  // Handle mediaTimeSec: update playbackSnapshot.mediaTimeSec for marker movement
  if (patch.mediaTimeSec !== undefined) {
    if (marker.playbackSnapshot.mediaId === null) {
      return {
        ok: false,
        code: 'invalid_input',
        message: 'Cannot move marker without media',
      };
    }
    updatedMarker.playbackSnapshot = {
      ...marker.playbackSnapshot,
      mediaTimeSec: patch.mediaTimeSec,
    };
  }

  return ctx.commitValidated({
    ...currentSession,
    markers: currentSession.markers.map((m) => (m.markerId === markerId ? updatedMarker : m)),
  });
}
