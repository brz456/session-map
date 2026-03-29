import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { InputDomain } from '../input/inputDomain';
import type { SessionDomainState, SessionDomainActions } from '../session/sessionDomain';
import type { RecordingDomainActions } from '../recording/recordingDomain';
import type { PlaybackDomainState, PlaybackDomainActions } from './playbackDomain';
import type { VideoPlayerHandle } from '../../components/player/videoPlayerTypes';
import type { ModalDomainActions } from '../modals/modalDomain';

export function createPlaybackCommands(deps: {
  input: InputDomain;
  session: {
    state: SessionDomainState;
    actions: Pick<SessionDomainActions, 'importMediaFromDisk' | 'removeMediaFromSession' | 'getMediaReferenceCount'>;
  };
  modals: {
    actions: Pick<ModalDomainActions, 'open'>;
  };
  playback: { state: PlaybackDomainState; actions: PlaybackDomainActions };
  recording: { actions: Pick<RecordingDomainActions, 'logTelemetry'> };
  canImportMedia: boolean;
  canDeleteMedia: boolean;
  refs: {
    videoPlayerRef: React.RefObject<VideoPlayerHandle>;
  };
  dom: { blurActiveElement(): void };
}): PartialCommandRegistry {
  const selectMediaByIndex = (index: number) => {
    const session = deps.session.state.session;
    if (!session) return;
    if (index < 0 || index >= session.media.assets.length) return;
    if (index === deps.playback.state.activeMediaIndex) return;
    deps.playback.actions.selectMedia(index);
    deps.recording.actions.logTelemetry('load');
  };

  return {
    'playback.selectMedia1': () => selectMediaByIndex(0),
    'playback.selectMedia2': () => selectMediaByIndex(1),
    'playback.selectMedia3': () => selectMediaByIndex(2),
    'playback.selectMedia4': () => selectMediaByIndex(3),
    'playback.selectMedia5': () => selectMediaByIndex(4),
    'playback.selectMedia6': () => selectMediaByIndex(5),
    'playback.selectMedia7': () => selectMediaByIndex(6),
    'playback.selectMedia8': () => selectMediaByIndex(7),
    'playback.selectMedia9': () => selectMediaByIndex(8),
    'playback.selectMedia10': () => selectMediaByIndex(9),
    'playback.enterClipsMode': () => {
      const session = deps.session.state.session;
      if (!session) return;

      deps.dom.blurActiveElement();
      deps.input.actions.resetToPlayerMode();

      const count = session.media.assets.length;
      const activeIndex = deps.playback.state.activeMediaIndex;
      const nextIndex = count > 0 && activeIndex >= 0 && activeIndex < count ? activeIndex : 0;

      deps.input.actions.set({
        sessionMode: 'clips',
        highlightedClipIndex: nextIndex,
      });
    },
    'playback.togglePlayPause': () => {
      deps.dom.blurActiveElement();
      deps.refs.videoPlayerRef.current?.togglePlayPause();
    },
    'playback.seekBackCoarse': () => deps.refs.videoPlayerRef.current?.seekRelative(-5),
    'playback.seekBackFine': () => deps.refs.videoPlayerRef.current?.seekRelative(-1),
    'playback.seekForwardCoarse': () => deps.refs.videoPlayerRef.current?.seekRelative(5),
    'playback.seekForwardFine': () => deps.refs.videoPlayerRef.current?.seekRelative(1),
    'playback.stepFrameBack': () => deps.refs.videoPlayerRef.current?.stepFrame(-1),
    'playback.stepFrameForward': () => deps.refs.videoPlayerRef.current?.stepFrame(1),
    'playback.rateDown': () => deps.refs.videoPlayerRef.current?.adjustPlaybackRate(-1),
    'playback.rateUp': () => deps.refs.videoPlayerRef.current?.adjustPlaybackRate(1),
    'playback.clipsMoveUp': () => {
      const session = deps.session.state.session;
      if (!session) return;

      const assetCount = session.media.assets.length;
      const importIndex = assetCount;
      const currentIndex = deps.input.state.highlightedClipIndex;

      if (assetCount === 0) {
        if (currentIndex !== importIndex) {
          deps.input.actions.set({ highlightedClipIndex: importIndex });
        }
        return;
      }

      if (currentIndex === -1) {
        deps.input.actions.set({ highlightedClipIndex: 0 });
        return;
      }

      if (currentIndex === importIndex) {
        return;
      }

      if (currentIndex === 0) {
        deps.input.actions.set({ highlightedClipIndex: importIndex });
        return;
      }

      if (currentIndex > 0 && currentIndex < importIndex) {
        deps.input.actions.set({ highlightedClipIndex: currentIndex - 1 });
      }
    },
    'playback.clipsMoveDown': () => {
      const session = deps.session.state.session;
      if (!session) return;

      const assetCount = session.media.assets.length;
      const importIndex = assetCount;
      const currentIndex = deps.input.state.highlightedClipIndex;

      if (assetCount === 0) {
        if (currentIndex !== importIndex) {
          deps.input.actions.set({ highlightedClipIndex: importIndex });
        }
        return;
      }

      if (currentIndex === -1) {
        deps.input.actions.set({ highlightedClipIndex: 0 });
        return;
      }

      if (currentIndex < assetCount - 1) {
        deps.input.actions.set({ highlightedClipIndex: currentIndex + 1 });
        return;
      }

      if (currentIndex === assetCount - 1) {
        return;
      }

      if (currentIndex === importIndex) {
        deps.input.actions.set({ highlightedClipIndex: 0 });
      }
    },
    'playback.clipsActivate': () => {
      const session = deps.session.state.session;
      if (!session) return;

      const assetCount = session.media.assets.length;
      const highlightedIndex = deps.input.state.highlightedClipIndex;

      if (highlightedIndex < 0) return;
      if (highlightedIndex < assetCount) {
        if (highlightedIndex === deps.playback.state.activeMediaIndex) return;

        deps.playback.actions.selectMedia(highlightedIndex);
        deps.recording.actions.logTelemetry('load');
        deps.input.actions.set({
          sessionMode: 'clips',
          highlightedClipIndex: highlightedIndex,
        });
        return;
      }
      if (highlightedIndex === assetCount) {
        if (!deps.canImportMedia) return;
        return deps.session.actions.importMediaFromDisk();
      }
    },
    'playback.clipsDeleteHighlighted': () => {
      if (!deps.canDeleteMedia) return;
      const session = deps.session.state.session;
      if (!session) return;

      const highlightedIndex = deps.input.state.highlightedClipIndex;
      if (highlightedIndex < 0 || highlightedIndex >= session.media.assets.length) {
        return;
      }

      const mediaId = session.media.assets[highlightedIndex]?.mediaId;
      if (!mediaId) return;

      const media = session.media.assets[highlightedIndex];
      if (!media) return;

      return (async () => {
        const referenceResult = await deps.session.actions.getMediaReferenceCount(mediaId);
        if (!referenceResult.ok) return;

        if (referenceResult.markerCount > 0 || referenceResult.eventCount > 0) {
          deps.modals.actions.open('clipDeleteConfirm', {
            type: 'clip',
            id: mediaId,
            name: media.displayName,
            markerCount: referenceResult.markerCount,
            eventCount: referenceResult.eventCount,
          });
          return;
        }

        await deps.session.actions.removeMediaFromSession(mediaId);
      })();
    },
  };
}
