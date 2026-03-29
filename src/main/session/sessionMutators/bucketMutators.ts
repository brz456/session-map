import type { Bucket } from '../../../shared/sessionPackage/types';
import type { SessionUpdateResult } from '../../../shared/ipc/types';
import type { SessionStoreMutatorContext } from './types';

export function addBucket(ctx: SessionStoreMutatorContext, bucket: Bucket): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Check for duplicate title (case-insensitive)
  const titleLower = bucket.title.toLowerCase();
  const duplicateExists = currentSession.outline.buckets.some(
    (b) => b.title.toLowerCase() === titleLower
  );
  if (duplicateExists) {
    return {
      ok: false,
      code: 'duplicate_name',
      message: `A bucket with the name "${bucket.title}" already exists`,
    };
  }

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated({
    ...currentSession,
    outline: {
      ...currentSession.outline,
      buckets: [...currentSession.outline.buckets, bucket],
    },
  });
}

export function removeBucket(ctx: SessionStoreMutatorContext, bucketId: string): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Check bucket exists
  const bucketIndex = currentSession.outline.buckets.findIndex((b) => b.bucketId === bucketId);
  if (bucketIndex === -1) {
    return {
      ok: false,
      code: 'bucket_not_found',
      message: `Bucket not found: ${bucketId}`,
    };
  }

  // Check for references in markers
  const markerRef = currentSession.markers.find((m) => m.bucketId === bucketId);
  if (markerRef) {
    return {
      ok: false,
      code: 'bucket_in_use',
      message: `Bucket is referenced by marker: ${markerRef.markerId}`,
    };
  }

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated({
    ...currentSession,
    outline: {
      ...currentSession.outline,
      buckets: currentSession.outline.buckets.filter((b) => b.bucketId !== bucketId),
    },
  });
}

export function reorderBucket(
  ctx: SessionStoreMutatorContext,
  bucketId: string,
  newIndex: number
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const buckets = currentSession.outline.buckets;
  const currentIndex = buckets.findIndex((b) => b.bucketId === bucketId);
  if (currentIndex === -1) {
    return {
      ok: false,
      code: 'bucket_not_found',
      message: `Bucket not found: ${bucketId}`,
    };
  }

  // Clamp newIndex to valid range
  const clampedIndex = Math.max(0, Math.min(newIndex, buckets.length - 1));
  if (currentIndex === clampedIndex) {
    return { ok: true };
  }

  const reorderedBuckets = [...buckets];
  const [removed] = reorderedBuckets.splice(currentIndex, 1);
  reorderedBuckets.splice(clampedIndex, 0, removed);

  // Update sortIndex for all buckets to match array position
  const updatedBuckets = reorderedBuckets.map((b, i) => ({ ...b, sortIndex: i }));

  return ctx.commitValidated({
    ...currentSession,
    outline: {
      ...currentSession.outline,
      buckets: updatedBuckets,
    },
  });
}

export function updateBucket(
  ctx: SessionStoreMutatorContext,
  bucketId: string,
  patch: Partial<Pick<Bucket, 'title' | 'description' | 'sortIndex'>>
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const bucket = currentSession.outline.buckets.find((b) => b.bucketId === bucketId);
  if (!bucket) {
    return {
      ok: false,
      code: 'bucket_not_found',
      message: `Bucket not found: ${bucketId}`,
    };
  }

  // Check for duplicate title (case-insensitive)
  if (patch.title !== undefined) {
    const titleLower = patch.title.toLowerCase();
    const duplicateExists = currentSession.outline.buckets.some(
      (b) => b.bucketId !== bucketId && b.title.toLowerCase() === titleLower
    );
    if (duplicateExists) {
      return {
        ok: false,
        code: 'duplicate_name',
        message: `A bucket with the name "${patch.title}" already exists`,
      };
    }
  }

  const updatedBucket: Bucket = {
    ...bucket,
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.sortIndex !== undefined && { sortIndex: patch.sortIndex }),
  };

  return ctx.commitValidated({
    ...currentSession,
    outline: {
      ...currentSession.outline,
      buckets: currentSession.outline.buckets.map((b) => (b.bucketId === bucketId ? updatedBucket : b)),
    },
  });
}

export function getBucketReferenceCount(
  ctx: SessionStoreMutatorContext,
  bucketId: string
): { ok: true; count: number } | { ok: false; code: string; message: string } {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const count = currentSession.markers.filter((m) => m.bucketId === bucketId).length;

  return { ok: true, count };
}

export function forceRemoveBucket(
  ctx: SessionStoreMutatorContext,
  bucketId: string
): SessionUpdateResult & { affectedMarkers?: number } {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const bucketExists = currentSession.outline.buckets.some((b) => b.bucketId === bucketId);
  if (!bucketExists) {
    return {
      ok: false,
      code: 'bucket_not_found',
      message: `Bucket not found: ${bucketId}`,
    };
  }

  // Remove bucket and clear any references in markers
  const filteredBuckets = currentSession.outline.buckets.filter((b) => b.bucketId !== bucketId);
  const affectedMarkers = currentSession.markers.filter((m) => m.bucketId === bucketId).length;

  const result = ctx.commitValidated({
    ...currentSession,
    markers: currentSession.markers.map((m) =>
      m.bucketId === bucketId
        ? { ...m, bucketId: null }
        : m
    ),
    outline: {
      ...currentSession.outline,
      buckets: filteredBuckets,
    },
  });

  if (result.ok) {
    return { ...result, affectedMarkers };
  }
  return result;
}
