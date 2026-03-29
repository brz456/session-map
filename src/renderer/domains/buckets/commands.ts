import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { InputDomain } from '../input/inputDomain';
import type { BucketDomainState, BucketDomainActions } from './bucketDomain';
import type {
  MarkerDomainState,
  MarkerDomainActions,
  MarkerDomainQueries,
} from '../markers/markerDomain';
import type { ModalDomainActions } from '../modals/modalDomain';
import type { FeedbackController } from '../../app/useFeedback';

export function createBucketCommands(deps: {
  feedback: FeedbackController;
  input: InputDomain;
  buckets: { state: BucketDomainState; actions: BucketDomainActions };
  markers: {
    state: MarkerDomainState;
    queries: Pick<MarkerDomainQueries, 'selectedMarker'>;
    actions: Pick<MarkerDomainActions, 'updateMarker'>;
  };
  modals: { actions: ModalDomainActions };
}): PartialCommandRegistry {
  const assignBucketToSelection = (bucketId: string): Promise<void> | void => {
    const selectedCount = deps.markers.state.selectedMarkerIds.size;
    if (selectedCount === 0) {
      deps.feedback.show('Select a marker to assign bucket');
      return;
    }
    const selectedMarker = deps.markers.queries.selectedMarker;
    if (!selectedMarker) {
      return;
    }
    const nextBucketId = selectedMarker.bucketId === bucketId ? null : bucketId;
    return deps.markers.actions
      .updateMarker(selectedMarker.markerId, { bucketId: nextBucketId })
      .then(() => undefined);
  };

  const highlightBucketByIndex = (index: number): string | null => {
    const buckets = deps.buckets.state.buckets;
    if (index < 0 || index >= buckets.length) return null;
    const bucketId = buckets[index].bucketId;
    deps.input.actions.set({ highlightedBucketId: bucketId });
    return bucketId;
  };

  return {
    'buckets.enterMode': () => {
      deps.input.actions.resetToPlayerMode();
      const buckets = deps.buckets.state.buckets;
      const selectedBucketId = deps.markers.queries.selectedMarker?.bucketId ?? null;
      const highlightId =
        selectedBucketId && buckets.some((bucket) => bucket.bucketId === selectedBucketId)
          ? selectedBucketId
          : buckets[0]?.bucketId ?? null;
      deps.input.actions.set({ highlightedBucketId: highlightId, sessionMode: 'buckets' });
    },
    'buckets.highlightPrev': () => {
      const buckets = deps.buckets.state.buckets;
      if (buckets.length === 0) return;
      const currentId = deps.input.state.highlightedBucketId;
      const currentIndex = currentId ? buckets.findIndex((b) => b.bucketId === currentId) : -1;
      if (currentIndex <= 0) return;
      deps.input.actions.set({ highlightedBucketId: buckets[currentIndex - 1].bucketId });
    },
    'buckets.highlightNext': () => {
      const buckets = deps.buckets.state.buckets;
      if (buckets.length === 0) return;
      const currentId = deps.input.state.highlightedBucketId;
      const currentIndex = currentId ? buckets.findIndex((b) => b.bucketId === currentId) : -1;
      if (currentIndex === -1) {
        deps.input.actions.set({ highlightedBucketId: buckets[0].bucketId });
        return;
      }
      if (currentIndex < buckets.length - 1) {
        deps.input.actions.set({ highlightedBucketId: buckets[currentIndex + 1].bucketId });
      }
    },
    'buckets.quickSelect1': () => {
      const bucketId = highlightBucketByIndex(0);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.quickSelect2': () => {
      const bucketId = highlightBucketByIndex(1);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.quickSelect3': () => {
      const bucketId = highlightBucketByIndex(2);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.quickSelect4': () => {
      const bucketId = highlightBucketByIndex(3);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.quickSelect5': () => {
      const bucketId = highlightBucketByIndex(4);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.quickSelect6': () => {
      const bucketId = highlightBucketByIndex(5);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.quickSelect7': () => {
      const bucketId = highlightBucketByIndex(6);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.quickSelect8': () => {
      const bucketId = highlightBucketByIndex(7);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.quickSelect9': () => {
      const bucketId = highlightBucketByIndex(8);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.quickSelect10': () => {
      const bucketId = highlightBucketByIndex(9);
      if (bucketId) {
        return assignBucketToSelection(bucketId);
      }
    },
    'buckets.activate': async () => {
      const title = deps.input.state.bucketDraftTitle.trim();
      if (title) {
        const result = await deps.buckets.actions.createBucket(title);
        if (result.ok) {
          const patch: Partial<Parameters<typeof deps.input.actions.set>[0]> = {
            bucketDraftTitle: '',
          };
          if (deps.input.state.sessionMode === 'buckets') {
            patch.highlightedBucketId = result.bucketId;
          }
          deps.input.actions.set(patch);
        }
        return;
      }
      const bucketId = deps.input.state.highlightedBucketId;
      if (!bucketId) return;
      return assignBucketToSelection(bucketId);
    },
    'buckets.requestDeleteHighlighted': async () => {
      const bucketId = deps.input.state.highlightedBucketId;
      if (!bucketId) return;

      const refResult = await deps.buckets.actions.getBucketReferenceCount(bucketId);
      if (!refResult.ok) return;

      const bucket = deps.buckets.state.buckets.find((item) => item.bucketId === bucketId);
      if (!bucket) {
        throw new Error(`Bucket not found: ${bucketId}`);
      }

      if (refResult.count > 0) {
        deps.modals.actions.open('bucketDeleteConfirm', {
          type: 'bucket',
          id: bucketId,
          name: bucket.title,
          referenceCount: refResult.count,
        });
        return;
      }

      await deps.buckets.actions.forceRemoveBucket(bucketId);
      if (deps.input.state.sessionMode === 'buckets') {
        const remaining = deps.buckets.state.buckets.filter((item) => item.bucketId !== bucketId);
        deps.input.actions.set({ highlightedBucketId: remaining[0]?.bucketId ?? null });
      }
    },
  };
}
