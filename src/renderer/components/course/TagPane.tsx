import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type CSSProperties, type RefObject } from 'react';
import type { Marker, Tag } from '../../../shared/sessionPackage/types';

interface TagPaneProps {
  tags: readonly Tag[];
  selectedMarker: Marker | null;
  highlightedTagId: string | null;
  editingDisabled: boolean;
  inTagsMode: boolean;
  tagDraftName: string;
  tagDraftInputRef: RefObject<HTMLInputElement>;
  onTagDraftNameChange(name: string): void;
  onTagDraftFocus?: () => void;
  onCreateTag(): void;
  onTagClick(tag: Tag): void;
  onTagContextMenu(e: ReactMouseEvent, tag: Tag): void;
  editing: { type: 'bucket' | 'tag'; id: string; value: string } | null;
  onEditingValueChange(value: string): void;
  onFinishEditingTag(): void;
}

export function TagPane(props: TagPaneProps): JSX.Element {
  const {
    tags,
    selectedMarker,
    highlightedTagId,
    editingDisabled,
    inTagsMode,
    tagDraftName,
    tagDraftInputRef,
    onTagDraftNameChange,
    onTagDraftFocus,
    onCreateTag,
    onTagClick,
    onTagContextMenu,
    editing,
    onEditingValueChange,
    onFinishEditingTag,
  } = props;

  const tagsListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!highlightedTagId || !tagsListRef.current) return;
    const listEl = tagsListRef.current;
    const tagEl = Array.from(listEl.querySelectorAll('[data-tag-id]')).find(
      (el) => el instanceof HTMLElement && el.dataset.tagId === highlightedTagId
    );
    if (tagEl) {
      tagEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [highlightedTagId]);

  useEffect(() => {
    if (!selectedMarker?.tagIds.length || !tagsListRef.current) return;
    const listEl = tagsListRef.current;
    const firstTagId = selectedMarker.tagIds[0];
    const tagEl = Array.from(listEl.querySelectorAll('[data-tag-id]')).find(
      (el) => el instanceof HTMLElement && el.dataset.tagId === firstTagId
    );
    if (tagEl) {
      tagEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [selectedMarker?.tagIds]);

  return (
    <section className="course-pane__section">
      <h3 className="course-pane__heading">Tags</h3>
      <ul className="course-pane__list course-pane__list--tags" ref={tagsListRef}>
        {tags.map((tag) => (
          <li
            key={tag.tagId}
            className="course-pane__item course-pane__item--tag"
            onContextMenu={(e) => onTagContextMenu(e, tag)}
            title="Right-click for rename/delete"
          >
            {editing?.type === 'tag' && editing.id === tag.tagId ? (
              <input
                type="text"
                className="course-pane__input course-pane__input--small"
                value={editing.value}
                onChange={(e) => onEditingValueChange(e.target.value)}
                onBlur={onFinishEditingTag}
                onKeyDown={(e) => e.key === 'Enter' && onFinishEditingTag()}
                autoFocus
              />
            ) : (
              <button
                type="button"
                data-tag-id={tag.tagId}
                className={`course-pane__tag ${selectedMarker?.tagIds.includes(tag.tagId) ? 'course-pane__tag--selected' : ''} ${highlightedTagId === tag.tagId ? 'course-pane__tag--highlighted' : ''}`}
                style={tag.color ? { '--tag-color': tag.color } as CSSProperties : undefined}
                onClick={() => onTagClick(tag)}
                disabled={!selectedMarker || editingDisabled}
                title={!selectedMarker ? 'Select a marker first' : undefined}
              >
                {tag.name}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="course-pane__add">
        <input
          ref={tagDraftInputRef}
          type="text"
          className={`course-pane__input ${inTagsMode ? 'course-pane__input--mode-active' : ''}`}
          placeholder="New tag..."
          value={tagDraftName}
          onChange={(e) => onTagDraftNameChange(e.target.value)}
          onFocus={onTagDraftFocus}
          disabled={editingDisabled}
        />
        <button type="button" className="course-pane__add-btn" onClick={onCreateTag} disabled={editingDisabled} aria-label="Add tag">
          +
        </button>
      </div>
    </section>
  );
}
