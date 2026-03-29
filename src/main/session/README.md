# Session Management

Session state management for the main process. The `SessionStore` is the single source of truth for the active session.

## Structure

```
session/
  SessionStore.ts          # Thin facade delegating to mutators
  sessionStoreInstance.ts  # Singleton accessor (getSessionStore)
  toSessionUiSnapshot.ts   # SessionPackage -> SessionUiSnapshot (Electron-free)
  sessionMutators/
    types.ts               # SessionStoreMutatorContext interface
    sessionLifecycle.ts    # create, load, close, save, rename
    recordingMutators.ts   # Recording segment operations
    mediaMutators.ts       # Media asset CRUD
    bucketMutators.ts      # Bucket CRUD + forceRemove
    tagMutators.ts         # Tag CRUD + forceRemove
    markerMutators.ts      # Marker CRUD with patch handling
    playbackMutators.ts    # Telemetry, playback state
```

## SessionStore

The `SessionStore` class is a thin orchestrator:

```typescript
class SessionStore {
  private currentSession: SessionPackage | null = null;
  private currentSessionDir: string | null = null;
  private uiRevision = 0;

  // Lifecycle
  async create(baseDir: string, name: string): Promise<SessionCreateResult>;
  async load(sessionDir: string): Promise<SessionLoadResult>;
  close(): SessionCloseResult;  // synchronous
  async save(): Promise<SessionSaveResult>;
  rename(newName: string): SessionUpdateResult;  // synchronous

  // UI snapshot
  getUi(): GetUiSessionResult;

  // Domain operations (delegated to mutators, return SessionUpdateResult)
  addMarker(marker: Marker): SessionUpdateResult;
  updateMarker(markerId: string, patch: /* inline patch type */): SessionUpdateResult;
  // ...
}
```

## Singleton Pattern

The store is accessed via the singleton in `sessionStoreInstance.ts`:

```typescript
import { getSessionStore } from './sessionStoreInstance';

const store = getSessionStore();
await store.create('/path/to/sessions', 'My Session');
```

This ensures all IPC handlers and internal operations use the same store instance.

## Mutator Pattern

Operations are split into focused mutator modules. Each mutator receives a context:

```typescript
type SessionStoreMutatorContext = {
  getCurrentSession(): SessionPackage | null;
  setCurrentSession(session: SessionPackage | null): void;
  getCurrentSessionDir(): string | null;
  setCurrentSessionDir(dir: string | null): void;
  getUiRevision(): number;
  bumpUiRevision(): number;
  commitValidated: CommitValidatedFn;
};

type CommitValidatedFn = (
  nextSession: unknown,
  options?: { bumpUiRevision?: boolean }
) => SessionUpdateResult;
```

The `commitValidated` function is the SSoT commit point: it validates the session via `validateSessionPackage`, updates `updatedAtIso`, bumps `uiRevision` (unless disabled), and returns `SessionUpdateResult`.

## UI Revision

`uiRevision` is a monotonic counter incremented on every UI-relevant mutation:

1. Mutator calls `ctx.commitValidated(nextSession)` (which bumps revision) or `ctx.bumpUiRevision()` directly
2. IPC handler broadcasts `SessionUiEvent` with the new revision
3. Renderer ignores events with `uiRevision <= lastAppliedUiRevision`

This prevents stale/out-of-order snapshot application in the renderer.

## Session Package Shaping

`toSessionUiSnapshot()` converts `SessionPackage` to `SessionUiSnapshot`:

```typescript
export function toSessionUiSnapshot(session: SessionPackage): SessionUiSnapshot {
  return {
    ...session,
    telemetry: { events: [] },  // Strip telemetry events
  };
}
```

This is Electron-free and can be unit tested independently.

## Mutator Modules

### sessionLifecycle.ts
- `createSession` - Create new session folder and package
- `loadSession` - Load and validate existing session
- `closeSession` - Clear active session state (does not save; call save() first if needed)
- `saveSession` - Persist to disk
- `renameSession` - Update session name (folder path unchanged)

### recordingMutators.ts
- `addRecordingSegment` - Add completed recording segment
- `setInProgressRecording` - Mark recording as in-progress
- `clearInProgressRecording` - Clear in-progress flag
- `cleanupInterruptedRecording` - Handle interrupted recordings

### mediaMutators.ts
- `addMediaAsset` - Import media file to session
- `removeMediaAsset` - Remove media from session

### bucketMutators.ts
- `addBucket`, `updateBucket`, `removeBucket`
- `forceRemoveBucket` - Remove and unassign from all markers
- `reorderBucket` - Change bucket order

### tagMutators.ts
- `addTag`, `updateTag`, `removeTag`
- `forceRemoveTag` - Remove and unassign from all markers

### markerMutators.ts
- `addMarker` - Create new marker
- `updateMarker` - Update with patch (note, importance, drawing, buckets, tags)
- `removeMarker` - Delete marker

### playbackMutators.ts
- `addPlaybackEvent` - Append telemetry event (no UI broadcast)
- `setPlaybackState` - Save playback resume state
- `setTranscriptRef` - Set transcript reference
