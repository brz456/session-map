import { useCallback, useEffect, useMemo, useRef, type RefObject, type MouseEvent as ReactMouseEvent } from 'react';
import type {
  SessionDomainState,
  SessionDomainActions,
} from '../domains/session/sessionDomain';
import type {
  InputDomainState,
  InputDomainActions,
} from '../domains/input/inputDomain';
import type {
  PlaybackDomainState,
  PlaybackDomainActions,
} from '../domains/playback/playbackDomain';
import type {
  RecordingDomainState,
  RecordingDomainActions,
} from '../domains/recording/recordingDomain';
import type {
  MarkerDomainState,
  MarkerDomainQueries,
  MarkerDomainActions,
} from '../domains/markers/markerDomain';
import type {
  BucketDomainState,
  BucketDomainActions,
} from '../domains/buckets/bucketDomain';
import type {
  TagDomainState,
  TagDomainActions,
} from '../domains/tags/tagDomain';
import type {
  ExportDomainState,
  ExportDomainActions,
} from '../domains/export/exportDomain';
import type {
  ModalDomainState,
  ModalDomainActions,
} from '../domains/modals/modalDomain';
import type { ErrorController } from '../app/useErrors';
import type { VideoPlayerHandle } from '../components/player/videoPlayerTypes';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { CoursePane, type CoursePaneFocusTarget } from '../components/course/CoursePane';
import { ClipPanel } from '../components/session/ClipPanel';
import { shouldExitToPlayerOnClickCapture } from '../input/router/clickCapture';
import { blurActiveElement } from '../utils/dom';
import { DEFAULT_DRAWING_STROKE_WIDTH } from '../../shared/sessionPackage/types';
import { DRAWING_SNAP_TOLERANCE_SEC } from '../utils/markerNavConstants';

export interface SessionViewProps {
  session: { state: SessionDomainState; actions: SessionDomainActions };
  input: { state: InputDomainState; actions: InputDomainActions };
  playback: { state: PlaybackDomainState; actions: PlaybackDomainActions };
  recording: { state: RecordingDomainState; actions: RecordingDomainActions };
  markers: {
    state: MarkerDomainState;
    queries: MarkerDomainQueries;
    actions: MarkerDomainActions;
  };
  buckets: { state: BucketDomainState; actions: BucketDomainActions };
  tags: { state: TagDomainState; actions: TagDomainActions };
  export: { state: ExportDomainState; actions: ExportDomainActions };
  modals: { state: ModalDomainState; actions: ModalDomainActions };
  errors: ErrorController;
  canDeleteMedia: boolean;
  refs: {
    videoPlayerRef: RefObject<VideoPlayerHandle>;
    noteTextareaRef: RefObject<HTMLTextAreaElement>;
  };
}

export function SessionView(props: SessionViewProps): JSX.Element {
  const { session, input, playback, recording, markers, buckets, tags, export: exportDomain, modals, errors, canDeleteMedia, refs } = props;
  const sessionSnapshot = session.state.session;
  const selectedMarker = markers.queries.selectedMarker;
  const selectedMarkerIds = markers.state.selectedMarkerIds;

  const suppressSessionNameBlurRef = useRef(false);

  const focusTarget: CoursePaneFocusTarget = useMemo(() => {
    if (input.state.sessionMode === 'buckets') return 'bucketDraft';
    if (input.state.sessionMode === 'tags') return 'tagDraft';
    if (input.state.sessionMode === 'note') return 'note';
    return 'none';
  }, [input.state.sessionMode]);

  const activeMedia = sessionSnapshot?.media.assets[playback.state.activeMediaIndex] ?? null;
  const markerCountByMediaId = useMemo(() => {
    if (!sessionSnapshot) return {};
    const counts: Record<string, number> = {};
    for (const marker of sessionSnapshot.markers) {
      const mediaId = marker.playbackSnapshot.mediaId;
      if (typeof mediaId === 'string') {
        counts[mediaId] = (counts[mediaId] ?? 0) + 1;
      }
    }
    return counts;
  }, [sessionSnapshot]);

  const markerTimeSec = selectedMarker?.playbackSnapshot.mediaTimeSec ?? null;
  const isAtMarkerTime =
    markerTimeSec !== null &&
    Math.abs(playback.state.mediaTimeSec - markerTimeSec) < DRAWING_SNAP_TOLERANCE_SEC;

  const canImportMedia =
    session.state.sessionStatus !== 'starting' &&
    session.state.sessionStatus !== 'stopping' &&
    session.state.sessionStatus !== 'error' &&
    !exportDomain.state.isExporting;

  const editingDisabled =
    session.state.sessionStatus === 'starting' ||
    session.state.sessionStatus === 'stopping' ||
    session.state.sessionStatus === 'error' ||
    exportDomain.state.isExporting;

  const handleClickCapture = useCallback(
    (e: ReactMouseEvent) => {
      const btn = e.target instanceof HTMLElement ? e.target.closest('button') : null;
      btn?.blur();

      if (!shouldExitToPlayerOnClickCapture(input.state, e.target)) {
        return;
      }
      blurActiveElement();
      input.actions.resetToPlayerMode();
    },
    [input.actions, input.state]
  );

  const handleRenameSession = useCallback(
    async (nextName: string) => {
      if (suppressSessionNameBlurRef.current) {
        suppressSessionNameBlurRef.current = false;
        session.actions.setEditingSessionName(null);
        return;
      }
      try {
        await session.actions.renameSession(nextName);
      } catch (err) {
        errors.set(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [errors, session.actions]
  );

  const handleSelectMedia = useCallback(
    (index: number) => {
      if (!sessionSnapshot) return;
      if (index < 0 || index >= sessionSnapshot.media.assets.length) return;
      if (index === playback.state.activeMediaIndex) return;
      input.actions.resetToPlayerMode();
      markers.actions.deselectAll();
      playback.actions.selectMedia(index);
      recording.actions.logTelemetry('load');
    },
    [input.actions, markers.actions, playback.actions, playback.state.activeMediaIndex, recording.actions, sessionSnapshot]
  );

  const handleImportMedia = useCallback(() => {
    if (!canImportMedia) return;
    void session.actions.importMediaFromDisk();
  }, [canImportMedia, session.actions]);

  const handleDeleteMedia = useCallback(
    (mediaId: string) => {
      if (!canDeleteMedia) return;
      void (async () => {
        const referenceResult = await session.actions.getMediaReferenceCount(mediaId);
        if (!referenceResult.ok) return;

        const latestSession = session.state.session;
        if (!latestSession) return;

        const asset = latestSession.media.assets.find((item) => item.mediaId === mediaId);
        if (!asset) {
          errors.set(`Media not found: ${mediaId}`);
          return;
        }

        if (referenceResult.markerCount > 0 || referenceResult.eventCount > 0) {
          modals.actions.open('clipDeleteConfirm', {
            type: 'clip',
            id: mediaId,
            name: asset.displayName,
            markerCount: referenceResult.markerCount,
            eventCount: referenceResult.eventCount,
          });
          return;
        }

        await session.actions.removeMediaFromSession(mediaId);
      })().catch((err) => {
        errors.set(`Delete clip failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [canDeleteMedia, errors, modals.actions, session.actions, session.state.session]
  );

  const handlePlay = useCallback(() => {
    playback.actions.setPaused(false);
    if (input.state.sessionMode !== 'player') {
      input.actions.resetToPlayerMode();
    }
    recording.actions.logTelemetry('play');
  }, [input.actions, input.state.sessionMode, playback.actions, recording.actions]);

  const handlePause = useCallback(() => {
    playback.actions.setPaused(true);
    recording.actions.logTelemetry('pause');
  }, [playback.actions, recording.actions]);

  const handleSeeked = useCallback(() => {
    recording.actions.logTelemetry('seek');
  }, [recording.actions]);

  const handleRateChange = useCallback(
    (newRate: number) => {
      playback.actions.setPlaybackRate(newRate);
      recording.actions.logTelemetry('rate');
    },
    [playback.actions, recording.actions]
  );

  const handleTimeUpdate = useCallback(
    (currentTimeSec: number) => {
      playback.actions.setMediaTimeSec(currentTimeSec);
    },
    [playback.actions]
  );

  const handleLoadedMetadata = useCallback(
    (durationSec: number) => {
      const clampedTime = Math.max(0, Math.min(durationSec, playback.state.mediaTimeSec));
      if (clampedTime === playback.state.mediaTimeSec) {
        return;
      }
      playback.actions.commitSeek(clampedTime);
    },
    [playback.actions, playback.state.mediaTimeSec]
  );

  const handleSeekTo = useCallback(
    (timeSec: number) => {
      playback.actions.commitSeek(timeSec);
    },
    [playback.actions]
  );

  const handleToggleDrawingMode = useCallback(() => {
    if (input.state.sessionMode !== 'drawing') {
      if (markerTimeSec !== null) {
        playback.actions.requestSnapToTimeSec(markerTimeSec);
      }
      input.actions.set({ sessionMode: 'drawing' });
      return;
    }
    input.actions.resetToPlayerMode();
  }, [input.actions, input.state.sessionMode, markerTimeSec, playback.actions]);

  const handleRequestSnap = useCallback(() => {
    if (markerTimeSec !== null) {
      playback.actions.requestSnapToTimeSec(markerTimeSec);
    }
  }, [markerTimeSec, playback.actions]);

  const handleCreateBucket = useCallback(
    async (title: string) => {
      const result = await buckets.actions.createBucket(title);
      if (result.ok && input.state.sessionMode === 'buckets') {
        input.actions.set({ highlightedBucketId: result.bucketId });
      }
      return result;
    },
    [buckets.actions, input.actions, input.state.sessionMode]
  );

  const handleCreateTag = useCallback(
    async (name: string) => {
      const result = await tags.actions.createTag(name);
      if (result.ok && input.state.sessionMode === 'tags') {
        input.actions.set({ highlightedTagId: result.tagId });
      }
      return result;
    },
    [input.actions, input.state.sessionMode, tags.actions]
  );

  const handleSnapComplete = useCallback(
    (token: number) => {
      if (token !== playback.state.snapToken) {
        return;
      }
      if (playback.state.snapToTimeSec === null) {
        playback.actions.clearSnap();
        return;
      }
      playback.actions.commitSeek(playback.state.snapToTimeSec);
      playback.actions.clearSnap();
    },
    [playback.actions, playback.state.snapToken, playback.state.snapToTimeSec]
  );

  const handleMarkerListClick = useCallback(
    (markerId: string, timeSec: number, event?: ReactMouseEvent) => {
      if (input.state.sessionMode === 'buckets' || input.state.sessionMode === 'tags') {
        input.actions.resetToPlayerMode();
      }
      const modifiers = {
        ctrlOrMeta: !!(event?.ctrlKey || event?.metaKey),
        shift: !!event?.shiftKey,
      };
      const result = markers.actions.handleMarkerClick({
        markerId,
        order: 'visual',
        modifiers,
      });
      if (result.shouldSeek) {
        refs.videoPlayerRef.current?.seekTo(timeSec);
      }
    },
    [input.actions, input.state.sessionMode, markers.actions, refs.videoPlayerRef]
  );

  const handleTimelineMarkerClick = useCallback(
    (markerId: string, event?: ReactMouseEvent) => {
      if (input.state.sessionMode === 'buckets' || input.state.sessionMode === 'tags') {
        input.actions.resetToPlayerMode();
      }
      const modifiers = {
        ctrlOrMeta: !!(event?.ctrlKey || event?.metaKey),
        shift: !!event?.shiftKey,
      };
      markers.actions.handleMarkerClick({
        markerId,
        order: 'time',
        modifiers,
      });
    },
    [input.actions, input.state.sessionMode, markers.actions]
  );

  const handleDeleteBucket = useCallback(
    (bucketId: string) => {
      void (async () => {
        const refResult = await buckets.actions.getBucketReferenceCount(bucketId);
        if (!refResult.ok) return;

        const bucket = buckets.state.buckets.find((item) => item.bucketId === bucketId);
        if (!bucket) {
          errors.set(`Bucket not found: ${bucketId}`);
          return;
        }

        if (refResult.count > 0) {
          modals.actions.open('bucketDeleteConfirm', {
            type: 'bucket',
            id: bucketId,
            name: bucket.title,
            referenceCount: refResult.count,
          });
          return;
        }

        await buckets.actions.forceRemoveBucket(bucketId);
      })().catch((err) => {
        errors.set(`Delete bucket failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [buckets.actions, buckets.state.buckets, errors, modals.actions]
  );

  const handleDeleteTag = useCallback(
    (tagId: string) => {
      void (async () => {
        const refResult = await tags.actions.getTagReferenceCount(tagId);
        if (!refResult.ok) return;

        const tag = tags.state.tags.find((item) => item.tagId === tagId);
        if (!tag) {
          errors.set(`Tag not found: ${tagId}`);
          return;
        }

        if (refResult.count > 0) {
          modals.actions.open('tagDeleteConfirm', {
            type: 'tag',
            id: tagId,
            name: tag.name,
            referenceCount: refResult.count,
          });
          return;
        }

        await tags.actions.forceRemoveTag(tagId);
      })().catch((err) => {
        errors.set(`Delete tag failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [errors, modals.actions, tags.actions, tags.state.tags]
  );

  useEffect(() => {
    const highlightedBucketId = input.state.highlightedBucketId;
    if (!highlightedBucketId) return;
    const exists = buckets.state.buckets.some((bucket) => bucket.bucketId === highlightedBucketId);
    if (exists) return;
    input.actions.set({ highlightedBucketId: buckets.state.buckets[0]?.bucketId ?? null });
  }, [buckets.state.buckets, input.actions, input.state.highlightedBucketId]);

  useEffect(() => {
    const highlightedTagId = input.state.highlightedTagId;
    if (!highlightedTagId) return;
    const exists = tags.state.tags.some((tag) => tag.tagId === highlightedTagId);
    if (exists) return;
    input.actions.set({ highlightedTagId: tags.state.tags[0]?.tagId ?? null });
  }, [input.actions, input.state.highlightedTagId, tags.state.tags]);

  if (!sessionSnapshot) {
    return (
      <div className="app__session" onClickCapture={handleClickCapture}>
        <main className="app__main">
          <section className="app__processing">
            <h2 className="app__processing-title">No session loaded</h2>
            <p className="app__processing-message">Return home to open or create a session.</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app__session" onClickCapture={handleClickCapture}>
      <main className="app__main app__main--session">
        <aside className="app__sidebar">
          <div className="app__sidebar-header">
            {session.state.editingSessionName !== null ? (
              <input
                type="text"
                className="app__session-name-input"
                value={session.state.editingSessionName}
                onChange={(e) => session.actions.setEditingSessionName(e.target.value)}
                onBlur={() => {
                  void handleRenameSession(session.state.editingSessionName ?? '');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    suppressSessionNameBlurRef.current = true;
                    e.currentTarget.blur();
                  }
                }}
                autoFocus
              />
            ) : (
              <span
                className="app__session-name"
                onDoubleClick={() => session.actions.setEditingSessionName(sessionSnapshot.name)}
                title="Double-click to rename"
              >
                {sessionSnapshot.name}
              </span>
            )}
          </div>
          <CoursePane
            buckets={buckets.state.buckets}
            tags={tags.state.tags}
            markers={markers.queries.activeMediaMarkers}
            selectedMarkerIds={selectedMarkerIds}
            selectedMarker={selectedMarker}
            onCreateBucket={handleCreateBucket}
            onRenameBucket={buckets.actions.renameBucket}
            onDeleteBucket={handleDeleteBucket}
            onReorderBucket={buckets.actions.reorderBucket}
            onCreateTag={handleCreateTag}
            onRenameTag={tags.actions.renameTag}
            onDeleteTag={handleDeleteTag}
            onUpdateMarker={(markerId, patch) => void markers.actions.updateMarker(markerId, patch)}
            onDeleteMarker={(markerId) => void markers.actions.deleteMarker(markerId)}
            onMarkerClick={handleMarkerListClick}
            onGroupMarkers={(ids) => {
              if (ids.length < 2) return;
              void markers.actions.groupSelected();
            }}
            onUngroupMarkers={(ids) => {
              if (ids.length === 0) return;
              void markers.actions.ungroupSelected();
            }}
            editingDisabled={editingDisabled}
            drawingMode={input.state.sessionMode === 'drawing'}
            drawingColor={markers.queries.drawingColor}
            isAtMarkerTime={isAtMarkerTime}
            drawingToolIndex={markers.state.drawingToolIndex}
            onToggleDrawingMode={handleToggleDrawingMode}
            onSetDrawingColor={(color) => markers.actions.setDrawingColor(color)}
            onUndoStroke={() => void markers.actions.undoStroke()}
            onRedoStroke={() => void markers.actions.redoStroke()}
            canRedo={markers.queries.canRedoStroke()}
            onClearDrawing={() => {
              if (!selectedMarker) return;
              void markers.actions.updateMarker(selectedMarker.markerId, { drawing: null });
            }}
            focusTarget={focusTarget}
            highlightedBucketId={input.state.highlightedBucketId}
            highlightedTagId={input.state.highlightedTagId}
            highlightedMarkerId={input.state.highlightedMarkerId}
            markerListAnchorId={input.state.markerListAnchorId}
            bucketDraftTitle={input.state.bucketDraftTitle}
            onBucketDraftTitleChange={(title) => input.actions.set({ bucketDraftTitle: title })}
            tagDraftName={input.state.tagDraftName}
            onTagDraftNameChange={(name) => input.actions.set({ tagDraftName: name })}
            noteTextareaRef={refs.noteTextareaRef}
            onBucketDraftFocus={() => {
              input.actions.set({
                highlightedTagId: null,
                highlightedMarkerId: null,
                markerListAnchorId: null,
                tagDraftName: '',
                sessionMode: 'buckets',
              });
            }}
            onTagDraftFocus={() => {
              input.actions.set({
                highlightedBucketId: null,
                highlightedMarkerId: null,
                markerListAnchorId: null,
                bucketDraftTitle: '',
                sessionMode: 'tags',
              });
            }}
            onNoteFocus={() => {
              input.actions.set({
                highlightedBucketId: null,
                highlightedTagId: null,
                highlightedMarkerId: null,
                markerListAnchorId: null,
                bucketDraftTitle: '',
                tagDraftName: '',
                sessionMode: 'note',
              });
            }}
            inBucketsMode={input.state.sessionMode === 'buckets'}
            inTagsMode={input.state.sessionMode === 'tags'}
          />
        </aside>

        <section className="app__player">
          <VideoPlayer
            ref={refs.videoPlayerRef}
            activeMediaPath={activeMedia?.absolutePath ?? null}
            activeMediaId={activeMedia?.mediaId ?? null}
            playbackRate={playback.state.playbackRate}
            initialTime={playback.state.mediaTimeSec}
            fps={activeMedia?.fps}
            markers={[...markers.queries.activeMediaMarkersByTime]}
            selectedMarkerIds={[...selectedMarkerIds]}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeeked}
            onRateChange={handleRateChange}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onMarkerClick={handleTimelineMarkerClick}
            onMoveMarker={(markerId, newTimeSec) => markers.actions.updateMarker(markerId, { mediaTimeSec: newTimeSec })}
            onDeleteMarker={(markerId) => {
              void markers.actions.deleteMarker(markerId);
            }}
            onSeekTo={handleSeekTo}
            drawing={isAtMarkerTime ? markers.queries.selectedMarker?.drawing ?? null : null}
            drawingMode={input.state.sessionMode === 'drawing' && selectedMarker !== null}
            drawingColor={markers.queries.drawingColor}
            drawingStrokeWidth={DEFAULT_DRAWING_STROKE_WIDTH}
            markerTimeSec={markerTimeSec}
            snapToTimeSec={playback.state.snapToTimeSec}
            snapToken={playback.state.snapToken}
            onSnapComplete={handleSnapComplete}
            onCommitStroke={(stroke) => {
              void markers.actions.commitStroke(stroke);
            }}
            onRequestSnap={handleRequestSnap}
            sessionActions={{
              sessionStatus: session.state.sessionStatus,
              isExporting: exportDomain.state.isExporting,
              markerCount: sessionSnapshot.markers.length,
              hasActiveMedia: activeMedia !== null,
              hasFatalClockError: recording.state.fatalClockError,
              onBack: () => {
                void session.actions.closeSession();
              },
              onExport: () => {
                void exportDomain.actions.exportAll(sessionSnapshot);
              },
              onDropMarker: () => {
                void markers.actions.dropMarker();
              },
              onStartRecording: () => {
                void recording.actions.startRecording();
              },
              onStopRecording: () => {
                void recording.actions.stopRecording();
              },
            }}
          />

          <ClipPanel
            assets={sessionSnapshot.media.assets}
            markerCountByMediaId={markerCountByMediaId}
            activeMediaIndex={playback.state.activeMediaIndex}
            highlightedClipIndex={input.state.highlightedClipIndex}
            sessionMode={input.state.sessionMode}
            canImportMedia={canImportMedia}
            canDeleteMedia={canDeleteMedia}
            onSelectMedia={handleSelectMedia}
            onDeleteMedia={handleDeleteMedia}
            onImportMedia={handleImportMedia}
          />
        </section>
      </main>
    </div>
  );
}
