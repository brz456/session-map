import { useEffect, useRef, type DragEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { Bucket, Marker } from '../../../shared/sessionPackage/types';

interface BucketPaneProps {
  buckets: readonly Bucket[];
  selectedMarker: Marker | null;
  highlightedBucketId: string | null;
  editingDisabled: boolean;
  inBucketsMode: boolean;
  bucketDraftTitle: string;
  bucketDraftInputRef: RefObject<HTMLInputElement>;
  onBucketDraftTitleChange(title: string): void;
  onBucketDraftFocus?: () => void;
  onCreateBucket(): void;
  onBucketClick(bucket: Bucket): void;
  onBucketContextMenu(e: ReactMouseEvent, bucket: Bucket): void;
  editing: { type: 'bucket' | 'tag'; id: string; value: string } | null;
  onEditingValueChange(value: string): void;
  onFinishEditingBucket(): void;
  draggedBucketId: string | null;
  dropTargetIndex: number | null;
  onDragStart(e: DragEvent<HTMLLIElement>, bucket: Bucket): void;
  onDragOver(e: DragEvent<HTMLLIElement>, index: number): void;
  onDragLeave(): void;
  onDrop(e: DragEvent<HTMLLIElement>, targetIndex: number): void;
  onDragEnd(): void;
}

export function BucketPane(props: BucketPaneProps): JSX.Element {
  const {
    buckets,
    selectedMarker,
    highlightedBucketId,
    editingDisabled,
    inBucketsMode,
    bucketDraftTitle,
    bucketDraftInputRef,
    onBucketDraftTitleChange,
    onBucketDraftFocus,
    onCreateBucket,
    onBucketClick,
    onBucketContextMenu,
    editing,
    onEditingValueChange,
    onFinishEditingBucket,
    draggedBucketId,
    dropTargetIndex,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
  } = props;

  const bucketsListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!highlightedBucketId || !bucketsListRef.current) return;
    const listEl = bucketsListRef.current;
    const bucketEl = Array.from(listEl.children).find(
      (el) => el instanceof HTMLElement && el.dataset.bucketId === highlightedBucketId
    );
    if (bucketEl) {
      bucketEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [highlightedBucketId]);

  useEffect(() => {
    if (!selectedMarker?.bucketId || !bucketsListRef.current) return;
    const listEl = bucketsListRef.current;
    const bucketEl = Array.from(listEl.children).find(
      (el) => el instanceof HTMLElement && el.dataset.bucketId === selectedMarker.bucketId
    );
    if (bucketEl) {
      bucketEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [selectedMarker?.bucketId]);

  return (
    <section className="course-pane__section">
      <h3 className="course-pane__heading">Buckets</h3>
      <ul className="course-pane__list" ref={bucketsListRef}>
        {buckets.map((bucket, index) => (
          <li
            key={bucket.bucketId}
            data-bucket-id={bucket.bucketId}
            className={`course-pane__item ${
              draggedBucketId === bucket.bucketId ? 'course-pane__item--dragging' : ''
            } ${dropTargetIndex === index ? 'course-pane__item--drop-target' : ''}`}
            draggable={!editingDisabled && !(editing?.type === 'bucket' && editing.id === bucket.bucketId)}
            onDragStart={(e) => onDragStart(e, bucket)}
            onDragOver={(e) => onDragOver(e, index)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, index)}
            onDragEnd={onDragEnd}
            onContextMenu={(e) => onBucketContextMenu(e, bucket)}
            title="Right-click for rename/delete"
          >
            {editing?.type === 'bucket' && editing.id === bucket.bucketId ? (
              <input
                type="text"
                className="course-pane__input"
                value={editing.value}
                onChange={(e) => onEditingValueChange(e.target.value)}
                onBlur={onFinishEditingBucket}
                onKeyDown={(e) => e.key === 'Enter' && onFinishEditingBucket()}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className={`course-pane__btn ${selectedMarker?.bucketId === bucket.bucketId ? 'course-pane__btn--selected' : ''} ${highlightedBucketId === bucket.bucketId ? 'course-pane__btn--highlighted' : ''}`}
                onClick={() => onBucketClick(bucket)}
                disabled={!selectedMarker || editingDisabled}
                title={!selectedMarker ? 'Select a marker first' : undefined}
              >
                {bucket.title}
              </button>
            )}
          </li>
        ))}
        {draggedBucketId && (
          <li
            className={`course-pane__item course-pane__item--drop-zone ${
              dropTargetIndex === buckets.length ? 'course-pane__item--drop-target' : ''
            }`}
            onDragOver={(e) => onDragOver(e, buckets.length)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, buckets.length)}
          />
        )}
      </ul>
      <div className="course-pane__add">
        <input
          ref={bucketDraftInputRef}
          type="text"
          className={`course-pane__input ${inBucketsMode ? 'course-pane__input--mode-active' : ''}`}
          placeholder="New bucket..."
          value={bucketDraftTitle}
          onChange={(e) => onBucketDraftTitleChange(e.target.value)}
          onFocus={onBucketDraftFocus}
          disabled={editingDisabled}
        />
        <button type="button" className="course-pane__add-btn" onClick={onCreateBucket} disabled={editingDisabled} aria-label="Add bucket">
          +
        </button>
      </div>
    </section>
  );
}
