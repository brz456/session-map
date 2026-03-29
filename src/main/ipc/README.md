# IPC Handlers

Electron IPC handler registration for main process operations.

## Structure

```
ipc/
  registerIpc.ts                  # Central registration entry point
  session/
    registerSessionIpc.ts         # All session operations
    registerUiMutationHandler.ts  # Wrapper for UI-broadcasting handlers
    broadcastSessionUi.ts         # Broadcast SessionUiEvent to windows
  appFolder/
    registerAppFolderIpc.ts       # App folder operations (list, delete, rename)
  media/
    mediaIpc.ts                   # Media file import
  obs/
    obsIpc.ts                     # OBS recording control
  dialog/
    dialogIpc.ts                  # Native dialogs
```

## Registration Flow

`registerIpc.ts` is called during app startup:

```typescript
export async function registerIpcHandlers(): Promise<void> {
  await registerSessionIpcHandlers();
  registerAppFolderIpcHandlers();
  registerMediaIpcHandlers();
  registerObsIpcHandlers();
  registerDialogIpcHandlers();
}
```

## Session IPC

`session/registerSessionIpc.ts` registers handlers for all session operations:

- Lifecycle: create, load, close, save, rename, get, hasActive
- Recording: addRecordingSegment, setInProgressRecording, cleanup
- Media: addMediaAsset, removeMediaAsset
- Buckets: add, update, remove, forceRemove, reorder, getReferenceCount
- Tags: add, update, remove, forceRemove, getReferenceCount
- Markers: add, update, remove
- Telemetry: addPlaybackEvent
- Playback: setPlaybackState
- Transcript: setTranscriptRef
- Export: exportMarkerStill, exportMarkerClip, exportGroupClip

### UI Mutation Handler

UI-relevant operations are registered via `registerUiMutationHandler()`:

```typescript
registerUiMutationHandler({
  channel: SESSION_IPC_CHANNELS.addMarker,
  handler: async (_, marker) => store.addMarker(marker),
  // broadcastUi defaults to true
});
```

On success, it automatically broadcasts a `SessionUiEvent`:

1. Handler executes and returns `{ ok: true, ... }`
2. Wrapper calls `store.getUi()` to get current snapshot
3. Wrapper calls `broadcastSessionUiEvent(event)` to all windows
4. Original result is returned to renderer

**Opt-out**: Telemetry and export handlers set `broadcastUi: false`:

```typescript
registerUiMutationHandler({
  channel: SESSION_IPC_CHANNELS.addPlaybackEvent,
  handler: async (_, event) => store.addPlaybackEvent(event),
  broadcastUi: false,  // High-frequency; no UI changes
});
```

### Broadcast

`broadcastSessionUi.ts` sends events to all renderer windows:

```typescript
export function broadcastSessionUiEvent(event: SessionUiEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(SESSION_IPC_EVENTS.uiSnapshot, event);
  }
}
```

## App Folder IPC

`appFolder/registerAppFolderIpc.ts` handles session folder operations:

- `listSessions` - List valid sessions + invalid sessions (schema failures)
- `deleteSession` - Delete session folder
- `renameSession` - Rename session folder

**Invalid session handling**: Sessions that fail validation are returned in `invalidSessions` array with error details, rather than failing the entire list.

## Media IPC

`media/mediaIpc.ts`:

- `addAsset` - Validate/canonicalize an absolute media file path, read video metadata, add to protocol allowlist, and return a MediaAsset (no file copying)

## OBS IPC

`obs/obsIpc.ts`:

- `initialize` - Initialize OBS engine
- `startRecording` - Start OBS recording
- `stopRecording` - Stop OBS recording
- `shutdown` - Shutdown OBS engine
- `getStatus` - Get current OBS status
- `forceReset` - Force reset OBS state
- `shutdownObsEngineForAppExit()` - Best-effort OBS cleanup for app quit (graceful shutdown with force-reset fallback; called from `before-quit` handler in `app/main.ts`)

## Dialog IPC

`dialog/dialogIpc.ts`:

- `showOpenDialog` - Native file open dialog
- `showSaveDialog` - Native file save dialog
- `showMessageBox` - Native message box

## Handler Pattern

All handlers follow a consistent result pattern:

```typescript
type IpcResult<T> =
  | { ok: true } & T
  | { ok: false; code: string; message: string };
```

Example:

```typescript
ipcMain.handle(SESSION_IPC_CHANNELS.addMarker, async (_, marker) => {
  const store = getSessionStore();
  return store.addMarker(marker);
  // Returns: { ok: true, markerId: string } or { ok: false, code, message }
});
```
