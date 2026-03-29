import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { Marker } from '../../../shared/sessionPackage/types';
import { formatTime, getImportanceColor } from '../../utils/format';
import type { MarkerListItem } from '../../types/markers';

interface MarkerListProps {
  markers: readonly MarkerListItem[];
  selectedMarkerIds: ReadonlySet<string>;
  selectedMarker: Marker | null;
  highlightedMarkerId: string | null;
  markerListAnchorId: string | null;
  editingDisabled: boolean;
  onMarkerClick(markerId: string, timeSec: number, event?: ReactMouseEvent): void;
  onMarkerContextMenu(e: ReactMouseEvent, markerId: string): void;
  onGroupMarkers(markerIds: string[]): void;
  onUngroupMarkers(markerIds: string[]): void;
}

export function MarkerList(props: MarkerListProps): JSX.Element {
  const {
    markers,
    selectedMarkerIds,
    selectedMarker,
    highlightedMarkerId,
    markerListAnchorId,
    editingDisabled,
    onMarkerClick,
    onMarkerContextMenu,
    onGroupMarkers,
    onUngroupMarkers,
  } = props;

  const markersListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!selectedMarker || !markersListRef.current) return;
    const listEl = markersListRef.current;
    const markerEl = Array.from(listEl.children).find(
      (el) => el instanceof HTMLElement && el.dataset.markerId === selectedMarker.markerId
    );
    if (markerEl) {
      markerEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [markers, selectedMarker?.markerId]);

  useEffect(() => {
    if (!highlightedMarkerId || !markersListRef.current) return;
    const listEl = markersListRef.current;
    const markerEl = Array.from(listEl.children).find(
      (el) => el instanceof HTMLElement && el.dataset.markerId === highlightedMarkerId
    );
    if (markerEl) {
      markerEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [highlightedMarkerId]);

  const hasMultipleSelected = selectedMarkerIds.size > 1;
  const hasAnySelected = selectedMarkerIds.size > 0;
  const selectedIdsSorted = [...selectedMarkerIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const markerIndexById = useMemo(() => {
    const map = new Map<string, number>();
    markers.forEach((marker, index) => {
      map.set(marker.markerId, index);
    });
    return map;
  }, [markers]);

  const highlightRange = useMemo(() => {
    if (!highlightedMarkerId) return null;
    const currentIndex = markerIndexById.get(highlightedMarkerId);
    if (currentIndex === undefined) return null;
    if (!markerListAnchorId) {
      return { startIndex: currentIndex, endIndex: currentIndex };
    }
    const anchorIndex = markerIndexById.get(markerListAnchorId);
    if (anchorIndex === undefined) return null;
    return {
      startIndex: Math.min(anchorIndex, currentIndex),
      endIndex: Math.max(anchorIndex, currentIndex),
    };
  }, [highlightedMarkerId, markerIndexById, markerListAnchorId]);

  const selectedMarkersWithGroups = markers.filter(
    (m) => selectedMarkerIds.has(m.markerId) && m.groupId
  );
  const canUngroup = selectedMarkersWithGroups.length > 0;

  const isMarkerInHighlightRange = (markerId: string): boolean => {
    if (!highlightRange) return false;
    const markerIndex = markerIndexById.get(markerId);
    if (markerIndex === undefined) return false;
    return markerIndex >= highlightRange.startIndex && markerIndex <= highlightRange.endIndex;
  };

  return (
    <section className="course-pane__section course-pane__section--markers">
      <div className="course-pane__markers-header">
        <h3 className="course-pane__heading">Markers ({markers.length})</h3>
        {hasAnySelected && (
          <span className="course-pane__selection-count">
            {selectedMarkerIds.size} selected
          </span>
        )}
      </div>

      {hasMultipleSelected && (
        <div className="course-pane__group-actions">
          <button
            type="button"
            className="course-pane__group-btn"
            onClick={() => onGroupMarkers(selectedIdsSorted)}
            disabled={editingDisabled}
            title="Group selected markers (G)"
          >
            Group ({selectedMarkerIds.size})
          </button>
          {canUngroup && (
            <button
              type="button"
              className="course-pane__group-btn course-pane__group-btn--ungroup"
              onClick={() => onUngroupMarkers(selectedIdsSorted)}
              disabled={editingDisabled}
              title="Ungroup selected markers (U)"
            >
              Ungroup
            </button>
          )}
        </div>
      )}

      {!hasMultipleSelected && canUngroup && (
        <div className="course-pane__group-actions">
          <button
            type="button"
            className="course-pane__group-btn course-pane__group-btn--ungroup"
            onClick={() => onUngroupMarkers(selectedIdsSorted)}
            disabled={editingDisabled}
            title="Ungroup marker (U)"
          >
            Ungroup
          </button>
        </div>
      )}

      {markers.length === 0 ? (
        <div className="course-pane__empty">No markers yet. Press M to drop a marker.</div>
      ) : (
        <ul ref={markersListRef} className="course-pane__markers-list">
          {(() => {
            const groupedDisplay: Map<string, MarkerListItem[]> = new Map();
            const ungroupedMarkers: MarkerListItem[] = [];

            markers.forEach((m) => {
              if (m.groupId) {
                const group = groupedDisplay.get(m.groupId) || [];
                group.push(m);
                groupedDisplay.set(m.groupId, group);
              } else {
                ungroupedMarkers.push(m);
              }
            });

            const elements: JSX.Element[] = [];

            groupedDisplay.forEach((groupMarkers, groupId) => {
              const sorted = [...groupMarkers].sort((a, b) => a.mediaTimeSec - b.mediaTimeSec);
              const minTime = sorted[0].mediaTimeSec;
              const maxTime = sorted[sorted.length - 1].mediaTimeSec;

              elements.push(
                <li key={`group-header-${groupId}`} className="course-pane__group-header">
                  <span className="course-pane__group-icon">[G]</span>
                  <span className="course-pane__group-info">
                    {sorted.length} markers | {formatTime(minTime)} - {formatTime(maxTime)}
                  </span>
                </li>
              );

              sorted.forEach((marker) => {
                const isSelected = selectedMarkerIds.has(marker.markerId);
                elements.push(
                  <li
                    key={marker.markerId}
                    data-marker-id={marker.markerId}
                    className="course-pane__markers-item course-pane__markers-item--grouped"
                    onContextMenu={(e) => onMarkerContextMenu(e, marker.markerId)}
                  >
                    <button
                      type="button"
                      className={`course-pane__marker-btn ${isSelected ? 'course-pane__marker-btn--selected' : ''} ${isMarkerInHighlightRange(marker.markerId) ? 'course-pane__marker-btn--highlighted' : ''}`}
                      onClick={(e) => onMarkerClick(marker.markerId, marker.mediaTimeSec, e)}
                      title={marker.note || `Marker at ${formatTime(marker.mediaTimeSec)}`}
                    >
                      <span
                        className="course-pane__marker-dot"
                        style={{ backgroundColor: getImportanceColor(marker.importance) }}
                      />
                      <span className="course-pane__marker-time">{formatTime(marker.mediaTimeSec)}</span>
                      <span className="course-pane__marker-note">
                        {marker.note || '\u2014'}
                      </span>
                    </button>
                  </li>
                );
              });
            });

            ungroupedMarkers.forEach((marker) => {
              const isSelected = selectedMarkerIds.has(marker.markerId);
              elements.push(
                <li
                  key={marker.markerId}
                  data-marker-id={marker.markerId}
                  className="course-pane__markers-item"
                  onContextMenu={(e) => onMarkerContextMenu(e, marker.markerId)}
                >
                  <button
                    type="button"
                    className={`course-pane__marker-btn ${isSelected ? 'course-pane__marker-btn--selected' : ''} ${isMarkerInHighlightRange(marker.markerId) ? 'course-pane__marker-btn--highlighted' : ''}`}
                    onClick={(e) => onMarkerClick(marker.markerId, marker.mediaTimeSec, e)}
                    title={marker.note || `Marker at ${formatTime(marker.mediaTimeSec)}`}
                  >
                    <span
                      className="course-pane__marker-dot"
                      style={{ backgroundColor: getImportanceColor(marker.importance) }}
                    />
                    <span className="course-pane__marker-time">{formatTime(marker.mediaTimeSec)}</span>
                    <span className="course-pane__marker-note">
                      {marker.note || '\u2014'}
                    </span>
                  </button>
                </li>
              );
            });

            return elements;
          })()}
        </ul>
      )}
    </section>
  );
}
