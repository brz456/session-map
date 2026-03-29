import { useState, useRef, useEffect, type RefObject } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Bucket, Marker, Tag } from '../../../shared/sessionPackage/types';
import type { MarkerListItem } from '../../types/markers';
import { isTextInputLike } from '../../utils/dom';
import { BucketPane } from './BucketPane';
import { TagPane } from './TagPane';
import { MarkerInspector } from './MarkerInspector';
import { MarkerList } from './MarkerList';
import type { CoursePaneFocusTarget, MarkerUpdatePatch } from './types';
import type { CreateBucketResult } from '../../domains/buckets/bucketDomain';
import type { CreateTagResult } from '../../domains/tags/tagDomain';

export type { CoursePaneFocusTarget } from './types';

export interface CoursePaneProps {
  buckets: readonly Bucket[];
  tags: readonly Tag[];
  markers: readonly MarkerListItem[];
  selectedMarkerIds: ReadonlySet<string>;
  selectedMarker: Marker | null;
  onCreateBucket(title: string): Promise<CreateBucketResult>;
  onRenameBucket(bucketId: string, title: string): void;
  onDeleteBucket(bucketId: string): void;
  onReorderBucket(bucketId: string, newIndex: number): void;
  onCreateTag(name: string): Promise<CreateTagResult>;
  onRenameTag(tagId: string, name: string): void;
  onDeleteTag(tagId: string): void;
  onUpdateMarker(markerId: string, patch: MarkerUpdatePatch): void;
  onDeleteMarker(markerId: string): void;
  onMarkerClick(markerId: string, timeSec: number, event?: ReactMouseEvent): void;
  onGroupMarkers(markerIds: string[]): void;
  onUngroupMarkers(markerIds: string[]): void;
  editingDisabled?: boolean;
  drawingMode: boolean;
  drawingColor: string;
  isAtMarkerTime: boolean;
  drawingToolIndex: 0 | 1 | 2 | 3;
  onToggleDrawingMode(): void;
  onSetDrawingColor(color: string): void;
  onUndoStroke(): void;
  onRedoStroke(): void;
  canRedo: boolean;
  onClearDrawing(): void;
  focusTarget: CoursePaneFocusTarget;
  highlightedBucketId: string | null;
  highlightedTagId: string | null;
  highlightedMarkerId: string | null;
  markerListAnchorId: string | null;
  bucketDraftTitle: string;
  onBucketDraftTitleChange: (title: string) => void;
  tagDraftName: string;
  onTagDraftNameChange: (name: string) => void;
  noteTextareaRef: RefObject<HTMLTextAreaElement>;
  onBucketDraftFocus?: () => void;
  onTagDraftFocus?: () => void;
  onNoteFocus?: () => void;
  inBucketsMode: boolean;
  inTagsMode: boolean;
}

interface ContextMenuState {
  type: 'bucket' | 'tag' | 'marker';
  id: string;
  x: number;
  y: number;
}

export function CoursePane(props: CoursePaneProps): JSX.Element {
  const {
    buckets,
    tags,
    markers,
    selectedMarkerIds,
    selectedMarker,
    onCreateBucket,
    onRenameBucket,
    onDeleteBucket,
    onReorderBucket,
    onCreateTag,
    onRenameTag,
    onDeleteTag,
    onUpdateMarker,
    onDeleteMarker,
    onMarkerClick,
    onGroupMarkers,
    onUngroupMarkers,
    editingDisabled = false,
    drawingMode,
    drawingColor,
    isAtMarkerTime,
    drawingToolIndex,
    onToggleDrawingMode,
    onSetDrawingColor,
    onUndoStroke,
    onRedoStroke,
    canRedo,
    onClearDrawing,
    focusTarget,
    highlightedBucketId,
    highlightedTagId,
    highlightedMarkerId,
    markerListAnchorId,
    bucketDraftTitle,
    onBucketDraftTitleChange,
    tagDraftName,
    onTagDraftNameChange,
    noteTextareaRef,
    onBucketDraftFocus,
    onTagDraftFocus,
    onNoteFocus,
    inBucketsMode,
    inTagsMode,
  } = props;

  const hasMultipleSelected = selectedMarkerIds.size > 1;
  const singleEditingDisabled = editingDisabled || hasMultipleSelected;

  const [editing, setEditing] = useState<{ type: 'bucket' | 'tag'; id: string; value: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [draggedBucketId, setDraggedBucketId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const bucketDraftInputRef = useRef<HTMLInputElement>(null);
  const tagDraftInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusTarget === 'bucketDraft') {
      bucketDraftInputRef.current?.focus();
    } else if (focusTarget === 'tagDraft') {
      tagDraftInputRef.current?.focus();
    } else if (focusTarget === 'note') {
      noteTextareaRef.current?.focus();
    }
  }, [focusTarget, noteTextareaRef]);

  useEffect(() => {
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);

  const handleCreateBucket = () => {
    if (editingDisabled) return;
    const title = bucketDraftTitle.trim();
    if (!title) return;
    void (async () => {
      const result = await onCreateBucket(title);
      if (result.ok) {
        onBucketDraftTitleChange('');
      }
    })();
  };

  const startEditingBucket = (bucket: Bucket) => {
    if (editingDisabled) return;
    setEditing({ type: 'bucket', id: bucket.bucketId, value: bucket.title });
  };

  const finishEditingBucket = () => {
    if (editingDisabled) {
      setEditing(null);
      return;
    }
    if (!editing || editing.type !== 'bucket') return;
    const nextTitle = editing.value.trim();
    if (nextTitle) {
      const current = buckets.find((bucket) => bucket.bucketId === editing.id);
      if (!current || current.title !== nextTitle) {
        onRenameBucket(editing.id, nextTitle);
      }
    }
    setEditing(null);
  };

  const handleBucketClick = (bucket: Bucket) => {
    if (!selectedMarker || singleEditingDisabled) return;
    const newBucketId = selectedMarker.bucketId === bucket.bucketId ? null : bucket.bucketId;
    onUpdateMarker(selectedMarker.markerId, { bucketId: newBucketId });
  };

  const handleCreateTag = () => {
    if (editingDisabled) return;
    const name = tagDraftName.trim();
    if (!name) return;
    void (async () => {
      const result = await onCreateTag(name);
      if (result.ok) {
        onTagDraftNameChange('');
      }
    })();
  };

  const startEditingTag = (tag: Tag) => {
    if (editingDisabled) return;
    setEditing({ type: 'tag', id: tag.tagId, value: tag.name });
  };

  const finishEditingTag = () => {
    if (editingDisabled) {
      setEditing(null);
      return;
    }
    if (!editing || editing.type !== 'tag') return;
    const nextName = editing.value.trim();
    if (nextName) {
      const current = tags.find((tag) => tag.tagId === editing.id);
      if (!current || current.name !== nextName) {
        onRenameTag(editing.id, nextName);
      }
    }
    setEditing(null);
  };

  const handleTagClick = (tag: Tag) => {
    if (!selectedMarker || singleEditingDisabled) return;
    const currentTags = selectedMarker.tagIds;
    const newTags = currentTags.includes(tag.tagId)
      ? currentTags.filter((id) => id !== tag.tagId)
      : [...currentTags, tag.tagId];
    onUpdateMarker(selectedMarker.markerId, { tagIds: newTags });
  };

  const setMarkerImportance = (importance: 1 | 2 | 3) => {
    if (!selectedMarker || singleEditingDisabled) return;
    onUpdateMarker(selectedMarker.markerId, { importance });
  };

  const commitNote = () => {
    if (!selectedMarker || singleEditingDisabled) return;
    const el = noteTextareaRef.current;
    if (!el) return;
    const next = el.value;
    const prev = selectedMarker.note ?? '';
    if (next !== prev) {
      onUpdateMarker(selectedMarker.markerId, { note: next });
    }
  };

  const handleBucketContextMenu = (e: ReactMouseEvent, bucket: Bucket) => {
    const target = e.target instanceof Element ? e.target : null;
    if (editingDisabled || isTextInputLike(target)) return;
    e.preventDefault();
    setContextMenu({ type: 'bucket', id: bucket.bucketId, x: e.clientX, y: e.clientY });
  };

  const handleTagContextMenu = (e: ReactMouseEvent, tag: Tag) => {
    const target = e.target instanceof Element ? e.target : null;
    if (editingDisabled || isTextInputLike(target)) return;
    e.preventDefault();
    setContextMenu({ type: 'tag', id: tag.tagId, x: e.clientX, y: e.clientY });
  };

  const handleMarkerContextMenu = (e: ReactMouseEvent, markerId: string) => {
    const target = e.target instanceof Element ? e.target : null;
    if (editingDisabled || isTextInputLike(target)) return;
    e.preventDefault();
    setContextMenu({ type: 'marker', id: markerId, x: e.clientX, y: e.clientY });
  };

  const handleContextMenuDelete = () => {
    if (!contextMenu || editingDisabled) {
      setContextMenu(null);
      return;
    }
    if (contextMenu.type === 'bucket') {
      onDeleteBucket(contextMenu.id);
    } else if (contextMenu.type === 'tag') {
      onDeleteTag(contextMenu.id);
    } else if (contextMenu.type === 'marker') {
      onDeleteMarker(contextMenu.id);
    }
    setContextMenu(null);
  };

  const handleContextMenuRename = () => {
    if (!contextMenu || editingDisabled) {
      setContextMenu(null);
      return;
    }
    if (contextMenu.type === 'bucket') {
      const bucket = buckets.find((b) => b.bucketId === contextMenu.id);
      if (bucket) startEditingBucket(bucket);
    } else if (contextMenu.type === 'tag') {
      const tag = tags.find((t) => t.tagId === contextMenu.id);
      if (tag) startEditingTag(tag);
    }
    setContextMenu(null);
  };

  const handleDragStart = (e: DragEvent<HTMLLIElement>, bucket: Bucket) => {
    if (editingDisabled) return;
    setDraggedBucketId(bucket.bucketId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', bucket.bucketId);
  };

  const handleDragOver = (e: DragEvent<HTMLLIElement>, index: number) => {
    if (editingDisabled || !draggedBucketId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetIndex(index);
  };

  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleDrop = (e: DragEvent<HTMLLIElement>, targetIndex: number) => {
    e.preventDefault();
    if (!draggedBucketId || editingDisabled) return;
    const draggedIndex = buckets.findIndex((b) => b.bucketId === draggedBucketId);
    if (draggedIndex !== -1 && draggedIndex !== targetIndex) {
      onReorderBucket(draggedBucketId, targetIndex);
    }
    setDraggedBucketId(null);
    setDropTargetIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedBucketId(null);
    setDropTargetIndex(null);
  };

  const handleEditingValueChange = (value: string) => {
    setEditing((prev) => (prev ? { ...prev, value } : prev));
  };

  return (
    <div className={`course-pane ${selectedMarker ? 'course-pane--editing' : ''}`}>
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="course-pane__context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.type !== 'marker' && (
            <button
              type="button"
              className="course-pane__context-menu-item"
              onClick={handleContextMenuRename}
              disabled={editingDisabled}
            >
              Rename
            </button>
          )}
          <button
            type="button"
            className="course-pane__context-menu-item course-pane__context-menu-item--danger"
            onClick={handleContextMenuDelete}
            disabled={editingDisabled}
          >
            Delete
          </button>
        </div>,
        document.body
      )}

      <BucketPane
        buckets={buckets}
        selectedMarker={selectedMarker}
        highlightedBucketId={highlightedBucketId}
        editingDisabled={editingDisabled}
        inBucketsMode={inBucketsMode}
        bucketDraftTitle={bucketDraftTitle}
        bucketDraftInputRef={bucketDraftInputRef}
        onBucketDraftTitleChange={onBucketDraftTitleChange}
        onBucketDraftFocus={onBucketDraftFocus}
        onCreateBucket={handleCreateBucket}
        onBucketClick={handleBucketClick}
        onBucketContextMenu={handleBucketContextMenu}
        editing={editing}
        onEditingValueChange={handleEditingValueChange}
        onFinishEditingBucket={finishEditingBucket}
        draggedBucketId={draggedBucketId}
        dropTargetIndex={dropTargetIndex}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      />

      <TagPane
        tags={tags}
        selectedMarker={selectedMarker}
        highlightedTagId={highlightedTagId}
        editingDisabled={editingDisabled}
        inTagsMode={inTagsMode}
        tagDraftName={tagDraftName}
        tagDraftInputRef={tagDraftInputRef}
        onTagDraftNameChange={onTagDraftNameChange}
        onTagDraftFocus={onTagDraftFocus}
        onCreateTag={handleCreateTag}
        onTagClick={handleTagClick}
        onTagContextMenu={handleTagContextMenu}
        editing={editing}
        onEditingValueChange={handleEditingValueChange}
        onFinishEditingTag={finishEditingTag}
      />

      <MarkerInspector
        selectedMarker={selectedMarker}
        editingDisabled={editingDisabled}
        drawingMode={drawingMode}
        drawingColor={drawingColor}
        drawingToolIndex={drawingToolIndex}
        isAtMarkerTime={isAtMarkerTime}
        canRedo={canRedo}
        noteTextareaRef={noteTextareaRef}
        onNoteFocus={onNoteFocus}
        onSetMarkerImportance={setMarkerImportance}
        onCommitNote={commitNote}
        onToggleDrawingMode={onToggleDrawingMode}
        onSetDrawingColor={onSetDrawingColor}
        onUndoStroke={onUndoStroke}
        onRedoStroke={onRedoStroke}
        onClearDrawing={onClearDrawing}
      />

      <MarkerList
        markers={markers}
        selectedMarkerIds={selectedMarkerIds}
        selectedMarker={selectedMarker}
        highlightedMarkerId={highlightedMarkerId}
        markerListAnchorId={markerListAnchorId}
        editingDisabled={editingDisabled}
        onMarkerClick={onMarkerClick}
        onMarkerContextMenu={handleMarkerContextMenu}
        onGroupMarkers={onGroupMarkers}
        onUngroupMarkers={onUngroupMarkers}
      />
    </div>
  );
}
