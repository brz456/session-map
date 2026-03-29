# Preload Script

The preload script bridges the main process and renderer process via Electron's `contextBridge`. It exposes a typed IPC API to the renderer as `window.api`.

## Structure

```
preload/
  index.ts    # Preload entry point, exposes window.api
```

## Security Model

The preload runs in an isolated context with access to Electron's `ipcRenderer` and `contextBridge` (not full Node.js APIs), and exposes a narrow typed API to the sandboxed renderer:

- `contextIsolation: true` - Renderer and preload have separate JavaScript contexts
- `nodeIntegration: false` - Neither renderer nor preload can use `require()` or Node.js APIs
- `sandbox: true` - Both preload and renderer run in sandboxed processes

The preload uses `contextBridge.exposeInMainWorld()` to safely expose IPC methods to the renderer.

## Exposed API

The renderer accesses IPC via `window.api`:

```typescript
window.api.obs.*        // OBS recording control
window.api.media.*      // Media file operations
window.api.session.*    // Session CRUD and mutations
window.api.dialog.*     // Native file dialogs
window.api.window.*     // Window controls (minimize, maximize, close)
window.api.appFolder.*  // App folder operations
```

### OBS API (`window.api.obs`)

```typescript
initialize(options: ObsInitOptions): Promise<ObsInitResult>
startRecording(): Promise<ObsStartResult>
stopRecording(): Promise<ObsStopResult>
shutdown(): Promise<ObsShutdownResult>
getStatus(): Promise<ObsStatus>
forceReset(): Promise<ObsForceResetResult>
```

### Media API (`window.api.media`)

```typescript
addAsset(absolutePath: string, displayName?: string): Promise<MediaAddAssetResult>
getMetadata(absolutePath: string): Promise<MediaGetMetadataResult>
getVideoInfo(absolutePath: string): Promise<MediaGetVideoInfoResult>
```

### Session API (`window.api.session`)

Lifecycle:
```typescript
create(baseDir: string, name: string): Promise<SessionCreateResult>
load(sessionDir: string): Promise<SessionLoadResult>
save(): Promise<SessionSaveResult>
close(): Promise<SessionCloseResult>
get(): Promise<SessionGetResult>
rename(newName: string): Promise<SessionUpdateResult>
hasActive(): Promise<boolean>
getSessionDir(): Promise<string | null>
```

Recording:
```typescript
addRecordingSegment(segment: RecordingSegment): Promise<SessionUpdateResult>
getAccumulatedSessionTime(): Promise<AccumulatedSessionTimeResult>
setInProgressRecording(id: string, startSessionTimeSec: number): Promise<SessionUpdateResult>
clearInProgressRecording(): Promise<SessionUpdateResult>
cleanupInterruptedRecording(): Promise<SessionUpdateResult & { markersRemoved?: number; eventsRemoved?: number }>
hasInProgressRecording(): Promise<boolean>
```

Media assets:
```typescript
addMediaAsset(asset: MediaAsset): Promise<SessionUpdateResult>
removeMediaAsset(mediaId: string): Promise<SessionUpdateResult>
```

Buckets:
```typescript
addBucket(bucket: Bucket): Promise<SessionUpdateResult>
updateBucket(bucketId: string, patch: Partial<Pick<Bucket, 'title' | 'description' | 'sortIndex'>>): Promise<SessionUpdateResult>
removeBucket(bucketId: string): Promise<SessionUpdateResult>
getBucketReferenceCount(bucketId: string): Promise<{ ok: true; count: number } | { ok: false; ... }>
forceRemoveBucket(bucketId: string): Promise<SessionUpdateResult & { affectedMarkers?: number }>
reorderBucket(bucketId: string, newIndex: number): Promise<SessionUpdateResult>
```

Tags:
```typescript
addTag(tag: Tag): Promise<SessionUpdateResult>
updateTag(tagId: string, patch: Partial<Pick<Tag, 'name' | 'color'>>): Promise<SessionUpdateResult>
removeTag(tagId: string): Promise<SessionUpdateResult>
getTagReferenceCount(tagId: string): Promise<{ ok: true; count: number } | { ok: false; ... }>
forceRemoveTag(tagId: string): Promise<SessionUpdateResult & { affectedMarkers?: number }>
```

Markers:
```typescript
addMarker(marker: Marker): Promise<SessionUpdateResult>
updateMarker(markerId: string, patch: /* inline patch type */): Promise<SessionUpdateResult>
removeMarker(markerId: string): Promise<SessionUpdateResult>
```

Export:
```typescript
exportMarkerStill(markerId: string, overlayPngBase64: string | null): Promise<MarkerStillExportResult>
exportMarkerClip(markerId: string, videoDurationSec: number, radiusSec: number): Promise<MarkerClipExportResult>
exportGroupClip(groupId: string, mediaId: string, startSec: number, endSec: number, videoDurationSec: number): Promise<GroupClipExportResult>
```

Telemetry/Playback:
```typescript
addPlaybackEvent(event: PlaybackEvent): Promise<SessionUpdateResult>
setTranscriptRef(ref: TranscriptRef | null): Promise<SessionUpdateResult>
setPlaybackState(state: { activeMediaId: string | null; mediaPositions: Record<string, number> }): Promise<SessionUpdateResult>
```

UI Snapshot subscription:
```typescript
subscribeUiSnapshot(cb: (event: SessionUiEvent) => void): number
unsubscribeUiSnapshot(subscriptionId: number): void
```

### Dialog API (`window.api.dialog`)

```typescript
pickDirectory(): Promise<DialogPickDirectoryResult>
pickMediaFiles(): Promise<DialogPickMediaFilesResult>
```

### Window API (`window.api.window`)

```typescript
minimize(): Promise<void>
maximize(): Promise<void>
close(): Promise<void>
isMaximized(): Promise<boolean>
```

### App Folder API (`window.api.appFolder`)

```typescript
get(): Promise<AppFolderGetResult>
ensure(): Promise<AppFolderEnsureResult>
listSessions(): Promise<AppFolderListSessionsResult>
deleteSession(sessionDir: string): Promise<AppFolderDeleteSessionResult>
renameSession(sessionDir: string, newName: string): Promise<AppFolderRenameSessionResult>
```

## UI Snapshot Subscription

The session API includes a subscription mechanism for receiving `SessionUiEvent` broadcasts:

```typescript
// Subscribe
const subscriptionId = window.api.session.subscribeUiSnapshot((event) => {
  if (event.uiRevision > lastAppliedRevision) {
    applySnapshot(event.session);
  }
});

// Unsubscribe (cleanup)
window.api.session.unsubscribeUiSnapshot(subscriptionId);
```

Subscriptions are tracked by numeric ID and must be explicitly unsubscribed to prevent memory leaks.

## Type Export

The preload exports `SessionMapApi` type for use in the renderer:

```typescript
export type SessionMapApi = typeof api;

declare global {
  interface Window {
    api: SessionMapApi;
  }
}
```

The renderer accesses this type via `src/renderer/app/rendererApi.ts`:

```typescript
export type RendererApi = Window['api'];
```
