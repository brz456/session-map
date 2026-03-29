// src/renderer/components/SessionList.tsx
// Home screen - Minimal table-based layout (presentational)

import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { SessionSummary } from '../../shared/ipc/types';
import type { HomeSortDir, HomeSortKey } from '../domains/home/homeDomain';

interface SessionListProps {
  sessions: readonly SessionSummary[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  sortKey: HomeSortKey;
  sortDir: HomeSortDir;
  onSearchQueryChange(query: string): void;
  onSortChange(key: HomeSortKey): void;

  onOpenSession(sessionDir: string): void;
  onNewSession(): void;
  onRequestDelete(sessionId: string): void;
  onRenameSession(sessionDir: string, newName: string): Promise<void>;

  disabled?: boolean;
  highlightedSessionId: string | null;
  buttonFocus: 'open' | 'delete';
  searchInputRef: RefObject<HTMLInputElement>;
  onSearchFocus?: () => void;
}

/** Formats an ISO date string. Assumes validation passed at load boundary. */
function formatDate(isoString: string): string {
  return isoString.slice(0, 10);
}

/** Formats duration in seconds. Assumes validation passed at load boundary. */
function formatDuration(totalSeconds: number): string {
  if (totalSeconds === 0) return '0:00';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function SessionList({
  sessions,
  loading,
  error,
  searchQuery,
  sortKey,
  sortDir,
  onSearchQueryChange,
  onSortChange,
  onOpenSession,
  onNewSession,
  onRequestDelete,
  onRenameSession,
  disabled = false,
  highlightedSessionId,
  buttonFocus,
  searchInputRef,
  onSearchFocus,
}: SessionListProps): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [editing, setEditing] = useState<{ sessionId: string; sessionDir: string; value: string; originalValue: string } | null>(null);
  const suppressBlurRef = useRef(false);

  const isTextInput = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  };

  const handleSort = (key: HomeSortKey) => {
    onSortChange(key);
  };

  const handleRename = async (sessionDir: string, newName: string) => {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      setEditing(null);
      return;
    }
    if (disabled) {
      setEditing(null);
      return;
    }
    const trimmed = newName.trim();
    if (!trimmed || (editing && trimmed === editing.originalValue)) {
      setEditing(null);
      return;
    }
    try {
      await onRenameSession(sessionDir, trimmed);
    } finally {
      setEditing(null);
    }
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !contextMenuRef.current?.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu]);

  const SortIndicator = ({ column }: { column: HomeSortKey }) => {
    if (sortKey !== column) return null;
    return <span className="sl-sort-indicator">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>;
  };

  return (
    <div className="sl">
      {/* Command Bar */}
      <div className="sl-bar">
        <div className="sl-search">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onFocus={onSearchFocus}
            disabled={disabled}
          />
          <kbd>Ctrl+F</kbd>
        </div>
        <button
          type="button"
          className="sl-new"
          onClick={onNewSession}
          disabled={disabled}
        >
          + New Session
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="sl-error">
          <span>{error}</span>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="sl-status">Loading...</div>
      ) : sessions.length === 0 ? (
        searchQuery ? (
          <div className="sl-empty">
            <div className="sl-empty-text">No matches for "{searchQuery}"</div>
            <button type="button" className="sl-empty-clear" onClick={() => onSearchQueryChange('')}>
              Clear search
            </button>
          </div>
        ) : (
          <div className="sl-empty">
            <div className="sl-empty-text">No sessions</div>
            <div className="sl-empty-hint">Press the button above to create your first session</div>
          </div>
        )
      ) : (
        <div className="sl-table-wrap">
          <table className="sl-table">
            <thead>
              <tr>
                <th className="sl-th sl-th--name" aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="sl-th-btn" onClick={() => handleSort('name')}>
                    Name <SortIndicator column="name" />
                  </button>
                </th>
                <th className="sl-th sl-th--num" aria-sort={sortKey === 'recordings' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="sl-th-btn" onClick={() => handleSort('recordings')}>
                    Recs <SortIndicator column="recordings" />
                  </button>
                </th>
                <th className="sl-th sl-th--num" aria-sort={sortKey === 'markers' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="sl-th-btn" onClick={() => handleSort('markers')}>
                    Markers <SortIndicator column="markers" />
                  </button>
                </th>
                <th className="sl-th sl-th--duration" aria-sort={sortKey === 'duration' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="sl-th-btn" onClick={() => handleSort('duration')}>
                    Duration <SortIndicator column="duration" />
                  </button>
                </th>
                <th className="sl-th sl-th--date" aria-sort={sortKey === 'created' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="sl-th-btn" onClick={() => handleSort('created')}>
                    Created <SortIndicator column="created" />
                  </button>
                </th>
                <th className="sl-th sl-th--date" aria-sort={sortKey === 'modified' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="sl-th-btn" onClick={() => handleSort('modified')}>
                    Modified <SortIndicator column="modified" />
                  </button>
                </th>
                <th className="sl-th sl-th--actions" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.sessionId}
                  className={`sl-row ${highlightedSessionId === session.sessionId ? 'sl-row--highlighted' : ''}`}
                  onClick={() => {
                    if (!disabled && !editing) onOpenSession(session.sessionDir);
                  }}
                  onContextMenu={(e) => {
                    if (isTextInput(e.target)) return;
                    e.preventDefault();
                    if (!disabled) {
                      setContextMenu({ sessionId: session.sessionId, x: e.clientX, y: e.clientY });
                    }
                  }}
                >
                  <td className="sl-td sl-td--name">
                    {editing?.sessionId === session.sessionId ? (
                      <input
                        type="text"
                        className="sl-name-input"
                        value={editing.value}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditing((prev) => prev ? { ...prev, value: e.target.value } : null)}
                        onBlur={() => handleRename(editing.sessionDir, editing.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') {
                            suppressBlurRef.current = true;
                            e.currentTarget.blur();
                          }
                        }}
                        disabled={disabled}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="sl-name"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (!disabled) {
                            setEditing({ sessionId: session.sessionId, sessionDir: session.sessionDir, value: session.name, originalValue: session.name });
                          }
                        }}
                        title="Double-click to rename"
                      >
                        {session.name}
                      </span>
                    )}
                  </td>
                  <td className="sl-td sl-td--num">{session.recordingCount}</td>
                  <td className="sl-td sl-td--num">{session.markerCount}</td>
                  <td className="sl-td sl-td--duration sl-td--mono">{formatDuration(session.totalDurationSec)}</td>
                  <td className="sl-td sl-td--date sl-td--mono">{formatDate(session.createdAtIso)}</td>
                  <td className="sl-td sl-td--date sl-td--mono">{formatDate(session.lastModifiedIso)}</td>
                  <td className="sl-td sl-td--actions">
                    <div className="sl-actions">
                      <button
                        type="button"
                        className={`sl-btn sl-btn--open ${highlightedSessionId === session.sessionId && buttonFocus === 'open' ? 'sl-btn--highlighted' : ''}`}
                        onClick={(e) => { e.stopPropagation(); onOpenSession(session.sessionDir); }}
                        disabled={disabled}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className={`sl-btn sl-btn--delete ${highlightedSessionId === session.sessionId && buttonFocus === 'delete' ? 'sl-btn--highlighted' : ''}`}
                        onClick={(e) => { e.stopPropagation(); onRequestDelete(session.sessionId); }}
                        disabled={disabled}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="sl-context"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            type="button"
            onClick={() => {
              const s = sessions.find((x) => x.sessionId === contextMenu.sessionId);
              if (s) setEditing({ sessionId: s.sessionId, sessionDir: s.sessionDir, value: s.name, originalValue: s.name });
              setContextMenu(null);
            }}
            disabled={disabled}
          >
            Rename
          </button>
          <button
            type="button"
            className="sl-context--danger"
            onClick={() => {
              onRequestDelete(contextMenu.sessionId);
              setContextMenu(null);
            }}
            disabled={disabled}
          >
            Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
