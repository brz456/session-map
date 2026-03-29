import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppView } from './AppView';
import { HomeView } from '../views/HomeView';
import { SessionView } from '../views/SessionView';
import { ProcessingView } from '../views/ProcessingView';
import { ThemeSwitcher } from '../styles/useTheme';
import { useErrors } from './useErrors';
import { useFeedback } from './useFeedback';
import { ModalLayer } from './ModalLayer';
import { useInputDomain } from '../domains/input/inputDomain';
import { useHomeDomain } from '../domains/home/homeDomain';
import { useSessionDomain } from '../domains/session/sessionDomain';
import { usePlaybackDomain } from '../domains/playback/playbackDomain';
import { useRecordingDomain } from '../domains/recording/recordingDomain';
import { useMarkerDomain } from '../domains/markers/markerDomain';
import { useBucketDomain } from '../domains/buckets/bucketDomain';
import { useTagDomain } from '../domains/tags/tagDomain';
import { useExportDomain } from '../domains/export/exportDomain';
import { useModalDomain } from '../domains/modals/modalDomain';
import { createInputCommands } from '../domains/input/commands';
import { createHomeCommands } from '../domains/home/commands';
import { createSessionCommands } from '../domains/session/commands';
import { createRecordingCommands } from '../domains/recording/commands';
import { createPlaybackCommands } from '../domains/playback/commands';
import { createMarkerCommands } from '../domains/markers/commands';
import { createBucketCommands } from '../domains/buckets/commands';
import { createTagCommands } from '../domains/tags/commands';
import { createModalCommands } from '../domains/modals/commands';
import { createExportCommands } from '../domains/export/commands';
import type { InputState } from '../input/modes';
import { HOME_KEYMAPS } from '../input/keymaps/home';
import { SESSION_VIDEO_KEYMAPS } from '../input/keymaps/session.video';
import { SESSION_MODAL_KEYMAPS } from '../input/keymaps/session.modal';
import { PROCESSING_KEYMAPS } from '../input/keymaps/processing';
import { COMMAND_SPECS, type CommandId } from '../input/commands/spec';
import { composeCommandRegistry, dispatchCommand, type CommandRegistry } from '../input/commands/registry';
import { validateKeymapsAgainstCommands } from '../input/commands/validate';
import { routeKeyDown } from '../input/router/routeKeyDown';
import { blurActiveElement } from '../utils/dom';
import { formatTime } from '../utils/format';
import type { VideoPlayerHandle } from '../components/player/videoPlayerTypes';

const WINDOW_TITLE = 'SessionMap';
const ALL_KEYMAPS = [
  ...Object.values(HOME_KEYMAPS),
  ...Object.values(SESSION_VIDEO_KEYMAPS),
  ...Object.values(SESSION_MODAL_KEYMAPS),
  ...Object.values(PROCESSING_KEYMAPS),
];

const INITIAL_INPUT_STATE: InputState = {
  workspace: 'home',
  homeMode: 'list',
  sessionMode: 'player',
  sessionViewport: 'video',
  modalKind: 'none',
  homeHighlightedSessionId: null,
  homeSessionButtonFocus: 'open',
  homeDeleteChoice: 'cancel',
  closeConfirmChoice: 'cancel',
  deleteConfirmChoice: 'cancel',
  newSessionFocus: 'input',
  highlightedBucketId: null,
  highlightedTagId: null,
  highlightedMarkerId: null,
  markerListAnchorId: null,
  highlightedClipIndex: -1,
  bucketDraftTitle: '',
  tagDraftName: '',
};

export function AppShell(): JSX.Element {
  useEffect(() => {
    document.title = WINDOW_TITLE;
  }, []);

  const errors = useErrors();
  const feedback = useFeedback();

  const input = useInputDomain(INITIAL_INPUT_STATE);
  const modals = useModalDomain({ input });

  const baseDeps = useMemo(
    () => ({
      api: window.api,
      errors,
      feedback,
    }),
    [errors, feedback]
  );

  const session = useSessionDomain({ ...baseDeps, input });
  const persistence = session.persistence;
  const commonDeps = useMemo(
    () => ({
      ...baseDeps,
      persistence,
    }),
    [baseDeps, persistence]
  );
  const home = useHomeDomain(commonDeps);
  const playback = usePlaybackDomain({ ...commonDeps, session: session.state.session });
  const recording = useRecordingDomain({
    ...commonDeps,
    session: session.state.session,
    sessionDir: session.state.sessionDir,
    sessionStatus: session.state.sessionStatus,
    setSessionStatus: session.actions.setSessionStatus,
    sessionActions: { recoverInterruptedRecording: session.actions.recoverInterruptedRecording },
    input,
    playback: { state: playback.state, queries: playback.queries },
  });
  const markers = useMarkerDomain({
    ...commonDeps,
    session: session.state.session,
    sessionStatus: session.state.sessionStatus,
    input,
    playback: playback.state,
    recording: { state: recording.state, queries: recording.queries },
  });
  const buckets = useBucketDomain({ ...commonDeps, session: session.state.session });
  const tags = useTagDomain({ ...commonDeps, session: session.state.session });
  const exportDomain = useExportDomain(commonDeps);

  const syncOnMount = session.actions.syncOnMount;
  useEffect(() => {
    const cleanup = syncOnMount();
    return () => cleanup();
  }, [syncOnMount]);

  const prevWorkspaceRef = useRef(input.state.workspace);
  const requestHomeRefresh = home.actions.requestRefresh;
  useEffect(() => {
    if (prevWorkspaceRef.current !== 'home' && input.state.workspace === 'home') {
      requestHomeRefresh();
    }
    prevWorkspaceRef.current = input.state.workspace;
  }, [input.state.workspace, requestHomeRefresh]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const newSessionInputRef = useRef<HTMLInputElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);

  const closeSessionWithConfirm = useCallback(async () => {
    if (persistence.status.dirty) {
      modals.actions.open('closeConfirm');
      return;
    }
    await session.actions.closeSession();
  }, [modals.actions, persistence.status.dirty, session.actions]);

  const sessionForCommands = useMemo(
    () => ({
      state: session.state,
      actions: {
        ...session.actions,
        closeSession: closeSessionWithConfirm,
      },
      persistence: session.persistence,
    }),
    [closeSessionWithConfirm, session.actions, session.persistence, session.state]
  );

  const canImportMedia =
    session.state.sessionStatus !== 'starting' &&
    session.state.sessionStatus !== 'stopping' &&
    session.state.sessionStatus !== 'error' &&
    !exportDomain.state.isExporting;
  const canDeleteMedia =
    session.state.sessionStatus === 'stopped' &&
    !exportDomain.state.isExporting;

  const commands = useMemo(() => {
    const registry = composeCommandRegistry([
      createInputCommands({
        input,
        dom: { blurActiveElement },
        refs: { noteTextareaRef },
      }),
      createHomeCommands({
        input,
        home,
        session: { actions: session.actions },
        refs: { searchInputRef, newSessionInputRef },
      }),
      createSessionCommands({
        input,
        session: sessionForCommands,
        dom: { blurActiveElement },
      }),
      createRecordingCommands({ recording }),
      createPlaybackCommands({
        input,
        session: {
          state: session.state,
          actions: {
            importMediaFromDisk: session.actions.importMediaFromDisk,
            getMediaReferenceCount: session.actions.getMediaReferenceCount,
            removeMediaFromSession: session.actions.removeMediaFromSession,
          },
        },
        modals: { actions: { open: modals.actions.open } },
        playback,
        recording: { actions: { logTelemetry: recording.actions.logTelemetry } },
        canImportMedia,
        canDeleteMedia,
        refs: { videoPlayerRef },
        dom: { blurActiveElement },
      }),
      createMarkerCommands({
        feedback,
        input,
        session: { state: session.state },
        playback: {
          state: playback.state,
          actions: { requestSnapToTimeSec: playback.actions.requestSnapToTimeSec },
        },
        recording: { state: recording.state },
        markers,
        modals,
        refs: { videoPlayerRef, noteTextareaRef },
      }),
      createBucketCommands({
        feedback,
        input,
        buckets,
        markers: {
          state: markers.state,
          queries: { selectedMarker: markers.queries.selectedMarker },
          actions: { updateMarker: markers.actions.updateMarker },
        },
        modals,
      }),
      createTagCommands({
        feedback,
        input,
        tags,
        markers: {
          state: markers.state,
          queries: { selectedMarker: markers.queries.selectedMarker },
          actions: { updateMarker: markers.actions.updateMarker },
        },
        modals,
      }),
      createModalCommands({
        input,
        modals,
        session: { actions: session.actions },
        buckets: { actions: buckets.actions },
        tags: { actions: tags.actions },
        markers: { actions: { deleteMarker: markers.actions.deleteMarker, deselectAll: markers.actions.deselectAll } },
        home: { state: { newSessionName: home.state.newSessionName } },
        persistence,
      }),
      createExportCommands({ export: exportDomain, session: { state: session.state } }),
    ]);
    return registry;
  }, [
    buckets,
    canDeleteMedia,
    canImportMedia,
    exportDomain,
    feedback,
    home,
    input,
    markers,
    modals,
    noteTextareaRef,
    newSessionInputRef,
    persistence,
    playback,
    recording,
    searchInputRef,
    session,
    sessionForCommands,
    tags,
    videoPlayerRef,
  ]);

  const commandsRef = useRef<CommandRegistry>(commands);
  commandsRef.current = commands;
  useEffect(() => {
    validateKeymapsAgainstCommands({
      keymaps: ALL_KEYMAPS,
      specs: COMMAND_SPECS,
      commands: commandsRef.current,
    });
  }, []);
  const inputStateRef = useRef<InputState>(input.state);
  inputStateRef.current = input.state;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      routeKeyDown(e, inputStateRef.current, commandsRef.current, errors.set);
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [errors.set]);

  const runCommand = useCallback(
    (id: CommandId) => {
      void dispatchCommand({
        registry: commandsRef.current,
        invocation: { id },
        reportError: errors.set,
      });
    },
    [errors.set]
  );

  const handleWindowAction = useCallback(
    (action: () => Promise<void>, label: string) => {
      void action().catch((err) => {
        errors.set(`Window ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [errors.set]
  );

  const sessionView = (
    <SessionView
      session={sessionForCommands}
      input={input}
      playback={playback}
      recording={recording}
      markers={markers}
      buckets={buckets}
      tags={tags}
      export={exportDomain}
      modals={modals}
      errors={errors}
      canDeleteMedia={canDeleteMedia}
      refs={{ videoPlayerRef, noteTextareaRef }}
    />
  );

  return (
    <div className={`app ${recording.state.recordingActive ? 'app--recording' : ''}`}>
      <header className="app__header">
        <div className="app__brand">
          <img src="./favicon.ico" alt="" className="app__logo" />
          <h1 className="app__title">{WINDOW_TITLE}</h1>
        </div>

        <div className="app__header-center">
          {recording.state.recordingActive ? (
            <div className="app__rec-timer">
              <span className="app__rec-indicator" />
              <span className="app__rec-label">REC</span>
              {recording.state.fatalClockError ? (
                <span className="app__rec-time app__rec-time--error" title="Fatal clock error">
                  --:--
                </span>
              ) : (
                <span className="app__rec-time">
                  {formatTime(recording.state.sessionTimeSec)}
                </span>
              )}
            </div>
          ) : input.state.workspace === 'session' ? (
            <div className="app__header-status">
              <span className={`app__session-status app__session-status--${session.state.sessionStatus}`}>
                {session.state.sessionStatus}
              </span>
              {persistence.status.dirty && <span className="app__unsaved">Unsaved</span>}
              {persistence.status.lastError && (
                <span className="app__save-error" title={persistence.status.lastError}>
                  Save Error
                </span>
              )}
            </div>
          ) : null}
        </div>

        <ThemeSwitcher />

        <div className="app__window-controls">
          <button
            className="app__window-btn"
            onClick={() => handleWindowAction(window.api.window.minimize, 'minimize')}
            title="Minimize"
            aria-label="Minimize window"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
            </svg>
          </button>
          <button
            className="app__window-btn"
            onClick={() => handleWindowAction(window.api.window.maximize, 'maximize')}
            title="Maximize"
            aria-label="Maximize window"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            className="app__window-btn app__window-btn--close"
            onClick={() => handleWindowAction(window.api.window.close, 'close')}
            title="Close"
            aria-label="Close window"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {feedback.message && (
        <div className="app__feedback">
          {feedback.message}
        </div>
      )}

      {errors.message && (
        <div className="app__error">
          {errors.message}
          <button onClick={errors.clear}>Dismiss</button>
        </div>
      )}

      {recording.state.fatalClockError && (
        <div className="app__fatal-error">
          Fatal clock error detected. Telemetry and marker creation are blocked.
          Stop recording to clear this error.
        </div>
      )}
      <ModalLayer
        input={input}
        home={home}
        modals={modals}
        errors={errors}
        runCommand={runCommand}
        refs={{ newSessionInputRef }}
      />

      <AppView
        workspace={input.state.workspace}
        home={
          <HomeView
            home={home}
            input={input}
            session={{ actions: session.actions }}
            refs={{ searchInputRef, newSessionInputRef }}
          />
        }
        session={sessionView}
        processing={<ProcessingView />}
      />
    </div>
  );
}
