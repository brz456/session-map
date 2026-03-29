import type { Marker, MarkerDrawing } from '../../../shared/sessionPackage/types';

export type CoursePaneFocusTarget = 'none' | 'bucketDraft' | 'tagDraft' | 'note';

export type MarkerUpdatePatch = Partial<
  Pick<Marker, 'bucketId' | 'tagIds' | 'importance' | 'note'>
> & {
  drawing?: MarkerDrawing | null;
};
