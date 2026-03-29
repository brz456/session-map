import type { Tag } from '../../../shared/sessionPackage/types';
import type { SessionUpdateResult } from '../../../shared/ipc/types';
import type { SessionStoreMutatorContext } from './types';

export function addTag(ctx: SessionStoreMutatorContext, tag: Tag): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Check for duplicate name (case-insensitive)
  const nameLower = tag.name.toLowerCase();
  const duplicateExists = currentSession.taxonomy.tags.some(
    (t) => t.name.toLowerCase() === nameLower
  );
  if (duplicateExists) {
    return {
      ok: false,
      code: 'duplicate_name',
      message: `A tag with the name "${tag.name}" already exists`,
    };
  }

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated({
    ...currentSession,
    taxonomy: {
      ...currentSession.taxonomy,
      tags: [...currentSession.taxonomy.tags, tag],
    },
  });
}

export function removeTag(ctx: SessionStoreMutatorContext, tagId: string): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  // Check tag exists
  const tagIndex = currentSession.taxonomy.tags.findIndex((t) => t.tagId === tagId);
  if (tagIndex === -1) {
    return {
      ok: false,
      code: 'tag_not_found',
      message: `Tag not found: ${tagId}`,
    };
  }

  // Check for references in markers
  const markerRef = currentSession.markers.find((m) => m.tagIds.includes(tagId));
  if (markerRef) {
    return {
      ok: false,
      code: 'tag_in_use',
      message: `Tag is referenced by marker: ${markerRef.markerId}`,
    };
  }

  // Build prospective next session and validate via SSoT
  return ctx.commitValidated({
    ...currentSession,
    taxonomy: {
      ...currentSession.taxonomy,
      tags: currentSession.taxonomy.tags.filter((t) => t.tagId !== tagId),
    },
  });
}

export function updateTag(
  ctx: SessionStoreMutatorContext,
  tagId: string,
  patch: Partial<Pick<Tag, 'name' | 'color'>>
): SessionUpdateResult {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const tag = currentSession.taxonomy.tags.find((t) => t.tagId === tagId);
  if (!tag) {
    return {
      ok: false,
      code: 'tag_not_found',
      message: `Tag not found: ${tagId}`,
    };
  }

  // Check for duplicate name when renaming (case-insensitive, exclude self)
  if (patch.name !== undefined) {
    const nameLower = patch.name.toLowerCase();
    const duplicateExists = currentSession.taxonomy.tags.some(
      (t) => t.tagId !== tagId && t.name.toLowerCase() === nameLower
    );
    if (duplicateExists) {
      return {
        ok: false,
        code: 'duplicate_name',
        message: `A tag with the name "${patch.name}" already exists`,
      };
    }
  }

  const updatedTag: Tag = {
    ...tag,
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.color !== undefined && { color: patch.color }),
  };

  return ctx.commitValidated({
    ...currentSession,
    taxonomy: {
      ...currentSession.taxonomy,
      tags: currentSession.taxonomy.tags.map((t) => (t.tagId === tagId ? updatedTag : t)),
    },
  });
}

export function getTagReferenceCount(
  ctx: SessionStoreMutatorContext,
  tagId: string
): { ok: true; count: number } | { ok: false; code: string; message: string } {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const count = currentSession.markers.filter((m) => m.tagIds.includes(tagId)).length;

  return { ok: true, count };
}

export function forceRemoveTag(
  ctx: SessionStoreMutatorContext,
  tagId: string
): SessionUpdateResult & { affectedMarkers?: number } {
  const currentSession = ctx.getCurrentSession();
  if (currentSession === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const tagExists = currentSession.taxonomy.tags.some((t) => t.tagId === tagId);
  if (!tagExists) {
    return {
      ok: false,
      code: 'tag_not_found',
      message: `Tag not found: ${tagId}`,
    };
  }

  // Count affected markers
  const affectedMarkers = currentSession.markers.filter((m) => m.tagIds.includes(tagId)).length;

  const result = ctx.commitValidated({
    ...currentSession,
    markers: currentSession.markers.map((m) =>
      m.tagIds.includes(tagId)
        ? { ...m, tagIds: m.tagIds.filter((id) => id !== tagId) }
        : m
    ),
    taxonomy: {
      ...currentSession.taxonomy,
      tags: currentSession.taxonomy.tags.filter((t) => t.tagId !== tagId),
    },
  });

  if (result.ok) {
    return { ...result, affectedMarkers };
  }
  return result;
}
