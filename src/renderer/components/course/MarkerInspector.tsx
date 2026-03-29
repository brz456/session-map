import type { RefObject } from 'react';
import type { Marker } from '../../../shared/sessionPackage/types';

interface MarkerInspectorProps {
  selectedMarker: Marker | null;
  editingDisabled: boolean;
  drawingMode: boolean;
  drawingColor: string;
  drawingToolIndex: 0 | 1 | 2 | 3;
  isAtMarkerTime: boolean;
  canRedo: boolean;
  noteTextareaRef: RefObject<HTMLTextAreaElement>;
  onNoteFocus?: () => void;
  onSetMarkerImportance(level: 1 | 2 | 3): void;
  onCommitNote(): void;
  onToggleDrawingMode(): void;
  onSetDrawingColor(color: string): void;
  onUndoStroke(): void;
  onRedoStroke(): void;
  onClearDrawing(): void;
}

export function MarkerInspector(props: MarkerInspectorProps): JSX.Element {
  const {
    selectedMarker,
    editingDisabled,
    drawingMode,
    drawingColor,
    drawingToolIndex,
    isAtMarkerTime,
    canRedo,
    noteTextareaRef,
    onNoteFocus,
    onSetMarkerImportance,
    onCommitNote,
    onToggleDrawingMode,
    onSetDrawingColor,
    onUndoStroke,
    onRedoStroke,
    onClearDrawing,
  } = props;

  const hasMarkerSelected = selectedMarker !== null;
  const strokeCount = selectedMarker?.drawing?.strokes.length ?? 0;

  return (
    <>
      <section className="course-pane__section">
        <h3 className="course-pane__heading">Importance</h3>
        <div className="course-pane__importance">
          {([1, 2, 3] as const).map((level) => (
            <button
              type="button"
              key={level}
              className={`course-pane__importance-btn ${selectedMarker?.importance === level ? 'course-pane__importance-btn--selected' : ''}`}
              onClick={() => onSetMarkerImportance(level)}
              disabled={!hasMarkerSelected || editingDisabled}
            >
              {level}
            </button>
          ))}
        </div>
      </section>

      <section className="course-pane__section">
        <h3 className="course-pane__heading">Note</h3>
        <textarea
          key={selectedMarker?.markerId ?? 'no-marker'}
          ref={noteTextareaRef}
          className="course-pane__textarea"
          defaultValue={selectedMarker?.note || ''}
          onBlur={onCommitNote}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onFocus={onNoteFocus}
          placeholder={hasMarkerSelected ? 'Add a note...' : 'Select a marker first'}
          rows={3}
          disabled={!hasMarkerSelected || editingDisabled}
        />
      </section>

      <section className="course-pane__section">
        <h3 className="course-pane__heading">Drawing</h3>
        <div className="course-pane__drawing-controls">
          <button
            type="button"
            className={`course-pane__draw-btn ${drawingMode ? 'course-pane__draw-btn--active' : ''}`}
            onClick={onToggleDrawingMode}
            disabled={!hasMarkerSelected || editingDisabled}
            title={drawingMode ? 'Exit draw mode' : 'Enter draw mode'}
          >
            Draw
          </button>
          <input
            type="color"
            className={`course-pane__color-picker ${drawingMode && drawingToolIndex === 3 ? 'course-pane__drawing-tool--highlighted' : ''}`}
            value={drawingColor}
            onChange={(e) => onSetDrawingColor(e.target.value)}
            disabled={!hasMarkerSelected || editingDisabled}
            title="Stroke color"
          />
          <button
            type="button"
            className={`course-pane__undo-btn ${drawingMode && drawingToolIndex === 0 ? 'course-pane__drawing-tool--highlighted' : ''}`}
            onClick={onUndoStroke}
            disabled={!hasMarkerSelected || editingDisabled || !isAtMarkerTime || strokeCount === 0}
            title="Undo last stroke (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className={`course-pane__redo-btn ${drawingMode && drawingToolIndex === 1 ? 'course-pane__drawing-tool--highlighted' : ''}`}
            onClick={onRedoStroke}
            disabled={!hasMarkerSelected || editingDisabled || !isAtMarkerTime || !canRedo}
            title="Redo last stroke (Ctrl+Y)"
          >
            Redo
          </button>
          <button
            type="button"
            className={`course-pane__clear-btn ${drawingMode && drawingToolIndex === 2 ? 'course-pane__drawing-tool--highlighted' : ''}`}
            onClick={onClearDrawing}
            disabled={!hasMarkerSelected || editingDisabled || !isAtMarkerTime || strokeCount === 0}
            title="Clear all strokes"
          >
            Clear
          </button>
        </div>
        <div className="course-pane__drawing-info">
          {strokeCount > 0
            ? `${strokeCount} stroke(s)`
            : '\u00A0'}
        </div>
      </section>
    </>
  );
}
