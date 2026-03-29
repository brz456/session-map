import type { SessionUiSnapshot } from '../../../shared/ipc/sessionUi';
import type { UUID } from '../../../shared/sessionPackage/types';
import type { MarkerListItem } from '../../types/markers';

export function selectActiveMediaMarkersByTime(
  session: SessionUiSnapshot,
  activeMediaId: UUID
): MarkerListItem[] {
  return session.markers
    .filter(
      (marker) =>
        marker.playbackSnapshot.mediaId === activeMediaId &&
        marker.playbackSnapshot.mediaTimeSec !== null
    )
    .map((marker) => ({
      markerId: marker.markerId,
      mediaTimeSec: marker.playbackSnapshot.mediaTimeSec!,
      importance: marker.importance,
      note: marker.note,
      groupId: marker.groupId,
    }))
    .sort((a, b) => {
      if (a.mediaTimeSec !== b.mediaTimeSec) {
        return a.mediaTimeSec - b.mediaTimeSec;
      }
      return a.markerId < b.markerId ? -1 : a.markerId > b.markerId ? 1 : 0;
    });
}

export function selectActiveMediaMarkersVisualOrder(
  byTime: readonly MarkerListItem[]
): MarkerListItem[] {
  const grouped = new Map<string, MarkerListItem[]>();
  const groupEarliestTime = new Map<string, number>();
  const ungrouped: MarkerListItem[] = [];

  for (const marker of byTime) {
    if (marker.groupId) {
      const groupId = marker.groupId;
      const group = grouped.get(groupId);
      if (group) {
        group.push(marker);
      } else {
        grouped.set(groupId, [marker]);
        groupEarliestTime.set(groupId, marker.mediaTimeSec);
      }
    } else {
      ungrouped.push(marker);
    }
  }

  const sortedGroups = [...grouped.entries()].sort(([groupA], [groupB]) => {
    const timeA = groupEarliestTime.get(groupA);
    const timeB = groupEarliestTime.get(groupB);
    if (timeA === undefined || timeB === undefined) {
      throw new Error('Invariant violated: missing group earliest time');
    }
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return groupA < groupB ? -1 : groupA > groupB ? 1 : 0;
  });

  const result: MarkerListItem[] = [];
  for (const [, markers] of sortedGroups) {
    result.push(...markers);
  }
  result.push(...ungrouped);

  return result;
}
