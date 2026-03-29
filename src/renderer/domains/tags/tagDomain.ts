import { useCallback } from 'react';
import { newId, type Tag } from '../../../shared/sessionPackage/types';
import type { AppCommonDeps } from '../../app/appDeps';
import type { SessionUiSnapshot } from '../../../shared/ipc/sessionUi';

const EMPTY_TAGS: readonly Tag[] = [];

function createTag(name: string): Tag {
  return {
    tagId: newId(),
    name,
  };
}

export interface TagDomainState {
  tags: readonly Tag[];
}

export type CreateTagResult =
  | { ok: true; tagId: string }
  | { ok: false; message: string };

export interface TagDomainActions {
  createTag(name: string): Promise<CreateTagResult>;
  renameTag(tagId: string, name: string): Promise<void>;
  getTagReferenceCount(
    tagId: string
  ): Promise<{ ok: true; count: number } | { ok: false; code: string; message: string }>;
  forceRemoveTag(tagId: string): Promise<void>;
}

export function useTagDomain(
  deps: AppCommonDeps & {
    session: SessionUiSnapshot | null;
  }
): { state: TagDomainState; actions: TagDomainActions } {
  const tags = deps.session ? deps.session.taxonomy.tags : EMPTY_TAGS;

  const createTagAction = useCallback(
    async (name: string): Promise<CreateTagResult> => {
      if (!deps.session) {
        const message = 'No active session';
        deps.errors.set(message);
        return { ok: false, message };
      }

      try {
        const tag = createTag(name);
        const ipcResult = await deps.api.session.addTag(tag);
        if (!ipcResult.ok) {
          const message = `Failed to add tag: ${ipcResult.message}`;
          deps.errors.set(message);
          return { ok: false, message };
        }
        deps.persistence.markDirty();
        return { ok: true, tagId: tag.tagId };
      } catch (err) {
        const message = `Failed to add tag: ${err instanceof Error ? err.message : String(err)}`;
        deps.errors.set(message);
        return { ok: false, message };
      }
    },
    [deps.api.session, deps.errors, deps.persistence, deps.session]
  );

  const renameTag = useCallback(
    async (tagId: string, name: string) => {
      if (!deps.session) {
        deps.errors.set('No active session');
        return;
      }

      try {
        const ipcResult = await deps.api.session.updateTag(tagId, { name });
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to rename tag: ${ipcResult.message}`);
          return;
        }
        deps.persistence.markDirty();
      } catch (err) {
        deps.errors.set(`Failed to rename tag: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [deps.api.session, deps.errors, deps.persistence, deps.session]
  );

  const getTagReferenceCount = useCallback(
    async (
      tagId: string
    ): Promise<{ ok: true; count: number } | { ok: false; code: string; message: string }> => {
      if (!deps.session) {
        const message = 'No active session';
        deps.errors.set(message);
        return { ok: false as const, code: 'no_active_session', message };
      }

      try {
        const result = await deps.api.session.getTagReferenceCount(tagId);
        if (!result.ok) {
          deps.errors.set(`Failed to check tag references: ${result.message}`);
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.errors.set(`Failed to check tag references: ${message}`);
        return { ok: false as const, code: 'exception', message };
      }
    },
    [deps.api.session, deps.errors, deps.session]
  );

  const forceRemoveTag = useCallback(
    async (tagId: string) => {
      if (!deps.session) {
        deps.errors.set('No active session');
        return;
      }

      try {
        const ipcResult = await deps.api.session.forceRemoveTag(tagId);
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to delete tag: ${ipcResult.message}`);
          return;
        }
        deps.persistence.markDirty();
      } catch (err) {
        deps.errors.set(`Failed to delete tag: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [deps.api.session, deps.errors, deps.persistence, deps.session]
  );

  return {
    state: {
      tags,
    },
    actions: {
      createTag: createTagAction,
      renameTag,
      getTagReferenceCount,
      forceRemoveTag,
    },
  };
}
