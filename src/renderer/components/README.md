# Components

Presentational React components. These are pure UI with no IPC calls or domain logic.

## Structure

```
components/
  player/
    VideoPlayer.tsx      # HTML5 video player with controls
    DrawingOverlay.tsx   # Canvas overlay for marker drawings
    videoPlayerTypes.ts  # Shared types (VideoPlayerHandle)
    icons.tsx            # SVG icons for player controls
  course/
    CoursePane.tsx       # Right sidebar (buckets, tags, markers)
    BucketPane.tsx       # Bucket list and management UI
    TagPane.tsx          # Tag chips and management UI
    MarkerList.tsx       # Scrollable marker list
    MarkerInspector.tsx  # Selected marker details (importance, note, drawing controls)
    types.ts             # Shared types for course components
  session/
    ClipPanel.tsx        # Right-side clip manager panel
  SessionList.tsx        # Home session list
```

## Design Principles

1. **No IPC**: Components never call `window.api.*` directly. They receive data via props and emit intents via callbacks.

2. **Presentational**: Components render UI based on props. State management lives in domains.

3. **Callbacks for intents**: User actions (clicks, key presses) call callback props like `onSelectMarker`, `onDropMarker`, etc.

4. **Readonly props**: Use `ReadonlySet<T>` and `readonly T[]` to prevent accidental mutations.

## Player Components

### VideoPlayer

HTML5 video player with:
- Play/pause, seek, rate controls
- Media switching
- Marker timeline display
- Imperative handle for external control (`VideoPlayerHandle`)

### DrawingOverlay

Canvas overlay for vector drawings:
- Renders `MarkerDrawing` strokes
- Handles pointer events for drawing mode
- Coordinates in video-normalized space (0-1)

## Course Components

### CoursePane

Main right sidebar orchestrating:
- BucketPane (top section)
- TagPane (middle section)
- MarkerList (scrollable list)
- MarkerInspector (bottom section when marker selected)

### BucketPane / TagPane

List management with:
- Keyboard navigation support
- Inline editing (draft mode)
- Assignment to selected markers

### MarkerList

Virtualized marker list with:
- Click/shift-click/ctrl-click selection
- Keyboard navigation (arrow keys, range selection)
- Scroll-to-highlighted behavior

### MarkerInspector

Selected marker details:
- Importance slider (1-3)
- Note textarea
- Drawing color/tool selection
- Undo/redo controls

## Session Components

### ClipPanel

Right-side panel showing imported media assets:
- Active/highlighted states
- Clip removal and import actions
- Keyboard navigation in clips mode

## Props Patterns

Components receive readonly data and action callbacks:

```typescript
interface MarkerListProps {
  markers: readonly Marker[];
  selectedMarkerIds: ReadonlySet<string>;
  highlightedMarkerId: string | null;
  onSelectMarker: (id: string, mode: 'single' | 'extend' | 'toggle') => void;
  onHighlightMarker: (id: string | null) => void;
  // ...
}
```
