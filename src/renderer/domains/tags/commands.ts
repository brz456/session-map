import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { InputDomain } from '../input/inputDomain';
import type { TagDomainState, TagDomainActions } from './tagDomain';
import type {
  MarkerDomainState,
  MarkerDomainActions,
  MarkerDomainQueries,
} from '../markers/markerDomain';
import type { ModalDomainActions } from '../modals/modalDomain';
import type { FeedbackController } from '../../app/useFeedback';
import { findTagInDirection } from './spatialNavigation';

export function createTagCommands(deps: {
  feedback: FeedbackController;
  input: InputDomain;
  tags: { state: TagDomainState; actions: TagDomainActions };
  markers: {
    state: MarkerDomainState;
    queries: Pick<MarkerDomainQueries, 'selectedMarker'>;
    actions: Pick<MarkerDomainActions, 'updateMarker'>;
  };
  modals: { actions: ModalDomainActions };
}): PartialCommandRegistry {
  const toggleTagOnSelection = (tagId: string): Promise<void> | void => {
    const selectedCount = deps.markers.state.selectedMarkerIds.size;
    if (selectedCount === 0) {
      deps.feedback.show('Select a marker to toggle tag');
      return;
    }
    const selectedMarker = deps.markers.queries.selectedMarker;
    if (!selectedMarker) {
      return;
    }
    const currentTags = selectedMarker.tagIds;
    const nextTags = currentTags.includes(tagId)
      ? currentTags.filter((id) => id !== tagId)
      : [...currentTags, tagId];
    return deps.markers.actions
      .updateMarker(selectedMarker.markerId, { tagIds: nextTags })
      .then(() => undefined);
  };

  return {
    'tags.enterMode': () => {
      deps.input.actions.resetToPlayerMode();
      const tags = deps.tags.state.tags;
      const selectedTagIds = deps.markers.queries.selectedMarker?.tagIds ?? [];
      const firstAssigned = selectedTagIds.find((id) => tags.some((tag) => tag.tagId === id));
      const highlightId = firstAssigned ?? tags[0]?.tagId ?? null;
      deps.input.actions.set({ highlightedTagId: highlightId, sessionMode: 'tags' });
    },
    'tags.highlightPrev': () => {
      const tags = deps.tags.state.tags;
      if (tags.length === 0) return;
      const currentId = deps.input.state.highlightedTagId;
      const currentIndex = currentId ? tags.findIndex((t) => t.tagId === currentId) : -1;
      if (currentIndex <= 0) return;
      deps.input.actions.set({ highlightedTagId: tags[currentIndex - 1].tagId });
    },
    'tags.highlightNext': () => {
      const tags = deps.tags.state.tags;
      if (tags.length === 0) return;
      const currentId = deps.input.state.highlightedTagId;
      const currentIndex = currentId ? tags.findIndex((t) => t.tagId === currentId) : -1;
      if (currentIndex === -1) {
        deps.input.actions.set({ highlightedTagId: tags[0].tagId });
        return;
      }
      if (currentIndex < tags.length - 1) {
        deps.input.actions.set({ highlightedTagId: tags[currentIndex + 1].tagId });
      }
    },
    'tags.highlightUp': () => {
      if (deps.tags.state.tags.length === 0) return;
      const nextTagId = findTagInDirection(deps.input.state.highlightedTagId, 'up');
      if (nextTagId) {
        deps.input.actions.set({ highlightedTagId: nextTagId });
      }
    },
    'tags.highlightDown': () => {
      if (deps.tags.state.tags.length === 0) return;
      const nextTagId = findTagInDirection(deps.input.state.highlightedTagId, 'down');
      if (nextTagId) {
        deps.input.actions.set({ highlightedTagId: nextTagId });
      }
    },
    'tags.activate': async () => {
      const name = deps.input.state.tagDraftName.trim();
      if (name) {
        const result = await deps.tags.actions.createTag(name);
        if (result.ok) {
          const patch: Partial<Parameters<typeof deps.input.actions.set>[0]> = {
            tagDraftName: '',
          };
          if (deps.input.state.sessionMode === 'tags') {
            patch.highlightedTagId = result.tagId;
          }
          deps.input.actions.set(patch);
        }
        return;
      }

      const tagId = deps.input.state.highlightedTagId;
      if (!tagId) return;
      return toggleTagOnSelection(tagId);
    },
    'tags.requestDeleteHighlighted': async () => {
      const tagId = deps.input.state.highlightedTagId;
      if (!tagId) return;

      const refResult = await deps.tags.actions.getTagReferenceCount(tagId);
      if (!refResult.ok) return;

      const tag = deps.tags.state.tags.find((item) => item.tagId === tagId);
      if (!tag) {
        throw new Error(`Tag not found: ${tagId}`);
      }

      if (refResult.count > 0) {
        deps.modals.actions.open('tagDeleteConfirm', {
          type: 'tag',
          id: tagId,
          name: tag.name,
          referenceCount: refResult.count,
        });
        return;
      }

      await deps.tags.actions.forceRemoveTag(tagId);
      if (deps.input.state.sessionMode === 'tags') {
        const remaining = deps.tags.state.tags.filter((item) => item.tagId !== tagId);
        deps.input.actions.set({ highlightedTagId: remaining[0]?.tagId ?? null });
      }
    },
  };
}
