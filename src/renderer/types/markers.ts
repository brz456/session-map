// src/renderer/types/markers.ts
// Shared marker types for renderer components

import type { Marker } from '../../shared/sessionPackage/types';

/** Marker with computed media time for display in lists */
export type MarkerListItem = Pick<Marker, 'markerId' | 'importance' | 'note' | 'groupId'> & {
  mediaTimeSec: number;
};
