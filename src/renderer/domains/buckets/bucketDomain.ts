import { useCallback } from 'react';
import { newId, type Bucket } from '../../../shared/sessionPackage/types';
import type { AppCommonDeps } from '../../app/appDeps';
import type { SessionUiSnapshot } from '../../../shared/ipc/sessionUi';

const EMPTY_BUCKETS: readonly Bucket[] = [];

function createBucket(title: string, sortIndex: number): Bucket {
  return {
    bucketId: newId(),
    title,
    sortIndex,
  };
}

export interface BucketDomainState {
  buckets: readonly Bucket[];
}

export type CreateBucketResult =
  | { ok: true; bucketId: string }
  | { ok: false; message: string };

export interface BucketDomainActions {
  createBucket(title: string): Promise<CreateBucketResult>;
  renameBucket(bucketId: string, title: string): Promise<void>;
  reorderBucket(bucketId: string, newIndex: number): Promise<void>;
  getBucketReferenceCount(
    bucketId: string
  ): Promise<{ ok: true; count: number } | { ok: false; code: string; message: string }>;
  forceRemoveBucket(bucketId: string): Promise<void>;
}

export function useBucketDomain(
  deps: AppCommonDeps & {
    session: SessionUiSnapshot | null;
  }
): { state: BucketDomainState; actions: BucketDomainActions } {
  const buckets = deps.session ? deps.session.outline.buckets : EMPTY_BUCKETS;

  const createBucketAction = useCallback(
    async (title: string): Promise<CreateBucketResult> => {
      if (!deps.session) {
        const message = 'No active session';
        deps.errors.set(message);
        return { ok: false, message };
      }

      try {
        const bucket = createBucket(title, deps.session.outline.buckets.length);
        const ipcResult = await deps.api.session.addBucket(bucket);
        if (!ipcResult.ok) {
          const message = `Failed to add bucket: ${ipcResult.message}`;
          deps.errors.set(message);
          return { ok: false, message };
        }
        deps.persistence.markDirty();
        return { ok: true, bucketId: bucket.bucketId };
      } catch (err) {
        const message = `Failed to add bucket: ${err instanceof Error ? err.message : String(err)}`;
        deps.errors.set(message);
        return { ok: false, message };
      }
    },
    [deps.api.session, deps.errors, deps.persistence, deps.session]
  );

  const renameBucket = useCallback(
    async (bucketId: string, title: string) => {
      if (!deps.session) {
        deps.errors.set('No active session');
        return;
      }

      try {
        const ipcResult = await deps.api.session.updateBucket(bucketId, { title });
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to rename bucket: ${ipcResult.message}`);
          return;
        }
        deps.persistence.markDirty();
      } catch (err) {
        deps.errors.set(`Failed to rename bucket: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [deps.api.session, deps.errors, deps.persistence, deps.session]
  );

  const reorderBucket = useCallback(
    async (bucketId: string, newIndex: number) => {
      if (!deps.session) {
        deps.errors.set('No active session');
        return;
      }

      try {
        const ipcResult = await deps.api.session.reorderBucket(bucketId, newIndex);
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to reorder bucket: ${ipcResult.message}`);
          return;
        }
        deps.persistence.markDirty();
      } catch (err) {
        deps.errors.set(`Failed to reorder bucket: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [deps.api.session, deps.errors, deps.persistence, deps.session]
  );

  const getBucketReferenceCount = useCallback(
    async (
      bucketId: string
    ): Promise<{ ok: true; count: number } | { ok: false; code: string; message: string }> => {
      if (!deps.session) {
        const message = 'No active session';
        deps.errors.set(message);
        return { ok: false as const, code: 'no_active_session', message };
      }

      try {
        const result = await deps.api.session.getBucketReferenceCount(bucketId);
        if (!result.ok) {
          deps.errors.set(`Failed to check bucket references: ${result.message}`);
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.errors.set(`Failed to check bucket references: ${message}`);
        return { ok: false as const, code: 'exception', message };
      }
    },
    [deps.api.session, deps.errors, deps.session]
  );

  const forceRemoveBucket = useCallback(
    async (bucketId: string) => {
      if (!deps.session) {
        deps.errors.set('No active session');
        return;
      }

      try {
        const ipcResult = await deps.api.session.forceRemoveBucket(bucketId);
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to delete bucket: ${ipcResult.message}`);
          return;
        }
        deps.persistence.markDirty();
      } catch (err) {
        deps.errors.set(`Failed to delete bucket: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [deps.api.session, deps.errors, deps.persistence, deps.session]
  );

  return {
    state: {
      buckets,
    },
    actions: {
      createBucket: createBucketAction,
      renameBucket,
      reorderBucket,
      getBucketReferenceCount,
      forceRemoveBucket,
    },
  };
}
