// src/shared/ipc/channels.ts
// IPC channel name constants - shared between main and preload
// This module must remain dependency-free (no main-process imports)

export const OBS_IPC_CHANNELS = {
  initialize: 'obs:initialize',
  startRecording: 'obs:start-recording',
  stopRecording: 'obs:stop-recording',
  shutdown: 'obs:shutdown',
  getStatus: 'obs:get-status',
  forceReset: 'obs:force-reset',
} as const;

export const OBS_IPC_EVENTS = {
  recordingUnexpectedStop: 'obs:recording-unexpected-stop',
} as const;

export const MEDIA_IPC_CHANNELS = {
  addAsset: 'media:add-asset',
  getMetadata: 'media:get-metadata',
  getVideoInfo: 'media:get-video-info',
} as const;

export const DIALOG_IPC_CHANNELS = {
  pickDirectory: 'dialog:pick-directory',
  pickMediaFiles: 'dialog:pick-media-files',
} as const;

export const SESSION_IPC_CHANNELS = {
  create: 'session:create',
  load: 'session:load',
  save: 'session:save',
  close: 'session:close',
  get: 'session:get',
  rename: 'session:rename',
  hasActive: 'session:has-active',
  getSessionDir: 'session:get-session-dir',
  addRecordingSegment: 'session:add-recording-segment',
  getAccumulatedSessionTime: 'session:get-accumulated-session-time',
  setInProgressRecording: 'session:set-in-progress-recording',
  clearInProgressRecording: 'session:clear-in-progress-recording',
  cleanupInterruptedRecording: 'session:cleanup-interrupted-recording',
  hasInProgressRecording: 'session:has-in-progress-recording',
  addMediaAsset: 'session:add-media-asset',
  removeMediaAsset: 'session:remove-media-asset',
  getMediaReferenceCount: 'session:get-media-reference-count',
  addBucket: 'session:add-bucket',
  updateBucket: 'session:update-bucket',
  removeBucket: 'session:remove-bucket',
  forceRemoveBucket: 'session:force-remove-bucket',
  getBucketReferenceCount: 'session:get-bucket-reference-count',
  reorderBucket: 'session:reorder-bucket',
  addTag: 'session:add-tag',
  updateTag: 'session:update-tag',
  removeTag: 'session:remove-tag',
  forceRemoveTag: 'session:force-remove-tag',
  getTagReferenceCount: 'session:get-tag-reference-count',
  addMarker: 'session:add-marker',
  updateMarker: 'session:update-marker',
  removeMarker: 'session:remove-marker',
  addPlaybackEvent: 'session:add-playback-event',
  setTranscriptRef: 'session:set-transcript-ref',
  setPlaybackState: 'session:set-playback-state',
  exportMarkerStill: 'session:export-marker-still',
  exportMarkerClip: 'session:export-marker-clip',
  exportGroupClip: 'session:export-group-clip',
} as const;

export const SESSION_IPC_EVENTS = {
  uiSnapshot: 'session:ui-snapshot',
} as const;

export const WINDOW_IPC_CHANNELS = {
  minimize: 'window:minimize',
  maximize: 'window:maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
} as const;

export const APP_FOLDER_IPC_CHANNELS = {
  get: 'app-folder:get',
  ensure: 'app-folder:ensure',
  listSessions: 'app-folder:list-sessions',
  deleteSession: 'app-folder:delete-session',
  renameSession: 'app-folder:rename-session',
} as const;
