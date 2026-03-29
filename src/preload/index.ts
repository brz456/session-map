// src/preload/index.ts
// Preload script: exposes IPC channels to renderer via contextBridge

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

// Import channel constants from shared (dependency-free module)
import {
  OBS_IPC_CHANNELS,
  OBS_IPC_EVENTS,
  MEDIA_IPC_CHANNELS,
  SESSION_IPC_CHANNELS,
  SESSION_IPC_EVENTS,
  DIALOG_IPC_CHANNELS,
  WINDOW_IPC_CHANNELS,
  APP_FOLDER_IPC_CHANNELS,
} from '../shared/ipc/channels';

// Import shared types for API type definitions (all from shared for clean layering)
import type {
  ObsInitOptions,
  ObsInitResult,
  ObsStartResult,
  ObsStopResult,
  ObsStatus,
  ObsShutdownResult,
  ObsForceResetResult,
  MediaAddAssetResult,
  MediaGetMetadataResult,
  MediaGetVideoInfoResult,
  SessionCreateResult,
  SessionLoadResult,
  SessionSaveResult,
  SessionCloseResult,
  SessionGetResult,
  SessionUpdateResult,
  AccumulatedSessionTimeResult,
  MediaReferenceCountResult,
  MarkerStillExportResult,
  MarkerClipExportResult,
  GroupClipExportResult,
  DialogPickDirectoryResult,
  DialogPickMediaFilesResult,
  AppFolderGetResult,
  AppFolderEnsureResult,
  AppFolderListSessionsResult,
  AppFolderDeleteSessionResult,
  AppFolderRenameSessionResult,
  ObsUnexpectedStopEvent,
} from '../shared/ipc/types';
import type {
  MediaAsset,
  Bucket,
  Tag,
  PlaybackEvent,
  Marker,
  MarkerDrawing,
  TranscriptRef,
  RecordingSegment,
} from '../shared/sessionPackage/types';
import type { SessionUiEvent } from '../shared/ipc/sessionUi';

let nextUiSnapshotSubscriptionId = 1;
const uiSnapshotHandlers = new Map<
  number,
  (_event: IpcRendererEvent, event: SessionUiEvent) => void
>();

let nextObsUnexpectedStopSubscriptionId = 1;
const obsUnexpectedStopHandlers = new Map<
  number,
  (_event: IpcRendererEvent, event: ObsUnexpectedStopEvent) => void
>();

/**
 * OBS API exposed to renderer
 */
const obsApi = {
  initialize: (options: ObsInitOptions): Promise<ObsInitResult> =>
    ipcRenderer.invoke(OBS_IPC_CHANNELS.initialize, options),

  startRecording: (): Promise<ObsStartResult> =>
    ipcRenderer.invoke(OBS_IPC_CHANNELS.startRecording),

  stopRecording: (): Promise<ObsStopResult> =>
    ipcRenderer.invoke(OBS_IPC_CHANNELS.stopRecording),

  shutdown: (): Promise<ObsShutdownResult> =>
    ipcRenderer.invoke(OBS_IPC_CHANNELS.shutdown),

  getStatus: (): Promise<ObsStatus> =>
    ipcRenderer.invoke(OBS_IPC_CHANNELS.getStatus),

  forceReset: (): Promise<ObsForceResetResult> =>
    ipcRenderer.invoke(OBS_IPC_CHANNELS.forceReset),

  subscribeUnexpectedStop: (cb: (event: ObsUnexpectedStopEvent) => void): number => {
    const subscriptionId = nextObsUnexpectedStopSubscriptionId;
    nextObsUnexpectedStopSubscriptionId += 1;
    const handler = (_event: IpcRendererEvent, event: ObsUnexpectedStopEvent) => {
      cb(event);
    };
    obsUnexpectedStopHandlers.set(subscriptionId, handler);
    ipcRenderer.on(OBS_IPC_EVENTS.recordingUnexpectedStop, handler);
    return subscriptionId;
  },

  unsubscribeUnexpectedStop: (subscriptionId: number): void => {
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      throw new Error(`Invalid obs unexpected-stop subscription id: ${subscriptionId}`);
    }
    const handler = obsUnexpectedStopHandlers.get(subscriptionId);
    if (!handler) {
      throw new Error(`Unknown obs unexpected-stop subscription id: ${subscriptionId}`);
    }
    ipcRenderer.removeListener(OBS_IPC_EVENTS.recordingUnexpectedStop, handler);
    obsUnexpectedStopHandlers.delete(subscriptionId);
  },
};

/**
 * Media API exposed to renderer
 *
 * To add media to a session:
 * 1. Call media.addAsset() to get a validated/canonicalized MediaAsset
 * 2. Call session.addMediaAsset() to append it to the active session
 */
const mediaApi = {
  addAsset: (absolutePath: string, displayName?: string): Promise<MediaAddAssetResult> =>
    ipcRenderer.invoke(MEDIA_IPC_CHANNELS.addAsset, absolutePath, displayName),

  getMetadata: (absolutePath: string): Promise<MediaGetMetadataResult> =>
    ipcRenderer.invoke(MEDIA_IPC_CHANNELS.getMetadata, absolutePath),

  getVideoInfo: (absolutePath: string): Promise<MediaGetVideoInfoResult> =>
    ipcRenderer.invoke(MEDIA_IPC_CHANNELS.getVideoInfo, absolutePath),
};

/**
 * Session API exposed to renderer
 */
const sessionApi = {
  create: (baseDir: string, name: string): Promise<SessionCreateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.create, baseDir, name),

  load: (sessionDir: string): Promise<SessionLoadResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.load, sessionDir),

  save: (): Promise<SessionSaveResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.save),

  close: (): Promise<SessionCloseResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.close),

  get: (): Promise<SessionGetResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.get),

  rename: (newName: string): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.rename, newName),

  hasActive: (): Promise<boolean> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.hasActive),

  getSessionDir: (): Promise<string | null> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.getSessionDir),

  addRecordingSegment: (segment: RecordingSegment): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.addRecordingSegment, segment),

  getAccumulatedSessionTime: (): Promise<AccumulatedSessionTimeResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.getAccumulatedSessionTime),

  setInProgressRecording: (id: string, startSessionTimeSec: number): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.setInProgressRecording, id, startSessionTimeSec),

  clearInProgressRecording: (): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.clearInProgressRecording),

  cleanupInterruptedRecording: (): Promise<SessionUpdateResult & { markersRemoved?: number; eventsRemoved?: number }> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.cleanupInterruptedRecording),

  hasInProgressRecording: (): Promise<boolean> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.hasInProgressRecording),

  addMediaAsset: (asset: MediaAsset): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.addMediaAsset, asset),

  removeMediaAsset: (mediaId: string): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.removeMediaAsset, mediaId),

  getMediaReferenceCount: (mediaId: string): Promise<MediaReferenceCountResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.getMediaReferenceCount, mediaId),

  addBucket: (bucket: Bucket): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.addBucket, bucket),

  updateBucket: (
    bucketId: string,
    patch: Partial<Pick<Bucket, 'title' | 'description' | 'sortIndex'>>
  ): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.updateBucket, bucketId, patch),

  removeBucket: (bucketId: string): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.removeBucket, bucketId),

  getBucketReferenceCount: (bucketId: string): Promise<{ ok: true; count: number } | { ok: false; code: string; message: string }> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.getBucketReferenceCount, bucketId),

  forceRemoveBucket: (bucketId: string): Promise<SessionUpdateResult & { affectedMarkers?: number }> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.forceRemoveBucket, bucketId),

  reorderBucket: (bucketId: string, newIndex: number): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.reorderBucket, bucketId, newIndex),

  addTag: (tag: Tag): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.addTag, tag),

  updateTag: (
    tagId: string,
    patch: Partial<Pick<Tag, 'name' | 'color'>>
  ): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.updateTag, tagId, patch),

  removeTag: (tagId: string): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.removeTag, tagId),

  getTagReferenceCount: (tagId: string): Promise<{ ok: true; count: number } | { ok: false; code: string; message: string }> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.getTagReferenceCount, tagId),

  forceRemoveTag: (tagId: string): Promise<SessionUpdateResult & { affectedMarkers?: number }> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.forceRemoveTag, tagId),

  addMarker: (marker: Marker): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.addMarker, marker),

  updateMarker: (
    markerId: string,
    patch: Partial<Pick<Marker, 'bucketId' | 'tagIds' | 'importance' | 'note'>> & {
      drawing?: MarkerDrawing | null;
      mediaTimeSec?: number;
      groupId?: string | null;
    }
  ): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.updateMarker, markerId, patch),

  removeMarker: (markerId: string): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.removeMarker, markerId),

  exportMarkerStill: (markerId: string, overlayPngBase64: string | null): Promise<MarkerStillExportResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.exportMarkerStill, markerId, overlayPngBase64),

  exportMarkerClip: (markerId: string, videoDurationSec: number, radiusSec: number): Promise<MarkerClipExportResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.exportMarkerClip, markerId, videoDurationSec, radiusSec),

  exportGroupClip: (
    groupId: string,
    mediaId: string,
    startSec: number,
    endSec: number,
    videoDurationSec: number
  ): Promise<GroupClipExportResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.exportGroupClip, groupId, mediaId, startSec, endSec, videoDurationSec),

  addPlaybackEvent: (event: PlaybackEvent): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.addPlaybackEvent, event),

  setTranscriptRef: (ref: TranscriptRef | null): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.setTranscriptRef, ref),

  setPlaybackState: (state: { activeMediaId: string | null; mediaPositions: Record<string, number> }): Promise<SessionUpdateResult> =>
    ipcRenderer.invoke(SESSION_IPC_CHANNELS.setPlaybackState, state),

  subscribeUiSnapshot: (cb: (event: SessionUiEvent) => void): number => {
    const subscriptionId = nextUiSnapshotSubscriptionId;
    nextUiSnapshotSubscriptionId += 1;
    const handler = (_event: IpcRendererEvent, event: SessionUiEvent) => {
      cb(event);
    };
    uiSnapshotHandlers.set(subscriptionId, handler);
    ipcRenderer.on(SESSION_IPC_EVENTS.uiSnapshot, handler);
    return subscriptionId;
  },
  unsubscribeUiSnapshot: (subscriptionId: number): void => {
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      throw new Error(`Invalid ui snapshot subscription id: ${subscriptionId}`);
    }
    const handler = uiSnapshotHandlers.get(subscriptionId);
    if (!handler) {
      throw new Error(`Unknown ui snapshot subscription id: ${subscriptionId}`);
    }
    ipcRenderer.removeListener(SESSION_IPC_EVENTS.uiSnapshot, handler);
    uiSnapshotHandlers.delete(subscriptionId);
  },
};

/**
 * Dialog API exposed to renderer
 */
const dialogApi = {
  pickDirectory: (): Promise<DialogPickDirectoryResult> =>
    ipcRenderer.invoke(DIALOG_IPC_CHANNELS.pickDirectory),

  pickMediaFiles: (): Promise<DialogPickMediaFilesResult> =>
    ipcRenderer.invoke(DIALOG_IPC_CHANNELS.pickMediaFiles),
};

/**
 * Window control API exposed to renderer
 */
const windowApi = {
  minimize: (): Promise<void> =>
    ipcRenderer.invoke(WINDOW_IPC_CHANNELS.minimize),

  maximize: (): Promise<void> =>
    ipcRenderer.invoke(WINDOW_IPC_CHANNELS.maximize),

  close: (): Promise<void> =>
    ipcRenderer.invoke(WINDOW_IPC_CHANNELS.close),

  isMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke(WINDOW_IPC_CHANNELS.isMaximized),
};

/**
 * App folder API exposed to renderer
 */
const appFolderApi = {
  get: (): Promise<AppFolderGetResult> =>
    ipcRenderer.invoke(APP_FOLDER_IPC_CHANNELS.get),

  ensure: (): Promise<AppFolderEnsureResult> =>
    ipcRenderer.invoke(APP_FOLDER_IPC_CHANNELS.ensure),

  listSessions: (): Promise<AppFolderListSessionsResult> =>
    ipcRenderer.invoke(APP_FOLDER_IPC_CHANNELS.listSessions),

  deleteSession: (sessionDir: string): Promise<AppFolderDeleteSessionResult> =>
    ipcRenderer.invoke(APP_FOLDER_IPC_CHANNELS.deleteSession, sessionDir),

  renameSession: (sessionDir: string, newName: string): Promise<AppFolderRenameSessionResult> =>
    ipcRenderer.invoke(APP_FOLDER_IPC_CHANNELS.renameSession, sessionDir, newName),
};

/**
 * Combined API exposed to renderer via window.api
 */
const api = {
  obs: obsApi,
  media: mediaApi,
  session: sessionApi,
  dialog: dialogApi,
  window: windowApi,
  appFolder: appFolderApi,
};

// Expose to renderer
contextBridge.exposeInMainWorld('api', api);

// Type declaration for renderer access
export type SessionMapApi = typeof api;

declare global {
  interface Window {
    api: SessionMapApi;
  }
}
