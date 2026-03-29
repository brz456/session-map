# Shared Contracts

Type definitions and contracts shared between main and renderer processes. These modules must be Electron-free and importable from both contexts.

## Structure

```
shared/
  ipc/
    channels.ts      # IPC channel name constants
    types.ts         # Request/response types for all IPC operations
    sessionUi.ts     # UI snapshot event contract
  sessionPackage/
    types.ts         # SessionPackage schema and related types
    validate.ts      # Runtime validation for session data
    relink.ts        # Path relinking utilities
  telemetry/
    reconstruct.ts   # Playback state reconstruction from telemetry
  transcript/
    importFormat.ts  # Transcript import format definitions
    normalize.ts     # Transcript normalization
    validate.ts      # Transcript validation
  mediaProtocol.ts   # Media protocol constant
```

## IPC Contracts

### Channels (`ipc/channels.ts`)

All IPC channel names as constants:

```typescript
export const SESSION_IPC_CHANNELS = {
  create: 'session:create',
  load: 'session:load',
  save: 'session:save',
  // ...
} as const;

export const SESSION_IPC_EVENTS = {
  uiSnapshot: 'session:ui-snapshot',
} as const;
```

### Types (`ipc/types.ts`)

Request/response types for all IPC operations:

```typescript
export type SessionLoadResult =
  | { ok: true; session: SessionUiSnapshot; sessionDir: string; uiRevision: number }
  | { ok: false; code: SessionErrorCode; message: string };

export interface SessionSummary {
  sessionId: string;
  name: string;
  sessionDir: string;
  createdAtIso: string;
  updatedAtIso: string;
  lastModifiedIso: string;  // File system mtime
  recordingCount: number;
  totalDurationSec: number;
  markerCount: number;
}
```

### UI Snapshot (`ipc/sessionUi.ts`)

The contract for session state updates from main to renderer:

```typescript
// UI view model (telemetry events stripped)
export type SessionUiSnapshot = Omit<SessionPackage, 'telemetry'> & {
  telemetry: { events: readonly never[] };  // Compile-time guard
};

export type SessionUiEvent = {
  type: 'session_ui_snapshot';
  uiRevision: number;      // Monotonic ordering guard
  session: SessionUiSnapshot | null;
  sessionDir: string | null;
};
```

**Key invariant**: Renderer ignores events where `uiRevision <= lastAppliedUiRevision`.

## Session Package

### Schema (`sessionPackage/types.ts`)

The `SessionPackage` defines the persisted session format (v1):

```typescript
export interface SessionPackage {
  version: 1;
  sessionId: UUID;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  platform: { os: 'windows' };
  timebase: { origin: 'obs_recording_started'; timeUnit: 'seconds' };
  recordings: RecordingSegment[];
  media: { assets: MediaAsset[] };
  outline: { buckets: Bucket[] };
  taxonomy: { tags: Tag[] };
  telemetry: { events: PlaybackEvent[] };
  markers: Marker[];
  transcript: TranscriptRef | null;
}
```

### Key Types

| Type | Description |
|------|-------------|
| `RecordingSegment` | OBS recording with session time offset and duration |
| `MediaAsset` | Imported video file with metadata |
| `Bucket` | Organizational container for markers |
| `Tag` | Cross-cutting label for markers |
| `Marker` | Time-stamped annotation with note, drawing, importance |
| `PlaybackEvent` | Telemetry event (play, pause, seek, tick) |
| `MarkerDrawing` | Vector drawing data (strokes, points, colors) |

### Enum SSoT

Runtime-accessible enum values for validation:

```typescript
export const PLAYBACK_EVENT_TYPES = ['load', 'play', 'pause', 'seek', 'rate', 'tick'] as const;
export type PlaybackEventType = (typeof PLAYBACK_EVENT_TYPES)[number];

export const MARKER_SOURCE_TYPES = ['video', 'browser', 'whiteboard'] as const;
```

### Validation (`sessionPackage/validate.ts`)

Runtime validation for session data loaded from disk:

```typescript
export function validateSessionPackage(input: unknown): SessionValidationResult;
// Internal per-entity validators (validateMarker, validateBucket, etc.) are private
```

Validation is strict:
- `version` must be exactly `1`
- All required fields must be present and correctly typed
- `marker.sourceType` must be in `MARKER_SOURCE_TYPES`
- Timestamps must be valid ISO strings
- Arrays must contain valid items

## Design Principles

1. **Electron-free**: No Electron imports; these modules run in both Node.js and browser contexts.

2. **Single Source of Truth**: Each type has one canonical definition here.

3. **Strict validation**: No silent fallbacks; invalid data fails explicitly.

4. **Future-proofed**: `sourceType`, `version`, and extensible enums support future features without schema retrofits.
