import type { Marker } from '../../../shared/sessionPackage/types';

export type MarkerKind = Marker['sourceType'];

export interface MarkerPresentation {
  kind: MarkerKind;
  getLabel(marker: Marker): string;
  getSortValue(marker: Marker): number;
}

const requireMediaTimeSec = (marker: Marker): number => {
  const timeSec = marker.playbackSnapshot.mediaTimeSec;
  if (timeSec === null || !Number.isFinite(timeSec)) {
    throw new Error(`Invalid marker mediaTimeSec for sort: ${marker.markerId}`);
  }
  return timeSec;
};

const baseLabel = (kind: MarkerKind): string => {
  switch (kind) {
    case 'video':
      return 'Video';
    case 'browser':
      return 'Browser';
    case 'whiteboard':
      return 'Whiteboard';
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled marker kind: ${_exhaustive}`);
    }
  }
};

export const markerPresentationRegistry: Record<MarkerKind, MarkerPresentation> = {
  video: {
    kind: 'video',
    getLabel: () => baseLabel('video'),
    getSortValue: (marker) => requireMediaTimeSec(marker),
  },
  browser: {
    kind: 'browser',
    getLabel: () => baseLabel('browser'),
    getSortValue: (marker) => requireMediaTimeSec(marker),
  },
  whiteboard: {
    kind: 'whiteboard',
    getLabel: () => baseLabel('whiteboard'),
    getSortValue: (marker) => requireMediaTimeSec(marker),
  },
};

export function getMarkerKind(marker: Marker): MarkerKind {
  return marker.sourceType;
}
