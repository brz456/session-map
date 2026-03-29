import { useEffect, useRef } from 'react';
import type { MediaAsset } from '../../../shared/sessionPackage/types';
import type { SessionMode } from '../../input/modes';
import { formatTime } from '../../utils/format';

export interface ClipPanelProps {
  assets: readonly MediaAsset[];
  markerCountByMediaId: Readonly<Record<string, number>>;
  activeMediaIndex: number;
  highlightedClipIndex: number;
  sessionMode: SessionMode;
  canImportMedia: boolean;
  canDeleteMedia: boolean;
  onSelectMedia(index: number): void;
  onDeleteMedia(mediaId: string): void;
  onImportMedia(): void;
}

export function ClipPanel(props: ClipPanelProps): JSX.Element {
  const {
    assets,
    markerCountByMediaId,
    activeMediaIndex,
    highlightedClipIndex,
    sessionMode,
    canImportMedia,
    canDeleteMedia,
    onSelectMedia,
    onDeleteMedia,
    onImportMedia,
  } = props;

  const listRef = useRef<HTMLDivElement>(null);

  const formatDurationLabel = (durationSec: number | undefined): string => {
    if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 0) {
      return '--:--';
    }
    return formatTime(durationSec);
  };

  useEffect(() => {
    if (sessionMode !== 'clips' || highlightedClipIndex < 0 || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-clip-index="${highlightedClipIndex}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [highlightedClipIndex, sessionMode]);

  return (
    <aside className="clip-panel" aria-label="Clip panel">
      <header className="clip-panel__header">
        <span className="clip-panel__title">Clips</span>
        <span className="clip-panel__count">{assets.length}</span>
        <button
          type="button"
          className={`clip-panel__import ${sessionMode === 'clips' && highlightedClipIndex === assets.length ? 'clip-panel__import--highlighted' : ''}`}
          onClick={onImportMedia}
          disabled={!canImportMedia}
          data-clip-index={assets.length}
          title="Import media files"
        >
          +Import
        </button>
      </header>

      <div className="clip-panel__list" ref={listRef}>
        {assets.length > 0 ? (
          assets.map((asset, index) => {
            const isActive = index === activeMediaIndex;
            const isHighlighted = sessionMode === 'clips' && index === highlightedClipIndex;
            const markerCount = markerCountByMediaId[asset.mediaId] ?? 0;
            return (
              <div
                key={asset.mediaId}
                className={`clip-panel__row ${isActive ? 'clip-panel__row--active' : ''} ${isHighlighted ? 'clip-panel__row--highlighted' : ''}`}
              >
                <button
                  type="button"
                  className="clip-panel__select"
                  onClick={() => onSelectMedia(index)}
                  data-clip-index={index}
                  title={asset.displayName}
                >
                  <span className={`clip-panel__active-dot ${isActive ? 'clip-panel__active-dot--on' : ''}`} aria-hidden="true" />
                  <span className="clip-panel__duration">{formatDurationLabel(asset.durationSec)}</span>
                  <span className="clip-panel__name">{asset.displayName}</span>
                  {markerCount > 0 && (
                    <span className="clip-panel__markers">{markerCount}</span>
                  )}
                </button>
                <button
                  type="button"
                  className="clip-panel__delete"
                  onClick={() => onDeleteMedia(asset.mediaId)}
                  disabled={!canDeleteMedia}
                  title="Remove clip from session"
                  aria-label={`Remove ${asset.displayName}`}
                >
                  ×
                </button>
              </div>
            );
          })
        ) : (
          <div className="clip-panel__empty">No clips loaded</div>
        )}
      </div>
    </aside>
  );
}
