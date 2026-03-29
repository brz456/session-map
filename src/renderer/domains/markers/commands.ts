import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { InputDomain } from '../input/inputDomain';
import type { SessionDomainState } from '../session/sessionDomain';
import type { PlaybackDomainState, PlaybackDomainActions } from '../playback/playbackDomain';
import type { RecordingDomainState } from '../recording/recordingDomain';
import type { MarkerDomainState, MarkerDomainActions, MarkerDomainQueries } from './markerDomain';
import type { ModalDomainState, ModalDomainActions } from '../modals/modalDomain';
import type { VideoPlayerHandle } from '../../components/player/videoPlayerTypes';
import type { FeedbackController } from '../../app/useFeedback';
import { MARKER_NAV_EPSILON_SEC } from '../../utils/markerNavConstants';
import { DRAWING_COLORS } from '../../utils/drawingColors';

type MarkerList = readonly { markerId: string; mediaTimeSec: number }[];

export function createMarkerCommands(deps: {
  feedback: FeedbackController;
  input: InputDomain;
  session: { state: SessionDomainState };
  playback: {
    state: PlaybackDomainState;
    actions: Pick<PlaybackDomainActions, 'requestSnapToTimeSec'>;
  };
  recording: { state: RecordingDomainState };
  markers: {
    state: MarkerDomainState;
    queries: MarkerDomainQueries;
    actions: MarkerDomainActions;
  };
  modals: { state: ModalDomainState; actions: ModalDomainActions };
  refs: {
    videoPlayerRef: React.RefObject<VideoPlayerHandle>;
    noteTextareaRef: React.RefObject<HTMLTextAreaElement>;
  };
}): PartialCommandRegistry {
  const pausePlaybackIfNeeded = () => {
    const player = deps.refs.videoPlayerRef.current;
    if (player && !player.isPaused()) {
      player.togglePlayPause();
    }
  };

  const seekToMarker = (markerId: string, markers: MarkerList) => {
    const marker = markers.find((item) => item.markerId === markerId);
    if (marker) {
      deps.refs.videoPlayerRef.current?.seekTo(marker.mediaTimeSec);
    }
  };

  const setSelectionByIds = (markerIds: readonly string[]) => {
    if (markerIds.length === 0) {
      deps.markers.actions.deselectAll();
      return;
    }
    deps.markers.actions.selectOnly(markerIds[0]);
    for (let i = 1; i < markerIds.length; i += 1) {
      deps.markers.actions.addToSelection(markerIds[i]);
    }
  };

  const getMarkerNote = (markerId: string) => {
    return deps.session.state.session?.markers.find((marker) => marker.markerId === markerId)?.note;
  };

  return {
    'markers.deselectAll': () => {
      if (deps.markers.state.selectedMarkerIds.size > 0) {
        deps.markers.actions.deselectAll();
      }
    },
    'markers.deselectAllAndExitToPlayerMode': () => {
      deps.markers.actions.deselectAll();
      deps.refs.noteTextareaRef.current?.blur();
      deps.input.actions.resetToPlayerMode();
    },
    'markers.enterMarkerListMode': () => {
      deps.input.actions.resetToPlayerMode();
      const markers = deps.markers.queries.activeMediaMarkers;
      if (markers.length > 0) {
        const selectedIds = deps.markers.state.selectedMarkerIds;
        let nextHighlight = markers[0].markerId;
        if (selectedIds.size === 1) {
          const [selectedId] = [...selectedIds];
          if (markers.some((marker) => marker.markerId === selectedId)) {
            nextHighlight = selectedId;
          }
        }
        deps.input.actions.set({
          highlightedMarkerId: nextHighlight,
          markerListAnchorId: null,
          sessionMode: 'markerList',
        });
        return;
      }
      deps.input.actions.set({
        highlightedMarkerId: null,
        markerListAnchorId: null,
        sessionMode: 'markerList',
      });
    },
    'markers.enterNoteMode': () => {
      if (!deps.markers.queries.selectedMarker) {
        deps.feedback.show('Select exactly one marker to edit note');
        return;
      }
      deps.input.actions.resetToPlayerMode();
      deps.input.actions.set({ sessionMode: 'note' });
      deps.refs.noteTextareaRef.current?.focus();
    },
    'markers.enterDrawingMode': () => {
      const selectedMarker = deps.markers.queries.selectedMarker;
      if (!selectedMarker) {
        deps.feedback.show('Select exactly one marker for drawing');
        return;
      }
      deps.input.actions.resetToPlayerMode();
      deps.markers.actions.setDrawingToolIndex(3);
      deps.input.actions.set({ sessionMode: 'drawing' });
      const timeSec = selectedMarker.playbackSnapshot.mediaTimeSec;
      if (timeSec !== null) {
        deps.playback.actions.requestSnapToTimeSec(timeSec);
      }
    },
    'markers.dropMarker': () => deps.markers.actions.dropMarker(),
    'markers.requestDeleteSelected': () => {
      const markerIds = [...deps.markers.state.selectedMarkerIds];
      if (markerIds.length === 0) return;
      const note =
        markerIds.length === 1
          ? deps.markers.queries.selectedMarker?.note ?? getMarkerNote(markerIds[0])
          : undefined;
      deps.modals.actions.open('markerDeleteConfirm', { markerIds, note });
    },
    'markers.requestDeleteHighlighted': () => {
      const markerId = deps.input.state.highlightedMarkerId;
      if (!markerId) return;
      const note = getMarkerNote(markerId);
      deps.modals.actions.open('markerDeleteConfirm', { markerIds: [markerId], note });
    },
    'markers.setImportance1': () => deps.markers.actions.setImportance(1),
    'markers.setImportance2': () => deps.markers.actions.setImportance(2),
    'markers.setImportance3': () => deps.markers.actions.setImportance(3),
    'markers.groupSelected': () => deps.markers.actions.groupSelected(),
    'markers.ungroupSelected': () => deps.markers.actions.ungroupSelected(),
    'markers.navigatePrev': () => {
      const markers = deps.markers.queries.activeMediaMarkersByTime;
      if (markers.length === 0) return;
      pausePlaybackIfNeeded();
      const markerId = deps.refs.videoPlayerRef.current?.navigateToPrevMarker('time');
      if (markerId) {
        deps.markers.actions.selectOnly(markerId);
      }
    },
    'markers.navigateNext': () => {
      const markers = deps.markers.queries.activeMediaMarkersByTime;
      if (markers.length === 0) return;
      pausePlaybackIfNeeded();
      const markerId = deps.refs.videoPlayerRef.current?.navigateToNextMarker('time');
      if (markerId) {
        deps.markers.actions.selectOnly(markerId);
      }
    },
    'markers.navigatePrevExtend': () => {
      const markers = deps.markers.queries.activeMediaMarkersByTime;
      if (markers.length === 0) return;
      pausePlaybackIfNeeded();

      const currTime = deps.playback.state.mediaTimeSec;
      const currentSelection = deps.markers.state.selectedMarkerIds;
      const selectedIndices = [...currentSelection]
        .map((id) => markers.findIndex((marker) => marker.markerId === id))
        .filter((index) => index !== -1)
        .sort((a, b) => a - b);

      if (selectedIndices.length === 0) {
        let targetIndex = 0;
        for (let i = markers.length - 1; i >= 0; i -= 1) {
          if (markers[i].mediaTimeSec <= currTime + MARKER_NAV_EPSILON_SEC) {
            targetIndex = i;
            break;
          }
        }
        setSelectionByIds([markers[targetIndex].markerId]);
        deps.refs.videoPlayerRef.current?.seekTo(markers[targetIndex].mediaTimeSec);
        return;
      }

      const leftmostIndex = selectedIndices[0];
      const rightmostIndex = selectedIndices[selectedIndices.length - 1];
      const leftmostTime = markers[leftmostIndex].mediaTimeSec;
      const rightmostTime = markers[rightmostIndex].mediaTimeSec;

      const playheadPastRight = currTime > rightmostTime + MARKER_NAV_EPSILON_SEC;
      const playheadBeforeLeft = currTime < leftmostTime - MARKER_NAV_EPSILON_SEC;
      const playheadInsideOrAt = !playheadPastRight && !playheadBeforeLeft;

      let targetIndex = 0;
      for (let i = markers.length - 1; i >= 0; i -= 1) {
        if (markers[i].mediaTimeSec <= currTime + MARKER_NAV_EPSILON_SEC) {
          targetIndex = i;
          break;
        }
      }

      let newLeftmost: number;
      let newRightmost: number;
      let seekTarget: number;

      if (playheadInsideOrAt) {
        if (selectedIndices.length === 1) {
          if (leftmostIndex === 0) {
            return;
          }
          newLeftmost = leftmostIndex - 1;
          newRightmost = rightmostIndex;
          seekTarget = newLeftmost;
        } else {
          const atRightmost = Math.abs(currTime - rightmostTime) < MARKER_NAV_EPSILON_SEC;
          const atLeftmost = Math.abs(currTime - leftmostTime) < MARKER_NAV_EPSILON_SEC;

          if (atLeftmost) {
            if (leftmostIndex === 0) {
              return;
            }
            newLeftmost = leftmostIndex - 1;
            newRightmost = rightmostIndex;
            seekTarget = newLeftmost;
          } else if (atRightmost) {
            newLeftmost = leftmostIndex;
            newRightmost = Math.max(rightmostIndex - 1, leftmostIndex);
            seekTarget = newRightmost;
          } else {
            let markerAtOrBeforePlayhead = leftmostIndex;
            for (let i = markers.length - 1; i >= 0; i -= 1) {
              if (markers[i].mediaTimeSec <= currTime + MARKER_NAV_EPSILON_SEC) {
                markerAtOrBeforePlayhead = i;
                break;
              }
            }
            newLeftmost = leftmostIndex;
            newRightmost = Math.max(markerAtOrBeforePlayhead, leftmostIndex);
            seekTarget = newRightmost;
          }
        }
      } else {
        newLeftmost = Math.min(leftmostIndex, targetIndex);
        newRightmost = Math.max(rightmostIndex, targetIndex);
        seekTarget = targetIndex;
      }

      const selectionIds: string[] = [];
      for (let i = newLeftmost; i <= newRightmost; i += 1) {
        selectionIds.push(markers[i].markerId);
      }
      setSelectionByIds(selectionIds);
      deps.refs.videoPlayerRef.current?.seekTo(markers[seekTarget].mediaTimeSec);
    },
    'markers.navigateNextExtend': () => {
      const markers = deps.markers.queries.activeMediaMarkersByTime;
      if (markers.length === 0) return;
      pausePlaybackIfNeeded();

      const currTime = deps.playback.state.mediaTimeSec;
      const currentSelection = deps.markers.state.selectedMarkerIds;
      const selectedIndices = [...currentSelection]
        .map((id) => markers.findIndex((marker) => marker.markerId === id))
        .filter((index) => index !== -1)
        .sort((a, b) => a - b);

      if (selectedIndices.length === 0) {
        const idx = markers.findIndex(
          (marker) => marker.mediaTimeSec > currTime + MARKER_NAV_EPSILON_SEC
        );
        const targetIndex = idx !== -1 ? idx : markers.length - 1;
        setSelectionByIds([markers[targetIndex].markerId]);
        deps.refs.videoPlayerRef.current?.seekTo(markers[targetIndex].mediaTimeSec);
        return;
      }

      const leftmostIndex = selectedIndices[0];
      const rightmostIndex = selectedIndices[selectedIndices.length - 1];
      const leftmostTime = markers[leftmostIndex].mediaTimeSec;
      const rightmostTime = markers[rightmostIndex].mediaTimeSec;

      const playheadPastRight = currTime > rightmostTime + MARKER_NAV_EPSILON_SEC;
      const playheadBeforeLeft = currTime < leftmostTime - MARKER_NAV_EPSILON_SEC;
      const playheadInsideOrAt = !playheadPastRight && !playheadBeforeLeft;

      const idx = markers.findIndex(
        (marker) => marker.mediaTimeSec > currTime + MARKER_NAV_EPSILON_SEC
      );
      const targetIndex = idx !== -1 ? idx : markers.length - 1;

      let newLeftmost: number;
      let newRightmost: number;
      let seekTarget: number;

      if (playheadInsideOrAt) {
        if (selectedIndices.length === 1) {
          if (rightmostIndex === markers.length - 1) {
            return;
          }
          newLeftmost = leftmostIndex;
          newRightmost = rightmostIndex + 1;
          seekTarget = newRightmost;
        } else {
          const atRightmost = Math.abs(currTime - rightmostTime) < MARKER_NAV_EPSILON_SEC;
          const atLeftmost = Math.abs(currTime - leftmostTime) < MARKER_NAV_EPSILON_SEC;

          if (atRightmost) {
            if (rightmostIndex === markers.length - 1) {
              return;
            }
            newLeftmost = leftmostIndex;
            newRightmost = rightmostIndex + 1;
            seekTarget = newRightmost;
          } else if (atLeftmost) {
            newLeftmost = Math.min(leftmostIndex + 1, rightmostIndex);
            newRightmost = rightmostIndex;
            seekTarget = newLeftmost;
          } else {
            let markerAtOrBeforePlayhead = leftmostIndex;
            for (let i = markers.length - 1; i >= 0; i -= 1) {
              if (markers[i].mediaTimeSec <= currTime + MARKER_NAV_EPSILON_SEC) {
                markerAtOrBeforePlayhead = i;
                break;
              }
            }
            const markerAfterPlayhead = markers.findIndex(
              (marker) => marker.mediaTimeSec > currTime + MARKER_NAV_EPSILON_SEC
            );
            const effectiveMarkerAfter =
              markerAfterPlayhead !== -1 ? markerAfterPlayhead : rightmostIndex;
            newLeftmost = leftmostIndex;
            newRightmost = Math.min(effectiveMarkerAfter, rightmostIndex);
            seekTarget = newRightmost;
          }
        }
      } else {
        newLeftmost = Math.min(leftmostIndex, targetIndex);
        newRightmost = Math.max(rightmostIndex, targetIndex);
        seekTarget = targetIndex;
      }

      const selectionIds: string[] = [];
      for (let i = newLeftmost; i <= newRightmost; i += 1) {
        selectionIds.push(markers[i].markerId);
      }
      setSelectionByIds(selectionIds);
      deps.refs.videoPlayerRef.current?.seekTo(markers[seekTarget].mediaTimeSec);
    },
    'markers.markerListHighlightPrev': () => {
      const markers = deps.markers.queries.activeMediaMarkers;
      if (markers.length === 0) return;

      const currentId = deps.input.state.highlightedMarkerId;
      const currentIndex = currentId
        ? markers.findIndex((marker) => marker.markerId === currentId)
        : -1;

      deps.input.actions.set({ markerListAnchorId: null });

      if (currentIndex <= 0) return;
      deps.input.actions.set({ highlightedMarkerId: markers[currentIndex - 1].markerId });
    },
    'markers.markerListHighlightNext': () => {
      const markers = deps.markers.queries.activeMediaMarkers;
      if (markers.length === 0) return;

      const currentId = deps.input.state.highlightedMarkerId;
      const currentIndex = currentId
        ? markers.findIndex((marker) => marker.markerId === currentId)
        : -1;

      deps.input.actions.set({ markerListAnchorId: null });

      if (currentIndex === -1) {
        deps.input.actions.set({ highlightedMarkerId: markers[0].markerId });
        return;
      }
      if (currentIndex < markers.length - 1) {
        deps.input.actions.set({ highlightedMarkerId: markers[currentIndex + 1].markerId });
      }
    },
    'markers.markerListHighlightPrevExtend': () => {
      const markers = deps.markers.queries.activeMediaMarkers;
      if (markers.length === 0) return;

      const currentId = deps.input.state.highlightedMarkerId;
      const currentIndex = currentId
        ? markers.findIndex((marker) => marker.markerId === currentId)
        : -1;

      if (deps.input.state.markerListAnchorId === null && currentId) {
        deps.input.actions.set({ markerListAnchorId: currentId });
      }

      if (currentIndex <= 0) return;
      deps.input.actions.set({ highlightedMarkerId: markers[currentIndex - 1].markerId });
    },
    'markers.markerListHighlightNextExtend': () => {
      const markers = deps.markers.queries.activeMediaMarkers;
      if (markers.length === 0) return;

      const currentId = deps.input.state.highlightedMarkerId;
      const currentIndex = currentId
        ? markers.findIndex((marker) => marker.markerId === currentId)
        : -1;

      if (deps.input.state.markerListAnchorId === null && currentId) {
        deps.input.actions.set({ markerListAnchorId: currentId });
      }

      if (currentIndex === -1) {
        deps.input.actions.set({ highlightedMarkerId: markers[0].markerId });
        return;
      }
      if (currentIndex < markers.length - 1) {
        deps.input.actions.set({ highlightedMarkerId: markers[currentIndex + 1].markerId });
      }
    },
    'markers.markerListEnter': () => {
      const markerId = deps.input.state.highlightedMarkerId;
      if (!markerId) return;

      const hasRange = deps.input.state.markerListAnchorId !== null;
      if (hasRange && deps.input.state.markerListAnchorId) {
        deps.markers.actions.selectRange(deps.input.state.markerListAnchorId, markerId);
        deps.input.actions.set({ markerListAnchorId: null });
        seekToMarker(markerId, deps.markers.queries.activeMediaMarkers);
        return;
      }

      deps.markers.actions.selectOnly(markerId);
      seekToMarker(markerId, deps.markers.queries.activeMediaMarkers);
    },
    'markers.markerListEnterCtrl': () => {
      const markerId = deps.input.state.highlightedMarkerId;
      if (!markerId) return;

      const hasRange = deps.input.state.markerListAnchorId !== null;
      if (hasRange && deps.input.state.markerListAnchorId) {
        deps.markers.actions.addRangeToSelection(deps.input.state.markerListAnchorId, markerId);
        deps.input.actions.set({ markerListAnchorId: null });
        seekToMarker(markerId, deps.markers.queries.activeMediaMarkers);
        return;
      }

      deps.markers.actions.addToSelection(markerId);
      seekToMarker(markerId, deps.markers.queries.activeMediaMarkers);
    },
    'markers.markerListEnterShift': () => {
      const markerId = deps.input.state.highlightedMarkerId;
      if (!markerId) return;

      const hasRange = deps.input.state.markerListAnchorId !== null;
      if (hasRange && deps.input.state.markerListAnchorId) {
        deps.markers.actions.addRangeToSelection(deps.input.state.markerListAnchorId, markerId);
        deps.input.actions.set({ markerListAnchorId: null });
        seekToMarker(markerId, deps.markers.queries.activeMediaMarkers);
        return;
      }

      deps.markers.actions.addShiftRangeToSelection(markerId);
      seekToMarker(markerId, deps.markers.queries.activeMediaMarkers);
    },
    'markers.drawingUndo': () => deps.markers.actions.undoStroke(),
    'markers.drawingRedo': () => deps.markers.actions.redoStroke(),
    'markers.drawingToolPrev': () => {
      const current = deps.markers.state.drawingToolIndex;
      const next = current === 0 ? 3 : ((current - 1) as 0 | 1 | 2 | 3);
      deps.markers.actions.setDrawingToolIndex(next);
    },
    'markers.drawingToolNext': () => {
      const current = deps.markers.state.drawingToolIndex;
      const next = current === 3 ? 0 : ((current + 1) as 0 | 1 | 2 | 3);
      deps.markers.actions.setDrawingToolIndex(next);
    },
    'markers.drawingActivateTool': () => {
      const toolIndex = deps.markers.state.drawingToolIndex;
      if (toolIndex === 0) {
        return deps.markers.actions.undoStroke();
      }
      if (toolIndex === 1) {
        return deps.markers.actions.redoStroke();
      }
      if (toolIndex === 2) {
        const marker = deps.markers.queries.selectedMarker;
        if (!marker) return;
        return deps.markers.actions
          .updateMarker(marker.markerId, { drawing: null })
          .then(() => undefined);
      }
    },
    'markers.drawingColorPrev': () => {
      if (deps.markers.state.drawingToolIndex !== 3) return;
      const current = deps.markers.state.drawingColorIndex;
      const next = current <= 0 ? DRAWING_COLORS.length - 1 : current - 1;
      deps.markers.actions.setDrawingColorByIndex(next);
    },
    'markers.drawingColorNext': () => {
      if (deps.markers.state.drawingToolIndex !== 3) return;
      const current = deps.markers.state.drawingColorIndex;
      const next = current >= DRAWING_COLORS.length - 1 ? 0 : current + 1;
      deps.markers.actions.setDrawingColorByIndex(next);
    },
  };
}
