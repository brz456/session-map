// src/main/ipc/session/registerSessionIpc.ts
// IPC handlers for session operations
//
// NOTE: To add media to a session:
// 1. Call media:add-asset (mediaIpc.ts) to get a validated/canonicalized MediaAsset
// 2. Call session:add-media-asset to append it to the active session

import { ipcMain } from 'electron';
import * as path from 'path';
import { getSessionStore } from '../../session/sessionStoreInstance';
import { registerUiMutationHandler } from './registerUiMutationHandler';
import type {
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
} from '../../../shared/ipc/types';
import {
  exportMarkerStill,
  exportMarkerClip,
  exportGroupClip,
} from '../../export/markerStillExport';
import {
  MediaAsset,
  Bucket,
  Tag,
  PlaybackEvent,
  PlaybackEventType,
  PLAYBACK_EVENT_TYPES,
  Marker,
  MARKER_SOURCE_TYPES,
  PlaybackSnapshot,
  TranscriptRef,
  RecordingSegment,
} from '../../../shared/sessionPackage/types';
import { SESSION_IPC_CHANNELS } from '../../../shared/ipc/channels';
import {
  addAllowedMediaFile,
  removeAllowedMediaFile,
  clearAllowedMediaFiles,
} from '../../mediaProtocol';
import {
  hasSupportedMediaExtension,
  isSupportedMediaExtension,
  SUPPORTED_MEDIA_EXTENSIONS,
} from '../../../shared/mediaExtensions';

const VALID_EVENT_TYPES = new Set<PlaybackEventType>(PLAYBACK_EVENT_TYPES);
const VALID_MARKER_SOURCE_TYPES = new Set<string>(MARKER_SOURCE_TYPES);

const SUPPORTED_EXTENSION_LABEL = SUPPORTED_MEDIA_EXTENSIONS.join(', ');

const handlers: Record<keyof typeof SESSION_IPC_CHANNELS, () => void> = {
  create: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.create,
      handler: async (_event, baseDir: string, name: string): Promise<SessionCreateResult> => {
        if (typeof baseDir !== 'string') {
          return {
            ok: false,
            code: 'invalid_session_path',
            message: 'baseDir must be a string',
          };
        }
        if (typeof name !== 'string' || !name.trim()) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'name must be a non-empty string',
          };
        }
        const store = getSessionStore();
        return store.create(baseDir, name.trim());
      },
    });
  },
  load: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.load,
      handler: async (_event, sessionDir: string): Promise<SessionLoadResult> => {
        if (typeof sessionDir !== 'string') {
          return {
            ok: false,
            code: 'invalid_session_path',
            message: 'sessionDir must be a string',
          };
        }
        const store = getSessionStore();
        const result = await store.load(sessionDir);

        // Add existing media assets to protocol allowlist
        if (result.ok) {
          clearAllowedMediaFiles(); // Clear any stale entries
          for (const asset of result.session.media.assets) {
            addAllowedMediaFile(asset.absolutePath);
          }
        }
        return result;
      },
    });
  },
  save: () => {
    ipcMain.handle(
      SESSION_IPC_CHANNELS.save,
      async (): Promise<SessionSaveResult> => {
        const store = getSessionStore();
        return store.save();
      }
    );
  },
  close: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.close,
      handler: (): SessionCloseResult => {
        const store = getSessionStore();
        const result = store.close();
        // Clear media allowlist when session is closed
        clearAllowedMediaFiles();
        return result;
      },
    });
  },
  get: () => {
    ipcMain.handle(SESSION_IPC_CHANNELS.get, (): SessionGetResult => {
      const store = getSessionStore();
      return store.getUi();
    });
  },
  rename: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.rename,
      handler: (_event, newName: string): SessionUpdateResult => {
        if (typeof newName !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'newName must be a string',
          };
        }
        const store = getSessionStore();
        return store.rename(newName);
      },
    });
  },
  hasActive: () => {
    ipcMain.handle(SESSION_IPC_CHANNELS.hasActive, (): boolean => {
      const store = getSessionStore();
      return store.hasActiveSession();
    });
  },
  getSessionDir: () => {
    ipcMain.handle(SESSION_IPC_CHANNELS.getSessionDir, (): string | null => {
      const store = getSessionStore();
      return store.getSessionDir();
    });
  },
  addRecordingSegment: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.addRecordingSegment,
      handler: (_event, segment: RecordingSegment): SessionUpdateResult => {
        // Validate segment shape at IPC boundary (fail-closed)
        if (!segment || typeof segment !== 'object') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment must be an object',
          };
        }
        if (typeof segment.id !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.id must be a string',
          };
        }
        if (typeof segment.file !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.file must be a string',
          };
        }
        if (segment.file.includes('\\')) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.file must use forward slashes only (no backslashes)',
          };
        }
        if (!segment.file.startsWith('recording/')) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.file must start with "recording/"',
          };
        }
        const filename = segment.file.slice('recording/'.length);
        if (filename === '' || filename.startsWith('/') || filename.endsWith('/')) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.file must have a non-empty filename after "recording/"',
          };
        }
        if (/(^|\/)\.\.($|\/)/.test(segment.file)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.file must not contain path traversal (..)',
          };
        }
        if (!hasSupportedMediaExtension(segment.file)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: `segment.file must have extension ${SUPPORTED_EXTENSION_LABEL}`,
          };
        }
        if (typeof segment.startSessionTimeSec !== 'number' || !Number.isInteger(segment.startSessionTimeSec)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.startSessionTimeSec must be an integer',
          };
        }
        if (segment.startSessionTimeSec < 0) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.startSessionTimeSec must be non-negative',
          };
        }
        if (typeof segment.durationSec !== 'number' || !Number.isInteger(segment.durationSec)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.durationSec must be an integer',
          };
        }
        if (segment.durationSec < 0) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'segment.durationSec must be non-negative',
          };
        }

        const store = getSessionStore();
        return store.addRecordingSegment(segment);
      },
    });
  },
  getAccumulatedSessionTime: () => {
    ipcMain.handle(
      SESSION_IPC_CHANNELS.getAccumulatedSessionTime,
      (): AccumulatedSessionTimeResult => {
        const store = getSessionStore();
        return store.getAccumulatedSessionTime();
      }
    );
  },
  setInProgressRecording: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.setInProgressRecording,
      handler: (_event, id: string, startSessionTimeSec: number): SessionUpdateResult => {
        if (typeof id !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'id must be a string',
          };
        }
        if (typeof startSessionTimeSec !== 'number') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'startSessionTimeSec must be a number',
          };
        }
        if (!id.trim()) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'id must be a non-empty string',
          };
        }
        if (!Number.isFinite(startSessionTimeSec) || !Number.isInteger(startSessionTimeSec)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'startSessionTimeSec must be an integer',
          };
        }
        if (startSessionTimeSec < 0) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'startSessionTimeSec must be non-negative',
          };
        }
        const store = getSessionStore();
        return store.setInProgressRecording(id, startSessionTimeSec);
      },
    });
  },
  clearInProgressRecording: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.clearInProgressRecording,
      handler: (): SessionUpdateResult => {
        const store = getSessionStore();
        return store.clearInProgressRecording();
      },
    });
  },
  cleanupInterruptedRecording: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.cleanupInterruptedRecording,
      handler: (): SessionUpdateResult & { markersRemoved?: number; eventsRemoved?: number } => {
        const store = getSessionStore();
        return store.cleanupInterruptedRecording();
      },
    });
  },
  hasInProgressRecording: () => {
    ipcMain.handle(SESSION_IPC_CHANNELS.hasInProgressRecording, (): boolean => {
      const store = getSessionStore();
      return store.hasInProgressRecording();
    });
  },
  addMediaAsset: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.addMediaAsset,
      handler: (_event, asset: MediaAsset): SessionUpdateResult => {
        // Validate asset shape at IPC boundary (fail-closed)
        if (!asset || typeof asset !== 'object') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'asset must be an object',
          };
        }
        if (typeof asset.mediaId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'asset.mediaId must be a string',
          };
        }
        if (typeof asset.displayName !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'asset.displayName must be a string',
          };
        }
        if (typeof asset.absolutePath !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'asset.absolutePath must be a string',
          };
        }
        if (asset.durationSec !== undefined) {
          if (typeof asset.durationSec !== 'number' || !Number.isFinite(asset.durationSec)) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'asset.durationSec must be a finite number if provided',
            };
          }
        }
        if (asset.createdAtIso !== undefined) {
          if (typeof asset.createdAtIso !== 'string') {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'asset.createdAtIso must be a string if provided',
            };
          }
          if (!Number.isFinite(Date.parse(asset.createdAtIso))) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'asset.createdAtIso must be a valid ISO timestamp if provided',
            };
          }
        }

        // Validate supported file extension (shared policy)
        const extension = path.extname(asset.absolutePath).toLowerCase();
        if (!isSupportedMediaExtension(extension)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: `Unsupported media extension: ${extension}. Only ${SUPPORTED_EXTENSION_LABEL} is supported.`,
          };
        }

        const store = getSessionStore();
        const result = store.addMediaAsset(asset);
        if (result.ok) {
          addAllowedMediaFile(asset.absolutePath);
        }
        return result;
      },
    });
  },
  removeMediaAsset: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.removeMediaAsset,
      handler: (_event, mediaId: string): SessionUpdateResult => {
        if (typeof mediaId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'mediaId must be a string',
          };
        }
        const store = getSessionStore();
        let assetPathToRemove: string | null = null;
        const getResult = store.getFull();
        if (getResult.ok) {
          const asset = getResult.session.media.assets.find((a) => a.mediaId === mediaId);
          if (asset) {
            assetPathToRemove = asset.absolutePath;
          }
        }

        const result = store.removeMediaAsset(mediaId);
        if (result.ok && assetPathToRemove !== null) {
          removeAllowedMediaFile(assetPathToRemove);
        }
        return result;
      },
    });
  },
  getMediaReferenceCount: () => {
    ipcMain.handle(
      SESSION_IPC_CHANNELS.getMediaReferenceCount,
      (_event, mediaId: string): MediaReferenceCountResult => {
        if (typeof mediaId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'mediaId must be a string',
          };
        }
        const store = getSessionStore();
        return store.getMediaReferenceCount(mediaId);
      }
    );
  },
  addBucket: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.addBucket,
      handler: (_event, bucket: Bucket): SessionUpdateResult => {
        // Validate bucket shape at IPC boundary (fail-closed)
        if (!bucket || typeof bucket !== 'object') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucket must be an object',
          };
        }
        if (typeof bucket.bucketId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucket.bucketId must be a string',
          };
        }
        if (typeof bucket.title !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucket.title must be a string',
          };
        }
        if (typeof bucket.sortIndex !== 'number' || !Number.isInteger(bucket.sortIndex)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucket.sortIndex must be an integer',
          };
        }
        if (bucket.description !== undefined && typeof bucket.description !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucket.description must be a string if provided',
          };
        }

        const store = getSessionStore();
        return store.addBucket(bucket);
      },
    });
  },
  updateBucket: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.updateBucket,
      handler: (
        _event,
        bucketId: string,
        patch: Partial<Pick<Bucket, 'title' | 'description' | 'sortIndex'>>
      ): SessionUpdateResult => {
        if (typeof bucketId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucketId must be a string',
          };
        }
        if (
          patch === null ||
          typeof patch !== 'object' ||
          Array.isArray(patch) ||
          Object.getPrototypeOf(patch) !== Object.prototype
        ) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch must be a plain object',
          };
        }
        const ALLOWED_PATCH_KEYS = ['title', 'description', 'sortIndex'] as const;
        const allowedSet = new Set<string>(ALLOWED_PATCH_KEYS);
        const patchKeys = Object.keys(patch);
        const unknownKeys = patchKeys.filter((k) => !allowedSet.has(k));
        if (unknownKeys.length > 0) {
          return {
            ok: false,
            code: 'invalid_input',
            message: `patch contains unknown keys: ${unknownKeys.join(', ')}`,
          };
        }
        const hasDefinedValue = ALLOWED_PATCH_KEYS.some(
          (key) =>
            Object.prototype.hasOwnProperty.call(patch, key) &&
            patch[key] !== undefined
        );
        if (!hasDefinedValue) {
          return {
            ok: false,
            code: 'invalid_input',
            message:
              'patch must contain at least one defined value for: title, description, or sortIndex',
          };
        }
        if (patch.title !== undefined && typeof patch.title !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch.title must be a string',
          };
        }
        if (patch.description !== undefined && typeof patch.description !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch.description must be a string',
          };
        }
        if (patch.sortIndex !== undefined) {
          if (typeof patch.sortIndex !== 'number' || !Number.isInteger(patch.sortIndex)) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'patch.sortIndex must be an integer',
            };
          }
        }
        const store = getSessionStore();
        return store.updateBucket(bucketId, patch);
      },
    });
  },
  removeBucket: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.removeBucket,
      handler: (_event, bucketId: string): SessionUpdateResult => {
        if (typeof bucketId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucketId must be a string',
          };
        }
        const store = getSessionStore();
        return store.removeBucket(bucketId);
      },
    });
  },
  forceRemoveBucket: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.forceRemoveBucket,
      handler: (_event, bucketId: string): SessionUpdateResult & { affectedMarkers?: number } => {
        if (typeof bucketId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucketId must be a string',
          };
        }
        const store = getSessionStore();
        return store.forceRemoveBucket(bucketId);
      },
    });
  },
  getBucketReferenceCount: () => {
    ipcMain.handle(
      SESSION_IPC_CHANNELS.getBucketReferenceCount,
      (_event, bucketId: string): { ok: true; count: number } | { ok: false; code: string; message: string } => {
        if (typeof bucketId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucketId must be a string',
          };
        }
        const store = getSessionStore();
        return store.getBucketReferenceCount(bucketId);
      }
    );
  },
  reorderBucket: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.reorderBucket,
      handler: (_event, bucketId: string, newIndex: number): SessionUpdateResult => {
        if (typeof bucketId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'bucketId must be a string',
          };
        }
        if (typeof newIndex !== 'number' || !Number.isInteger(newIndex)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'newIndex must be an integer',
          };
        }
        const store = getSessionStore();
        return store.reorderBucket(bucketId, newIndex);
      },
    });
  },
  addTag: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.addTag,
      handler: (_event, tag: Tag): SessionUpdateResult => {
        // Validate tag shape at IPC boundary (fail-closed)
        if (!tag || typeof tag !== 'object') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'tag must be an object',
          };
        }
        if (typeof tag.tagId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'tag.tagId must be a string',
          };
        }
        if (typeof tag.name !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'tag.name must be a string',
          };
        }
        if (tag.aliases !== undefined) {
          if (!Array.isArray(tag.aliases)) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'tag.aliases must be an array if provided',
            };
          }
          for (let i = 0; i < tag.aliases.length; i++) {
            if (typeof tag.aliases[i] !== 'string') {
              return {
                ok: false,
                code: 'invalid_input',
                message: `tag.aliases[${i}] must be a string`,
              };
            }
          }
        }
        if (tag.color !== undefined && typeof tag.color !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'tag.color must be a string if provided',
          };
        }

        const store = getSessionStore();
        return store.addTag(tag);
      },
    });
  },
  updateTag: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.updateTag,
      handler: (
        _event,
        tagId: string,
        patch: Partial<Pick<Tag, 'name' | 'color'>>
      ): SessionUpdateResult => {
        if (typeof tagId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'tagId must be a string',
          };
        }
        if (
          patch === null ||
          typeof patch !== 'object' ||
          Array.isArray(patch) ||
          Object.getPrototypeOf(patch) !== Object.prototype
        ) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch must be a plain object',
          };
        }
        const ALLOWED_PATCH_KEYS = ['name', 'color'] as const;
        const allowedSet = new Set<string>(ALLOWED_PATCH_KEYS);
        const patchKeys = Object.keys(patch);
        const unknownKeys = patchKeys.filter((k) => !allowedSet.has(k));
        if (unknownKeys.length > 0) {
          return {
            ok: false,
            code: 'invalid_input',
            message: `patch contains unknown keys: ${unknownKeys.join(', ')}`,
          };
        }
        const hasDefinedValue = ALLOWED_PATCH_KEYS.some(
          (key) =>
            Object.prototype.hasOwnProperty.call(patch, key) &&
            patch[key] !== undefined
        );
        if (!hasDefinedValue) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch must contain at least one defined value for: name or color',
          };
        }
        if (patch.name !== undefined && typeof patch.name !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch.name must be a string',
          };
        }
        if (patch.color !== undefined && typeof patch.color !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch.color must be a string',
          };
        }

        const store = getSessionStore();
        return store.updateTag(tagId, patch);
      },
    });
  },
  removeTag: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.removeTag,
      handler: (_event, tagId: string): SessionUpdateResult => {
        if (typeof tagId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'tagId must be a string',
          };
        }
        const store = getSessionStore();
        return store.removeTag(tagId);
      },
    });
  },
  forceRemoveTag: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.forceRemoveTag,
      handler: (_event, tagId: string): SessionUpdateResult & { affectedMarkers?: number } => {
        if (typeof tagId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'tagId must be a string',
          };
        }
        const store = getSessionStore();
        return store.forceRemoveTag(tagId);
      },
    });
  },
  getTagReferenceCount: () => {
    ipcMain.handle(
      SESSION_IPC_CHANNELS.getTagReferenceCount,
      (_event, tagId: string): { ok: true; count: number } | { ok: false; code: string; message: string } => {
        if (typeof tagId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'tagId must be a string',
          };
        }
        const store = getSessionStore();
        return store.getTagReferenceCount(tagId);
      }
    );
  },
  addMarker: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.addMarker,
      handler: (_event, marker: Marker): SessionUpdateResult => {
        // Validate marker shape at IPC boundary (fail-closed)
        if (!marker || typeof marker !== 'object') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'marker must be an object',
          };
        }
        if (typeof marker.markerId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'marker.markerId must be a string',
          };
        }
        if (typeof marker.createdAtIso !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'marker.createdAtIso must be a string',
          };
        }
        if (marker.anchorSessionTimeSec !== null) {
          if (
            typeof marker.anchorSessionTimeSec !== 'number' ||
            !Number.isInteger(marker.anchorSessionTimeSec)
          ) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'marker.anchorSessionTimeSec must be null or an integer',
            };
          }
          if (marker.anchorSessionTimeSec < 0) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'marker.anchorSessionTimeSec must be non-negative',
            };
          }
        }
        if (
          marker.importance !== 1 &&
          marker.importance !== 2 &&
          marker.importance !== 3
        ) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'marker.importance must be 1, 2, or 3',
          };
        }
        if (typeof marker.sourceType !== 'string' || !VALID_MARKER_SOURCE_TYPES.has(marker.sourceType)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: `marker.sourceType must be one of: ${MARKER_SOURCE_TYPES.join(', ')}`,
          };
        }
        if (marker.bucketId !== null && typeof marker.bucketId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'marker.bucketId must be null or a string',
          };
        }
        if (!Array.isArray(marker.tagIds)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'marker.tagIds must be an array',
          };
        }
        for (let i = 0; i < marker.tagIds.length; i++) {
          if (typeof marker.tagIds[i] !== 'string') {
            return {
              ok: false,
              code: 'invalid_input',
              message: `marker.tagIds[${i}] must be a string`,
            };
          }
        }
        if (marker.note !== undefined && typeof marker.note !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'marker.note must be a string if provided',
          };
        }
        if (marker.groupId !== undefined) {
          if (typeof marker.groupId !== 'string' || marker.groupId === '') {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'marker.groupId must be a non-empty string if provided',
            };
          }
        }
        if (marker.playbackSnapshot === null || typeof marker.playbackSnapshot !== 'object') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'marker.playbackSnapshot must be an object',
          };
        }
        const snap = marker.playbackSnapshot as PlaybackSnapshot;
        if (
          typeof snap.playbackRate !== 'number' ||
          !Number.isFinite(snap.playbackRate) ||
          snap.playbackRate <= 0
        ) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'playbackSnapshot.playbackRate must be a finite number > 0',
          };
        }
        if (typeof snap.paused !== 'boolean') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'playbackSnapshot.paused must be a boolean',
          };
        }
        if (snap.mediaId === null) {
          if (snap.mediaTimeSec !== null) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'playbackSnapshot.mediaTimeSec must be null when mediaId is null',
            };
          }
        } else {
          if (typeof snap.mediaId !== 'string') {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'playbackSnapshot.mediaId must be null or a string',
            };
          }
          if (typeof snap.mediaTimeSec !== 'number' || !Number.isFinite(snap.mediaTimeSec)) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'playbackSnapshot.mediaTimeSec must be a finite number when mediaId is present',
            };
          }
          if (snap.mediaTimeSec < 0) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'playbackSnapshot.mediaTimeSec must be non-negative',
            };
          }
        }

        const store = getSessionStore();
        return store.addMarker(marker);
      },
    });
  },
  updateMarker: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.updateMarker,
      handler: (
        _event,
        markerId: string,
        patch: Partial<Pick<Marker, 'bucketId' | 'tagIds' | 'importance' | 'note'>> & {
          drawing?: Marker['drawing'] | null;
          mediaTimeSec?: number;
          groupId?: string | null;
        }
      ): SessionUpdateResult => {
        if (typeof markerId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'markerId must be a string',
          };
        }
        if (
          patch === null ||
          typeof patch !== 'object' ||
          Array.isArray(patch) ||
          Object.getPrototypeOf(patch) !== Object.prototype
        ) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch must be a plain object',
          };
        }
        const ALLOWED_PATCH_KEYS = [
          'bucketId',
          'tagIds',
          'importance',
          'note',
          'drawing',
          'groupId',
          'mediaTimeSec',
        ] as const;
        const allowedSet = new Set<string>(ALLOWED_PATCH_KEYS);
        const patchKeys = Object.keys(patch);
        const unknownKeys = patchKeys.filter((k) => !allowedSet.has(k));
        if (unknownKeys.length > 0) {
          return {
            ok: false,
            code: 'invalid_input',
            message: `patch contains unknown keys: ${unknownKeys.join(', ')}`,
          };
        }
        const hasDefinedValue = ALLOWED_PATCH_KEYS.some(
          (key) =>
            Object.prototype.hasOwnProperty.call(patch, key) &&
            (patch as Record<string, unknown>)[key] !== undefined
        );
        if (!hasDefinedValue) {
          return {
            ok: false,
            code: 'invalid_input',
            message:
              'patch must contain at least one defined value for: bucketId, tagIds, importance, note, drawing, groupId, or mediaTimeSec',
          };
        }
        if (patch.bucketId !== undefined && patch.bucketId !== null && typeof patch.bucketId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch.bucketId must be a string or null',
          };
        }
        if (patch.tagIds !== undefined) {
          if (!Array.isArray(patch.tagIds) || !patch.tagIds.every((id) => typeof id === 'string')) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'patch.tagIds must be an array of strings',
            };
          }
        }
        if (patch.importance !== undefined) {
          if (patch.importance !== 1 && patch.importance !== 2 && patch.importance !== 3) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'patch.importance must be 1, 2, or 3',
            };
          }
        }
        if (patch.note !== undefined && typeof patch.note !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'patch.note must be a string',
          };
        }
        if (patch.groupId !== undefined && patch.groupId !== null) {
          if (typeof patch.groupId !== 'string' || patch.groupId === '') {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'patch.groupId must be null or a non-empty string',
            };
          }
        }
        if (patch.mediaTimeSec !== undefined) {
          if (
            typeof patch.mediaTimeSec !== 'number' ||
            !Number.isFinite(patch.mediaTimeSec) ||
            patch.mediaTimeSec < 0
          ) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'patch.mediaTimeSec must be a finite non-negative number',
            };
          }
        }

        const store = getSessionStore();
        return store.updateMarker(markerId, patch);
      },
    });
  },
  removeMarker: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.removeMarker,
      handler: (_event, markerId: string): SessionUpdateResult => {
        if (typeof markerId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'markerId must be a string',
          };
        }
        const store = getSessionStore();
        return store.removeMarker(markerId);
      },
    });
  },
  addPlaybackEvent: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.addPlaybackEvent,
      broadcastUi: false, // Telemetry is not part of UI snapshot
      handler: (_event, event: PlaybackEvent): SessionUpdateResult => {
        // Validate event shape at IPC boundary (fail-closed)
        if (!event || typeof event !== 'object') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'event must be an object',
          };
        }
        if (typeof event.sessionTimeSec !== 'number' || !Number.isInteger(event.sessionTimeSec)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'event.sessionTimeSec must be an integer',
          };
        }
        if (event.sessionTimeSec < 0) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'event.sessionTimeSec must be non-negative',
          };
        }
        if (typeof event.type !== 'string' || !VALID_EVENT_TYPES.has(event.type as PlaybackEventType)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: `event.type must be one of: ${PLAYBACK_EVENT_TYPES.join(', ')}`,
          };
        }
        if (
          typeof event.playbackRate !== 'number' ||
          !Number.isFinite(event.playbackRate) ||
          event.playbackRate <= 0
        ) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'event.playbackRate must be a finite number > 0',
          };
        }
        if (event.mediaId === null) {
          if (event.type !== 'load') {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'null mediaId is only valid for "load" events',
            };
          }
          if (event.mediaTimeSec !== null) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'event.mediaTimeSec must be null when mediaId is null',
            };
          }
        } else {
          if (typeof event.mediaId !== 'string') {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'event.mediaId must be null or a string',
            };
          }
          if (typeof event.mediaTimeSec !== 'number' || !Number.isFinite(event.mediaTimeSec)) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'event.mediaTimeSec must be a finite number when mediaId is present',
            };
          }
          if (event.mediaTimeSec < 0) {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'event.mediaTimeSec must be non-negative',
            };
          }
        }

        const store = getSessionStore();
        return store.addPlaybackEvent(event);
      },
    });
  },
  setTranscriptRef: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.setTranscriptRef,
      handler: (_event, ref: TranscriptRef | null): SessionUpdateResult => {
        if (ref !== null) {
          if (typeof ref !== 'object') {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'ref must be null or an object',
            };
          }
          if (ref.relativePath !== 'transcript.json') {
            return {
              ok: false,
              code: 'invalid_input',
              message: 'ref.relativePath must be "transcript.json"',
            };
          }
        }

        const store = getSessionStore();
        return store.setTranscriptRef(ref);
      },
    });
  },
  setPlaybackState: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.setPlaybackState,
      handler: (
        _event,
        state: { activeMediaId: string | null; mediaPositions: Record<string, number> }
      ): SessionUpdateResult => {
        if (state === null || typeof state !== 'object') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'state must be an object',
          };
        }
        if (state.activeMediaId !== null && typeof state.activeMediaId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'state.activeMediaId must be null or a string',
          };
        }
        if (
          state.mediaPositions === null ||
          typeof state.mediaPositions !== 'object' ||
          Array.isArray(state.mediaPositions) ||
          Object.getPrototypeOf(state.mediaPositions) !== Object.prototype
        ) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'state.mediaPositions must be a plain object',
          };
        }
        for (const [key, value] of Object.entries(state.mediaPositions)) {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            return {
              ok: false,
              code: 'invalid_input',
              message: `state.mediaPositions['${key}'] must be a finite number`,
            };
          }
        }

        const store = getSessionStore();
        return store.setPlaybackState(state);
      },
    });
  },
  exportMarkerStill: () => {
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.exportMarkerStill,
      broadcastUi: false,
      handler: (_event, markerId: unknown, overlayPngBase64: unknown): Promise<MarkerStillExportResult> => {
        // Validate markerId
        if (typeof markerId !== 'string') {
          return Promise.resolve({
            ok: false,
            code: 'invalid_input',
            message: 'markerId must be a string',
          });
        }

        // Validate overlayPngBase64
        if (overlayPngBase64 !== null && typeof overlayPngBase64 !== 'string') {
          return Promise.resolve({
            ok: false,
            code: 'invalid_input',
            message: 'overlayPngBase64 must be null or a string',
          });
        }

        return exportMarkerStill({ markerId, overlayPngBase64 });
      },
    });
  },
  exportMarkerClip: () => {
    // Export a marker clip (+/- radius around marker time)
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.exportMarkerClip,
      broadcastUi: false,
      handler: async (
        _event,
        markerId: unknown,
        videoDurationSec: unknown,
        radiusSec: unknown
      ): Promise<MarkerClipExportResult> => {
        // Validate types at IPC boundary (fail-closed)
        if (typeof markerId !== 'string') {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'markerId must be a string',
          };
        }
        if (typeof videoDurationSec !== 'number' || !Number.isFinite(videoDurationSec)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'videoDurationSec must be a finite number',
          };
        }
        if (typeof radiusSec !== 'number' || !Number.isFinite(radiusSec)) {
          return {
            ok: false,
            code: 'invalid_input',
            message: 'radiusSec must be a finite number',
          };
        }

        return exportMarkerClip({ markerId, videoDurationSec, radiusSec });
      },
    });
  },
  exportGroupClip: () => {
    // Export group clip (for grouped markers)
    registerUiMutationHandler({
      channel: SESSION_IPC_CHANNELS.exportGroupClip,
      broadcastUi: false,
      handler: (
        _event,
        groupId: string,
        mediaId: string,
        startSec: number,
        endSec: number,
        videoDurationSec: number
      ): Promise<GroupClipExportResult> => {
        // Validate groupId
        if (typeof groupId !== 'string') {
          return Promise.resolve({
            ok: false,
            code: 'invalid_input',
            message: 'groupId must be a string',
          });
        }

        // Validate mediaId
        if (typeof mediaId !== 'string') {
          return Promise.resolve({
            ok: false,
            code: 'invalid_input',
            message: 'mediaId must be a string',
          });
        }

        // Validate startSec
        if (typeof startSec !== 'number' || !Number.isFinite(startSec)) {
          return Promise.resolve({
            ok: false,
            code: 'invalid_input',
            message: 'startSec must be a finite number',
          });
        }

        // Validate endSec
        if (typeof endSec !== 'number' || !Number.isFinite(endSec)) {
          return Promise.resolve({
            ok: false,
            code: 'invalid_input',
            message: 'endSec must be a finite number',
          });
        }

        // Validate videoDurationSec
        if (typeof videoDurationSec !== 'number' || !Number.isFinite(videoDurationSec)) {
          return Promise.resolve({
            ok: false,
            code: 'invalid_input',
            message: 'videoDurationSec must be a finite number',
          });
        }

        return exportGroupClip({ groupId, mediaId, startSec, endSec, videoDurationSec });
      },
    });
  },
};

/**
 * Registers all session-related IPC handlers.
 * Must be called once during app startup (before renderer loads).
 *
 * Each handler returns a typed result; errors are explicit, never thrown.
 */
export function registerSessionIpcHandlers(): void {
  for (const key of Object.keys(handlers) as Array<keyof typeof SESSION_IPC_CHANNELS>) {
    handlers[key]();
  }
}
