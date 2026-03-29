import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Marker, MarkerDrawing, DrawingStroke } from '../../../shared/sessionPackage/types';
import {
  DEFAULT_DRAWING_STROKE_WIDTH,
  DRAWING_COORDINATE_SPACE,
  newId,
  nowIso,
} from '../../../shared/sessionPackage/types';
import type { MarkerListItem } from '../../types/markers';
import { DRAWING_COLORS } from '../../utils/drawingColors';
import { SEEK_TOLERANCE_SEC } from '../../utils/markerNavConstants';
import type { AppCommonDeps } from '../../app/appDeps';
import type { SessionStatus } from '../../app/appTypes';
import type { SessionUiSnapshot } from '../../../shared/ipc/sessionUi';
import type { InputDomain } from '../input/inputDomain';
import type { PlaybackDomainState } from '../playback/playbackDomain';
import type { RecordingDomainState, RecordingDomainQueries } from '../recording/recordingDomain';
import { computeClickSelection, computeShiftRangeSelection, type MarkerClickModifiers } from './selection';
import { selectActiveMediaMarkersByTime, selectActiveMediaMarkersVisualOrder } from './selectors';

export interface MarkerDomainState {
  selectedMarkerIds: ReadonlySet<string>;
  drawingToolIndex: 0 | 1 | 2 | 3;
  drawingColorIndex: number;
}

export interface MarkerDomainQueries {
  selectedMarker: Marker | null;
  activeMediaMarkersByTime: readonly MarkerListItem[];
  activeMediaMarkers: readonly MarkerListItem[];
  drawingColor: string;
  canUndoStroke(): boolean;
  canRedoStroke(): boolean;
}

export interface MarkerDomainActions {
  dropMarker(): Promise<void>;
  deselectAll(): void;
  selectOnly(markerId: string): void;
  addToSelection(markerId: string): void;
  handleMarkerClick(opts: {
    markerId: string;
    order: 'visual' | 'time';
    modifiers: MarkerClickModifiers;
  }): { shouldSeek: boolean };
  selectRange(anchorId: string, currentId: string): void;
  addRangeToSelection(anchorId: string, currentId: string): void;
  addShiftRangeToSelection(targetMarkerId: string): void;
  setImportance(level: 1 | 2 | 3): Promise<void>;
  updateMarker(
    markerId: string,
    patch: Partial<Pick<Marker, 'bucketId' | 'tagIds' | 'importance' | 'note'>> & {
      drawing?: MarkerDrawing | null;
      mediaTimeSec?: number;
      groupId?: string | null;
    }
  ): Promise<boolean>;
  deleteMarker(markerId: string): Promise<void>;
  groupSelected(): Promise<void>;
  ungroupSelected(): Promise<void>;
  setDrawingToolIndex(index: 0 | 1 | 2 | 3): void;
  setDrawingColor(color: string): void;
  setDrawingColorByIndex(index: number): void;
  commitStroke(stroke: DrawingStroke): Promise<void>;
  undoStroke(): Promise<void>;
  redoStroke(): Promise<void>;
}

type MarkerUpdatePatch = Partial<Pick<Marker, 'bucketId' | 'tagIds' | 'importance' | 'note'>> & {
  drawing?: MarkerDrawing | null;
  mediaTimeSec?: number;
  groupId?: string | null;
};

function getDrawingColorByIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= DRAWING_COLORS.length) {
    throw new Error(`Invalid drawing color index: ${index}`);
  }
  return DRAWING_COLORS[index];
}

export function useMarkerDomain(
  deps: AppCommonDeps & {
    session: SessionUiSnapshot | null;
    sessionStatus: SessionStatus;
    input: InputDomain;
    playback: PlaybackDomainState;
    recording: { state: RecordingDomainState; queries: RecordingDomainQueries };
  }
): { state: MarkerDomainState; queries: MarkerDomainQueries; actions: MarkerDomainActions } {
  const [selectedMarkerIds, setSelectedMarkerIds] = useState<ReadonlySet<string>>(new Set());
  const [drawingToolIndex, setDrawingToolIndexState] = useState<0 | 1 | 2 | 3>(0);
  const [drawingColorIndex, setDrawingColorIndexState] = useState(0);

  const markerAddInFlightRef = useRef(false);
  const redoStackRef = useRef<Map<string, DrawingStroke[]>>(new Map());
  const lastActiveMediaIdRef = useRef<string | null>(deps.playback.activeMediaId);
  const drawingQueueByMarkerIdRef = useRef<Map<string, Promise<void>>>(new Map());
  const drawingCommittedByMarkerIdRef = useRef<Map<string, MarkerDrawing | null>>(new Map());
  const currentSessionIdRef = useRef<string | null>(deps.session?.sessionId ?? null);
  currentSessionIdRef.current = deps.session?.sessionId ?? null;

  const selectedMarker = useMemo(() => {
    if (!deps.session || selectedMarkerIds.size !== 1) {
      return null;
    }
    const [markerId] = [...selectedMarkerIds];
    return deps.session.markers.find((item) => item.markerId === markerId) ?? null;
  }, [deps.session, selectedMarkerIds]);

  const activeMediaMarkersByTime = useMemo(() => {
    if (!deps.session || !deps.playback.activeMediaId) {
      return [];
    }
    return selectActiveMediaMarkersByTime(deps.session, deps.playback.activeMediaId);
  }, [deps.playback.activeMediaId, deps.session]);

  const activeMediaMarkers = useMemo(() => {
    return selectActiveMediaMarkersVisualOrder(activeMediaMarkersByTime);
  }, [activeMediaMarkersByTime]);

  useEffect(() => {
    const currentId = deps.playback.activeMediaId ?? null;
    if (currentId === lastActiveMediaIdRef.current) {
      return;
    }
    lastActiveMediaIdRef.current = currentId;
    if (selectedMarkerIds.size > 0) {
      setSelectedMarkerIds(new Set());
    }
    if (deps.input.state.sessionMode !== 'clips') {
      deps.input.actions.resetToPlayerMode();
    }
  }, [deps.input.actions, deps.input.state.sessionMode, deps.playback.activeMediaId, selectedMarkerIds]);

  useEffect(() => {
    drawingQueueByMarkerIdRef.current.clear();
    drawingCommittedByMarkerIdRef.current.clear();
    redoStackRef.current.clear();
    setSelectedMarkerIds(new Set());
  }, [deps.session?.sessionId]);

  const drawingColor = useMemo(() => {
    return getDrawingColorByIndex(drawingColorIndex);
  }, [drawingColorIndex]);

  const getSnapshotDrawing = useCallback(
    (markerId: string): MarkerDrawing | null => {
      if (!deps.session) {
        return null;
      }
      const marker = deps.session.markers.find((item) => item.markerId === markerId);
      return marker?.drawing ?? null;
    },
    [deps.session]
  );

  const ensureSessionWritable = useCallback((): boolean => {
    if (deps.sessionStatus === 'starting') {
      deps.feedback.show('Session is starting. Try again once ready.');
      return false;
    }
    if (deps.sessionStatus === 'stopping') {
      deps.feedback.show('Session is stopping. Try again once ready.');
      return false;
    }
    if (deps.sessionStatus === 'error') {
      deps.feedback.show('Session is in error state. Resolve the session error to edit markers.');
      return false;
    }
    return true;
  }, [deps.feedback, deps.sessionStatus]);

  const enqueueDrawingMutation = useCallback(
    (
      markerId: string,
      computeNext: (base: MarkerDrawing | null) => MarkerDrawing | null,
      extraPatch: Omit<MarkerUpdatePatch, 'drawing'> = {}
    ): Promise<boolean> => {
      if (!deps.session) {
        deps.errors.set('No active session');
        return Promise.resolve(false);
      }

      const sessionId = deps.session.sessionId;
      const queueMap = drawingQueueByMarkerIdRef.current;
      const previous = queueMap.get(markerId) ?? Promise.resolve();
      let result = true;

      const work = async () => {
        if (currentSessionIdRef.current !== sessionId) {
          result = false;
          return;
        }
        const base = drawingCommittedByMarkerIdRef.current.has(markerId)
          ? drawingCommittedByMarkerIdRef.current.get(markerId) ?? null
          : getSnapshotDrawing(markerId);
        const nextDrawing = computeNext(base);
        const hasExtraPatch = Object.keys(extraPatch).length > 0;
        if (nextDrawing === base && !hasExtraPatch) {
          return;
        }
        const ipcResult = await deps.api.session.updateMarker(markerId, { ...extraPatch, drawing: nextDrawing });
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to update marker: ${ipcResult.message}`);
          result = false;
          return;
        }

        deps.persistence.markDirty();
        drawingCommittedByMarkerIdRef.current.set(markerId, nextDrawing);
      };

      const next = previous.then(work).catch((err) => {
        deps.errors.set(`Failed to update marker: ${err instanceof Error ? err.message : String(err)}`);
        result = false;
      });

      const tracked = next.finally(() => {
        if (drawingQueueByMarkerIdRef.current.get(markerId) === tracked) {
          drawingQueueByMarkerIdRef.current.delete(markerId);
        }
      });
      queueMap.set(markerId, tracked);
      return tracked.then(() => result);
    },
    [deps.api.session, deps.errors, deps.persistence, deps.session, getSnapshotDrawing]
  );

  const updateMarker = useCallback(
    async (markerId: string, patch: MarkerUpdatePatch): Promise<boolean> => {
      if (!deps.session) {
        deps.errors.set('No active session');
        return false;
      }
      if (!ensureSessionWritable()) {
        return false;
      }

      if (patch.drawing !== undefined) {
        const { drawing, ...rest } = patch;
        const success = await enqueueDrawingMutation(markerId, () => drawing ?? null, rest);
        if (success && drawing === null) {
          redoStackRef.current.delete(markerId);
        }
        return success;
      }

      try {
        const ipcResult = await deps.api.session.updateMarker(markerId, patch);
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to update marker: ${ipcResult.message}`);
          return false;
        }

        deps.persistence.markDirty();
        return true;
      } catch (err) {
        deps.errors.set(`Failed to update marker: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },
    [deps.api.session, deps.errors, deps.persistence, deps.session, ensureSessionWritable, enqueueDrawingMutation]
  );

  const dropMarker = useCallback(async () => {
    if (!deps.session) {
      deps.errors.set('No active session');
      return;
    }
    if (!ensureSessionWritable()) {
      return;
    }
    if (deps.recording.state.fatalClockError) {
      deps.errors.set('Cannot create marker: recording is in error state. Stop recording first.');
      return;
    }

    const activeMedia =
      deps.playback.activeMediaIndex >= 0
        ? deps.session.media.assets[deps.playback.activeMediaIndex]
        : null;
    if (!activeMedia) {
      deps.errors.set('Select a media file before dropping a marker.');
      return;
    }

    if (markerAddInFlightRef.current) {
      deps.feedback.show('Marker creation in progress');
      return;
    }

    const markersWithinEpsilon = activeMediaMarkersByTime.filter(
      (marker) => Math.abs(marker.mediaTimeSec - deps.playback.mediaTimeSec) <= SEEK_TOLERANCE_SEC
    );
    if (markersWithinEpsilon.length > 0) {
      const closestMarker = markersWithinEpsilon.reduce((closest, marker) => {
        const closestDist = Math.abs(closest.mediaTimeSec - deps.playback.mediaTimeSec);
        const markerDist = Math.abs(marker.mediaTimeSec - deps.playback.mediaTimeSec);
        return markerDist < closestDist ? marker : closest;
      });
      setSelectedMarkerIds(new Set([closestMarker.markerId]));
      deps.feedback.show('Marker already exists at this time');
      return;
    }

    markerAddInFlightRef.current = true;

    try {
      const snapshot = {
        mediaId: activeMedia.mediaId,
        mediaTimeSec: deps.playback.mediaTimeSec,
        playbackRate: deps.playback.playbackRate,
        paused: deps.playback.isPaused,
      };

      let anchorSessionTimeSec: number | null = null;
      if (deps.recording.state.recordingActive) {
        const timeResult = deps.recording.queries.getSessionTimeSec();
        if (!timeResult.ok) {
          deps.errors.set(timeResult.message);
          return;
        }
        anchorSessionTimeSec = timeResult.sec;
      }

      const marker: Marker = {
        markerId: newId(),
        createdAtIso: nowIso(),
        anchorSessionTimeSec,
        sourceType: 'video',
        playbackSnapshot: snapshot,
        bucketId: null,
        tagIds: [],
        importance: 2,
      };

      const ipcResult = await deps.api.session.addMarker(marker);
      if (!ipcResult.ok) {
        deps.errors.set(`Failed to add marker: ${ipcResult.message}`);
        return;
      }

      setSelectedMarkerIds(new Set([marker.markerId]));
      deps.persistence.markDirty();
    } catch (err) {
      deps.errors.set(`Failed to add marker: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      markerAddInFlightRef.current = false;
    }
  }, [
    activeMediaMarkersByTime,
    deps.api.session,
    deps.errors,
    deps.feedback,
    deps.persistence,
    deps.playback.activeMediaIndex,
    deps.playback.isPaused,
    deps.playback.mediaTimeSec,
    deps.playback.playbackRate,
    deps.recording.queries,
    deps.recording.state.fatalClockError,
    deps.recording.state.recordingActive,
    deps.session,
    ensureSessionWritable,
  ]);

  const deselectAll = useCallback(() => {
    setSelectedMarkerIds(new Set());
  }, []);

  const selectOnly = useCallback((markerId: string) => {
    setSelectedMarkerIds(new Set([markerId]));
  }, []);

  const addToSelection = useCallback((markerId: string) => {
    setSelectedMarkerIds((prev) => {
      const next = new Set(prev);
      next.add(markerId);
      return next;
    });
  }, []);

  const handleMarkerClick = useCallback(
    (opts: { markerId: string; order: 'visual' | 'time'; modifiers: MarkerClickModifiers }) => {
      const markers = opts.order === 'visual' ? activeMediaMarkers : activeMediaMarkersByTime;
      const { nextSelection, shouldSeek } = computeClickSelection({
        markers,
        currentSelection: selectedMarkerIds,
        targetMarkerId: opts.markerId,
        modifiers: opts.modifiers,
      });

      if (nextSelection === selectedMarkerIds) {
        return { shouldSeek };
      }

      if (
        nextSelection.size === 0 &&
        (deps.input.state.sessionMode === 'note' || deps.input.state.sessionMode === 'drawing')
      ) {
        deps.input.actions.resetToPlayerMode();
      }

      setSelectedMarkerIds(new Set(nextSelection));
      return { shouldSeek };
    },
    [
      activeMediaMarkers,
      activeMediaMarkersByTime,
      deps.input.actions,
      deps.input.state.sessionMode,
      selectedMarkerIds,
    ]
  );

  const selectRange = useCallback(
    (anchorId: string, currentId: string) => {
      const anchorIndex = activeMediaMarkers.findIndex((marker) => marker.markerId === anchorId);
      const currentIndex = activeMediaMarkers.findIndex((marker) => marker.markerId === currentId);
      if (anchorIndex === -1 || currentIndex === -1) return;

      const startIndex = Math.min(anchorIndex, currentIndex);
      const endIndex = Math.max(anchorIndex, currentIndex);
      const rangeMarkerIds = activeMediaMarkers
        .slice(startIndex, endIndex + 1)
        .map((marker) => marker.markerId);
      setSelectedMarkerIds(new Set(rangeMarkerIds));
    },
    [activeMediaMarkers]
  );

  const addRangeToSelection = useCallback(
    (anchorId: string, currentId: string) => {
      const anchorIndex = activeMediaMarkers.findIndex((marker) => marker.markerId === anchorId);
      const currentIndex = activeMediaMarkers.findIndex((marker) => marker.markerId === currentId);
      if (anchorIndex === -1 || currentIndex === -1) return;

      const startIndex = Math.min(anchorIndex, currentIndex);
      const endIndex = Math.max(anchorIndex, currentIndex);
      const rangeMarkerIds = activeMediaMarkers
        .slice(startIndex, endIndex + 1)
        .map((marker) => marker.markerId);

      setSelectedMarkerIds((prev) => {
        const next = new Set(prev);
        for (const id of rangeMarkerIds) {
          next.add(id);
        }
        return next;
      });
    },
    [activeMediaMarkers]
  );

  const addShiftRangeToSelection = useCallback(
    (targetMarkerId: string) => {
      const nextSelection = computeShiftRangeSelection(
        activeMediaMarkers,
        selectedMarkerIds,
        targetMarkerId
      );
      if (nextSelection === selectedMarkerIds) {
        return;
      }
      setSelectedMarkerIds(new Set(nextSelection));
    },
    [activeMediaMarkers, selectedMarkerIds]
  );

  const setImportance = useCallback(
    async (level: 1 | 2 | 3) => {
      if (!selectedMarker) return;
      await updateMarker(selectedMarker.markerId, { importance: level });
    },
    [selectedMarker, updateMarker]
  );

  const deleteMarker = useCallback(
    async (markerId: string) => {
      if (!deps.session) {
        deps.errors.set('No active session');
        return;
      }
      if (!ensureSessionWritable()) {
        return;
      }

      try {
        const ipcResult = await deps.api.session.removeMarker(markerId);
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to delete marker: ${ipcResult.message}`);
          return;
        }

        if (selectedMarkerIds.has(markerId)) {
          const removingLast = selectedMarkerIds.size === 1;
          if (
            removingLast &&
            (deps.input.state.sessionMode === 'note' || deps.input.state.sessionMode === 'drawing')
          ) {
            deps.input.actions.resetToPlayerMode();
          }
          setSelectedMarkerIds((prev) => {
            const next = new Set(prev);
            next.delete(markerId);
            return next;
          });
        }

        deps.persistence.markDirty();
      } catch (err) {
        deps.errors.set(`Failed to delete marker: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [
      deps.api.session,
      deps.errors,
      deps.input.actions,
      deps.input.state.sessionMode,
      deps.persistence,
      deps.session,
      ensureSessionWritable,
      selectedMarkerIds,
    ]
  );

  const groupSelected = useCallback(async () => {
    if (!deps.session) {
      deps.errors.set('No active session');
      return;
    }
    if (!ensureSessionWritable()) {
      return;
    }
    const markerIds = [...selectedMarkerIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (markerIds.length < 2) return;

    try {
      const newGroupId = newId();
      const markerIdSet = new Set(markerIds);

      const oldGroupIds = new Set<string>();
      for (const marker of deps.session.markers) {
        if (markerIdSet.has(marker.markerId) && marker.groupId) {
          oldGroupIds.add(marker.groupId);
        }
      }

      const orphanedMarkerIds: string[] = [];
      for (const oldGroupId of oldGroupIds) {
        const remainingInGroup = deps.session.markers.filter(
          (marker) => marker.groupId === oldGroupId && !markerIdSet.has(marker.markerId)
        );
        if (remainingInGroup.length === 1) {
          orphanedMarkerIds.push(remainingInGroup[0].markerId);
        }
      }

      const sortedOrphanedMarkerIds = orphanedMarkerIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const markerId of markerIds) {
        const ipcResult = await deps.api.session.updateMarker(markerId, { groupId: newGroupId });
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to group marker: ${ipcResult.message}`);
          return;
        }
        deps.persistence.markDirty();
      }

      for (const markerId of sortedOrphanedMarkerIds) {
        const ipcResult = await deps.api.session.updateMarker(markerId, { groupId: null });
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to clean up orphaned marker: ${ipcResult.message}`);
          return;
        }
        deps.persistence.markDirty();
      }
    } catch (err) {
      deps.errors.set(`Failed to group markers: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [deps.api.session, deps.errors, deps.persistence, deps.session, ensureSessionWritable, selectedMarkerIds]);

  const ungroupSelected = useCallback(async () => {
    if (!deps.session) {
      deps.errors.set('No active session');
      return;
    }
    if (!ensureSessionWritable()) {
      return;
    }
    const markerIds = [...selectedMarkerIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (markerIds.length === 0) return;

    try {
      const markerIdSet = new Set(markerIds);

      const oldGroupIds = new Set<string>();
      for (const marker of deps.session.markers) {
        if (markerIdSet.has(marker.markerId) && marker.groupId) {
          oldGroupIds.add(marker.groupId);
        }
      }

      const orphanedMarkerIds: string[] = [];
      for (const oldGroupId of oldGroupIds) {
        const remainingInGroup = deps.session.markers.filter(
          (marker) => marker.groupId === oldGroupId && !markerIdSet.has(marker.markerId)
        );
        if (remainingInGroup.length === 1) {
          orphanedMarkerIds.push(remainingInGroup[0].markerId);
        }
      }

      const allToUngroup = [...markerIds, ...orphanedMarkerIds].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0
      );
      for (const markerId of allToUngroup) {
        const ipcResult = await deps.api.session.updateMarker(markerId, { groupId: null });
        if (!ipcResult.ok) {
          deps.errors.set(`Failed to ungroup marker: ${ipcResult.message}`);
          return;
        }
        deps.persistence.markDirty();
      }
    } catch (err) {
      deps.errors.set(`Failed to ungroup markers: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [deps.api.session, deps.errors, deps.persistence, deps.session, ensureSessionWritable, selectedMarkerIds]);

  const setDrawingToolIndex = useCallback((index: 0 | 1 | 2 | 3) => {
    if (index < 0 || index > 3) {
      throw new Error(`Invalid drawing tool index: ${index}`);
    }
    setDrawingToolIndexState(index);
  }, []);

  const setDrawingColor = useCallback((color: string) => {
    const index = (DRAWING_COLORS as readonly string[]).indexOf(color);
    if (index === -1) {
      deps.errors.set(`Invalid drawing color: ${color}`);
      return;
    }
    setDrawingColorIndexState(index);
  }, [deps.errors]);

  const setDrawingColorByIndex = useCallback((index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= DRAWING_COLORS.length) {
      throw new Error(`Invalid drawing color index: ${index}`);
    }
    setDrawingColorIndexState(index);
  }, []);

  const commitStroke = useCallback(
    async (stroke: DrawingStroke) => {
      if (!selectedMarker) return;
      if (!ensureSessionWritable()) {
        return;
      }
      const markerId = selectedMarker.markerId;
      const computeNext = (base: MarkerDrawing | null): MarkerDrawing => {
        if (base) {
          return {
            ...base,
            strokes: [...base.strokes, stroke],
          };
        }
        return {
          coordinateSpace: DRAWING_COORDINATE_SPACE,
          strokeWidth: DEFAULT_DRAWING_STROKE_WIDTH,
          strokes: [stroke],
        };
      };

      const success = await enqueueDrawingMutation(markerId, computeNext);
      if (success) {
        redoStackRef.current.delete(markerId);
      }
    },
    [enqueueDrawingMutation, ensureSessionWritable, selectedMarker]
  );

  const undoStroke = useCallback(async () => {
    if (!selectedMarker) return;
    if (!ensureSessionWritable()) {
      return;
    }
    const markerId = selectedMarker.markerId;
    let removedStroke: DrawingStroke | null = null;
    const computeNext = (base: MarkerDrawing | null): MarkerDrawing | null => {
      if (!base || base.strokes.length === 0) {
        return base;
      }
      removedStroke = base.strokes[base.strokes.length - 1];
      const newStrokes = base.strokes.slice(0, -1);
      if (newStrokes.length === 0) {
        return null;
      }
      return {
        ...base,
        strokes: newStrokes,
      };
    };

    const success = await enqueueDrawingMutation(markerId, computeNext);
    if (success && removedStroke) {
      const currentRedoStack = redoStackRef.current.get(markerId) ?? [];
      redoStackRef.current.set(markerId, [...currentRedoStack, removedStroke]);
    }
  }, [enqueueDrawingMutation, ensureSessionWritable, selectedMarker]);

  const redoStroke = useCallback(async () => {
    if (!selectedMarker) return;
    if (!ensureSessionWritable()) {
      return;
    }
    const markerId = selectedMarker.markerId;
    const redoStack = redoStackRef.current.get(markerId);
    if (!redoStack || redoStack.length === 0) return;

    const strokeToRedo = redoStack[redoStack.length - 1];
    const computeNext = (base: MarkerDrawing | null): MarkerDrawing => {
      if (base) {
        return {
          ...base,
          strokes: [...base.strokes, strokeToRedo],
        };
      }
      return {
        coordinateSpace: DRAWING_COORDINATE_SPACE,
        strokeWidth: DEFAULT_DRAWING_STROKE_WIDTH,
        strokes: [strokeToRedo],
      };
    };

    const success = await enqueueDrawingMutation(markerId, computeNext);
    if (success) {
      redoStackRef.current.set(markerId, redoStack.slice(0, -1));
    }
  }, [enqueueDrawingMutation, ensureSessionWritable, selectedMarker]);

  const canUndoStroke = useCallback(() => {
    return !!(selectedMarker && selectedMarker.drawing && selectedMarker.drawing.strokes.length > 0);
  }, [selectedMarker]);

  const canRedoStroke = useCallback(() => {
    if (!selectedMarker) {
      return false;
    }
    const redoStack = redoStackRef.current.get(selectedMarker.markerId);
    return !!(redoStack && redoStack.length > 0);
  }, [selectedMarker]);

  return {
    state: {
      selectedMarkerIds,
      drawingToolIndex,
      drawingColorIndex,
    },
    queries: {
      selectedMarker,
      activeMediaMarkersByTime,
      activeMediaMarkers,
      drawingColor,
      canUndoStroke,
      canRedoStroke,
    },
    actions: {
      dropMarker,
      deselectAll,
      selectOnly,
      addToSelection,
      handleMarkerClick,
      selectRange,
      addRangeToSelection,
      addShiftRangeToSelection,
      setImportance,
      updateMarker,
      deleteMarker,
      groupSelected,
      ungroupSelected,
      setDrawingToolIndex,
      setDrawingColor,
      setDrawingColorByIndex,
      commitStroke,
      undoStroke,
      redoStroke,
    },
  };
}
