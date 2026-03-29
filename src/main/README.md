# Main Process

The Electron main process handles all Node.js operations: window management, file I/O, session persistence, OBS integration, and IPC handling.

## Architecture

```
main/
  main.ts                    # Thin entry point (platform check, protocol, delegate)
  app/
    main.ts                  # Application initialization (runMain)
    createMainWindow.ts      # BrowserWindow creation with security config
  session/
    SessionStore.ts          # Session state facade (thin orchestrator)
    sessionStoreInstance.ts  # Singleton accessor (getSessionStore)
    toSessionUiSnapshot.ts   # SessionPackage -> SessionUiSnapshot shaping
    sessionMutators/         # Domain-specific mutators
  ipc/
    registerIpc.ts           # Central IPC handler registration
    session/                 # Session IPC handlers
    appFolder/               # App folder operations (list, delete, rename)
    media/                   # Media file handling
    obs/                     # OBS IPC handlers
    dialog/                  # Native dialogs
  obs/                       # OBS Studio Node integration
  export/                    # Export operations (ffmpeg)
  fs/                        # File system utilities
  mediaProtocol.ts           # Custom protocol for secure media access
```

## Entry Point Flow

1. `main.ts` - Platform check (Windows-only), register custom protocol, delegate to `app/main.ts`
2. `app/main.ts:runMain()` - Wait for app ready, register media protocol, register IPC handlers, create window
3. Window loads renderer from Vite dev server (dev) or `dist/` (prod)

## Session Management

### SessionStore

`SessionStore` is the SSoT for the active session. It:
- Holds the in-memory `SessionPackage` during an active session
- Delegates to domain-specific mutators for all operations
- Tracks `uiRevision` (monotonic counter for ordering broadcasts)
- Provides `getUi()` for creating `SessionUiSnapshot` payloads

The store is a singleton accessed via `getSessionStore()` from `sessionStoreInstance.ts`.

### Session Mutators

Operations are split into focused mutator modules:

| Module | Operations |
|--------|------------|
| `sessionLifecycle.ts` | create, load, close, save, rename |
| `recordingMutators.ts` | addRecordingSegment, setInProgressRecording, cleanup |
| `mediaMutators.ts` | addMediaAsset, removeMediaAsset |
| `bucketMutators.ts` | add, update, remove, forceRemove, reorder |
| `tagMutators.ts` | add, update, remove, forceRemove |
| `markerMutators.ts` | add, update, remove (with drawing/bucket/tag patches) |
| `playbackMutators.ts` | addPlaybackEvent, setPlaybackState, setTranscriptRef |

Each mutator receives a `SessionStoreMutatorContext` providing access to the session state and helpers.

### UI Snapshot Broadcasting

After UI-relevant mutations, the main process broadcasts a `SessionUiEvent` to the renderer:

1. IPC handler registered via `registerUiMutationHandler()` wraps the operation
2. On success (`{ ok: true }`), it calls `broadcastSessionUiEvent()`
3. Broadcast sends to all windows via `BrowserWindow.getAllWindows()`
4. Renderer applies the snapshot using `uiRevision` ordering

**Telemetry exception**: `addPlaybackEvent` does NOT broadcast (high-frequency hot path).

## IPC Handlers

### Session IPC (`ipc/session/registerSessionIpc.ts`)

All session operations: create, load, close, save, rename, markers, buckets, tags, recording, playback, export.

Handlers are registered via `registerUiMutationHandler()` for automatic UI broadcasting:
```typescript
registerUiMutationHandler({
  channel: SESSION_IPC_CHANNELS.create,
  handler: async (_event, baseDir: string, name: string) => store.create(baseDir, name),
});
registerUiMutationHandler({
  channel: SESSION_IPC_CHANNELS.load,
  handler: async (_event, sessionDir: string) => store.load(sessionDir),
});
```

### App Folder IPC (`ipc/appFolder/registerAppFolderIpc.ts`)

Operations on the session folder:
- `listSessions` - List valid and invalid sessions (deterministic ordering)
- `deleteSession` - Delete a session folder
- `renameSession` - Rename a session folder

Invalid sessions (schema failures) are surfaced in `invalidSessions` array rather than failing the entire list.

### Media IPC (`ipc/media/`)

- `addAsset` - Import media file to session, add to allowlist
- Media protocol allowlist management

### OBS IPC (`ipc/obs/`)

- Recording start/stop
- OBS engine initialization
- Source management

## OBS Integration

`obs/ObsEngine.ts` wraps OBS Studio Node for screen capture and recording:

### Modules

| Module | Responsibility |
|--------|----------------|
| `ObsEngine.ts` | Lifecycle state machine, recording start/stop, signal routing, finalization |
| `ObsCapture.ts` | Scene/source creation, output channel management, resource release |
| `obsIpcError.ts` | Shared IPC error signature constant (SSoT for fatal IPC detection) |
| `obsEnums.ts` | OBS Studio Node enum constants |
| `osnSurface.ts` | Verified OBS signal names |

### Robustness Patterns

- **Fatal IPC detection**: Critical OBS runtime paths (start/stop/signal/capture/release/settings) check for `"Failed to make IPC call"` errors. On detection, the engine latches `unknown` state, resolves pending operations with failure, and emits `ipc_fatal` to the renderer when failure occurs during active recording.
- **Supervisor pattern**: `ObsCapture` reports fatal IPC errors to `ObsEngine` via the `ObsCaptureIpcSupervisor` interface. Single-report guarantee via `fatalIpcReported` flag per session.
- **Two-phase stop timeout**: 30s warning (diagnostic log only), 180s hard timeout (fail-closed with `stop_timeout`).
- **Idempotent start/stop promises**: Concurrent callers receive the same in-flight promise.
- **Output source detachment**: `ObsCapture.release()` detaches output channels before releasing sources, with per-resource error collection.
- **App quit cleanup**: `shutdownObsEngineForAppExit()` in `obsIpc.ts` runs graceful shutdown with force-reset fallback during Electron `before-quit`.
- **Shutdown ordering**: `InitShutdownSequence()` before `IPC.disconnect()` in all teardown paths.
- **Rename retry**: `renameRecordingWithRetry()` retries file moves on transient OS lock errors (`EPERM`, `EBUSY`, `EACCES`, `ENOENT`).
- **Signal callback isolation**: `handleOutputSignal` wraps the entire callback in try/catch, routing unexpected errors through fatal IPC handling.

## Custom Media Protocol

`mediaProtocol.ts` registers a custom `sessionmap-media://` protocol for secure video playback:
- Only allowlisted paths can be served
- Paths are added to allowlist when media is imported
- Prevents arbitrary file access from renderer

## Security

- `contextIsolation: true` - Renderer cannot access Node.js
- `nodeIntegration: false` - No require() in renderer
- `sandbox: true` - Renderer runs in sandboxed process
- Preload script exposes typed API via `contextBridge`
- Media protocol uses explicit allowlist
