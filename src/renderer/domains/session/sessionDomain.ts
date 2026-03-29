import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionUiEvent, SessionUiSnapshot } from '../../../shared/ipc/sessionUi';
import type { AppBaseDeps } from '../../app/appDeps';
import type { SessionStatus } from '../../app/appTypes';
import type { InputDomain } from '../input/inputDomain';
import { useSessionPersistence } from '../../session/useSessionPersistence';
import type { UseSessionPersistenceResult } from '../../session/useSessionPersistence';

export interface SessionDomainState {
  session: SessionUiSnapshot | null;
  sessionDir: string | null;
  /** Monotonic ordering guard; last applied `SessionUiEvent.uiRevision`. */
  uiRevision: number;
  sessionStatus: SessionStatus;
  editingSessionName: string | null;
}

export interface SessionDomainActions {
  /** Installs UI snapshot subscription + runs initial hydration. Returns cleanup to unsubscribe (StrictMode-safe). */
  syncOnMount(): () => void;
  recoverInterruptedRecording(opts?: RecoverInterruptedRecordingOptions): Promise<boolean>;
  createSession(name: string): Promise<void>;
  openSession(sessionDir: string): Promise<void>;
  closeSession(): Promise<void>;
  renameSession(newName: string): Promise<void>;
  /** Orchestrates dialog -> media.addAsset -> session.addMediaAsset. */
  importMediaFromDisk(): Promise<void>;
  getMediaReferenceCount(
    mediaId: string
  ): Promise<
    | { ok: true; markerCount: number; eventCount: number }
    | { ok: false; code: string; message: string }
  >;
  removeMediaFromSession(mediaId: string): Promise<void>;
  /**
   * Global status SSoT setter (owned by session domain).
   * Used by the recording domain to drive `starting`/`running`/`stopping` transitions.
   */
  setSessionStatus(status: SessionStatus): void;
  setEditingSessionName(name: string | null): void;
}

export type RecoverInterruptedRecordingOptions = {
  shouldAbort?: () => boolean;
  /**
   * Context for error messaging (startup/load vs stopRecording failure).
   * Default: 'startup'.
   */
  reason?: 'startup' | 'stop_failure';
  /** Optional additional message to append (e.g. OBS shutdown issues). */
  extraErrorContext?: string | null;
};

export interface SessionDomain {
  state: SessionDomainState;
  actions: SessionDomainActions;
  persistence: UseSessionPersistenceResult;
}

export function useSessionDomain(
  deps: AppBaseDeps & { input: InputDomain }
): SessionDomain {
  const [session, setSession] = useState<SessionUiSnapshot | null>(null);
  const [sessionDir, setSessionDir] = useState<string | null>(null);
  const [uiRevision, setUiRevision] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('initializing');
  const [editingSessionName, setEditingSessionName] = useState<string | null>(null);
  const persistence = useSessionPersistence(deps.api.session, sessionDir);

  const setError = deps.errors.set;
  const clearError = deps.errors.clear;
  const setInput = deps.input.actions.set;

  const uiRevisionRef = useRef(0);
  const sessionStatusRef = useRef<SessionStatus>(sessionStatus);
  const subscriptionIdRef = useRef<number | null>(null);
  const highlightedClipIndexRef = useRef(deps.input.state.highlightedClipIndex);

  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

  useEffect(() => {
    highlightedClipIndexRef.current = deps.input.state.highlightedClipIndex;
  }, [deps.input.state.highlightedClipIndex]);

  const applyUiSnapshot = useCallback((event: SessionUiEvent) => {
    if (event.uiRevision <= uiRevisionRef.current) {
      return;
    }
    uiRevisionRef.current = event.uiRevision;
    setUiRevision(event.uiRevision);
    setSession(event.session);
    setSessionDir(event.sessionDir);
  }, []);

  const recoverInterruptedRecording = useCallback(async (opts?: RecoverInterruptedRecordingOptions): Promise<boolean> => {
    const shouldAbort = opts?.shouldAbort;
    const reason = opts?.reason ?? 'startup';
    const extraErrorContext = opts?.extraErrorContext ?? null;
    const isCancelled = () => shouldAbort?.() === true;
    const appendExtra = (message: string): string => {
      return extraErrorContext ? `${message}. ${extraErrorContext}` : message;
    };
    const interruptedLabel =
      reason === 'stop_failure' ? 'Recording failed' : 'Previous recording was interrupted';

    const cleanupResult = await deps.api.session.cleanupInterruptedRecording();
    if (isCancelled()) return false;
    if (!cleanupResult.ok) {
      const closeResult = await deps.api.session.close();
      if (isCancelled()) return false;
      if (!closeResult.ok) {
        if (isCancelled()) return false;
        setError(
          appendExtra(
            `Cleanup failed and session close failed: ${cleanupResult.message}; ${closeResult.message}. Session may be inconsistent.`
          )
        );
        setSessionStatus('error');
        return false;
      }
      if (isCancelled()) return false;
      const baseMessage =
        reason === 'stop_failure'
          ? `Recording failed and cleanup failed: ${cleanupResult.message}. Session closed.`
          : `Failed to cleanup interrupted recording: ${cleanupResult.message}. Session closed.`;
      setError(appendExtra(baseMessage));
      setSessionStatus('idle');
      setInput({ workspace: 'home' });
      return false;
    }

    const saveResult = await deps.api.session.save();
    if (isCancelled()) return false;
    if (!saveResult.ok) {
      const closeResult = await deps.api.session.close();
      if (isCancelled()) return false;
      if (!closeResult.ok) {
        if (isCancelled()) return false;
        setError(
          appendExtra(
            `Save failed and session close failed: ${saveResult.message}; ${closeResult.message}. Session may be inconsistent.`
          )
        );
        setSessionStatus('error');
        return false;
      }
      if (isCancelled()) return false;
      const baseMessage =
        reason === 'stop_failure'
          ? `Recording failed and save failed: ${saveResult.message}. Session closed.`
          : `Failed to save after cleanup: ${saveResult.message}. Session closed.`;
      setError(appendExtra(baseMessage));
      setSessionStatus('idle');
      setInput({ workspace: 'home' });
      return false;
    }

    const cleanedResult = await deps.api.session.get();
    if (isCancelled()) return false;
    if (!cleanedResult.ok) {
      const closeResult = await deps.api.session.close();
      if (isCancelled()) return false;
      if (!closeResult.ok) {
        if (isCancelled()) return false;
        setError(
          appendExtra(
            `Get failed and session close failed: ${cleanedResult.message}; ${closeResult.message}. Session may be inconsistent.`
          )
        );
        setSessionStatus('error');
        return false;
      }
      if (isCancelled()) return false;
      const baseMessage =
        reason === 'stop_failure'
          ? `Recording failed and get failed: ${cleanedResult.message}. Session closed.`
          : `Failed to get cleaned session: ${cleanedResult.message}. Session closed.`;
      setError(appendExtra(baseMessage));
      setSessionStatus('idle');
      setInput({ workspace: 'home' });
      return false;
    }
    if (!cleanedResult.session) {
      const closeResult = await deps.api.session.close();
      if (isCancelled()) return false;
      if (!closeResult.ok) {
        if (isCancelled()) return false;
        setError(
          appendExtra(
            `Get returned no session and session close failed: ${closeResult.message}. Session may be inconsistent.`
          )
        );
        setSessionStatus('error');
        return false;
      }
      if (isCancelled()) return false;
      const baseMessage =
        reason === 'stop_failure'
          ? 'Recording failed and session not found after cleanup. Session closed.'
          : 'Failed to get cleaned session: session not found. Session closed.';
      setError(appendExtra(baseMessage));
      setSessionStatus('idle');
      setInput({ workspace: 'home' });
      return false;
    }

    const removed = `${cleanupResult.markersRemoved ?? 0} markers, ${cleanupResult.eventsRemoved ?? 0} telemetry events`;
    if (isCancelled()) return false;
    const successMessage =
      reason === 'stop_failure'
        ? `${interruptedLabel}. Orphaned data removed: ${removed}`
        : `${interruptedLabel}. Removed orphaned data: ${removed}.`;
    setError(appendExtra(successMessage));
    if (isCancelled()) return false;
    applyUiSnapshot({
      type: 'session_ui_snapshot',
      uiRevision: cleanedResult.uiRevision,
      session: cleanedResult.session,
      sessionDir: cleanedResult.sessionDir,
    });
    if (isCancelled()) return false;
    setSessionStatus('stopped');
    setInput({ workspace: 'session' });
    return true;
  }, [applyUiSnapshot, deps.api.session, setError, setInput]);

  const syncOnMount = useCallback(() => {
    let cancelled = false;
    if (subscriptionIdRef.current === null) {
      subscriptionIdRef.current = deps.api.session.subscribeUiSnapshot(applyUiSnapshot);
    }

    void (async () => {
      try {
        const getResult = await deps.api.session.get();
        if (cancelled) return;
        if (!getResult.ok) {
          setError(`Failed to restore session: ${getResult.message}. Session may be inconsistent.`);
          setSessionStatus('error');
          return;
        }

        if (cancelled) return;
        applyUiSnapshot({
          type: 'session_ui_snapshot',
          uiRevision: getResult.uiRevision,
          session: getResult.session,
          sessionDir: getResult.sessionDir,
        });

        if (!getResult.session) {
          if (cancelled) return;
          setSessionStatus('idle');
          setInput({ workspace: 'home' });
          return;
        }

        if (getResult.session.inProgressRecording) {
          if (cancelled) return;
          await recoverInterruptedRecording({ shouldAbort: () => cancelled, reason: 'startup' });
          return;
        }

        if (cancelled) return;
        setSessionStatus('stopped');
        setInput({ workspace: 'session' });
      } catch (err) {
        if (cancelled) return;
        setError(`Failed to restore session: ${err instanceof Error ? err.message : String(err)}`);
        setSessionStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (subscriptionIdRef.current !== null) {
        deps.api.session.unsubscribeUiSnapshot(subscriptionIdRef.current);
        subscriptionIdRef.current = null;
      }
    };
  }, [applyUiSnapshot, deps.api.session, recoverInterruptedRecording, setError, setInput]);

  const createSession = useCallback(
    async (name: string) => {
      const status = sessionStatusRef.current;
      if (status === 'initializing' || status === 'creating' || status === 'loading') {
        return;
      }

      setSessionStatus('creating');
      clearError();

      try {
        const ensureResult = await deps.api.appFolder.ensure();
        if (!ensureResult.ok) {
          setError(`Failed to access app folder: ${ensureResult.message}`);
          setSessionStatus('error');
          return;
        }

        const result = await deps.api.session.create(ensureResult.path, name);
        if (!result.ok) {
          setError(`Failed to create session: ${result.message}`);
          setSessionStatus('error');
          return;
        }

        const getResult = await deps.api.session.get();
        if (!getResult.ok) {
          setError(`Failed to get session: ${getResult.message}`);
          setSessionStatus('error');
          return;
        }
        if (!getResult.session) {
          setError('Failed to get session: session not found');
          setSessionStatus('error');
          return;
        }

        applyUiSnapshot({
          type: 'session_ui_snapshot',
          uiRevision: getResult.uiRevision,
          session: getResult.session,
          sessionDir: getResult.sessionDir,
        });
        setSessionStatus('stopped');
        setInput({ workspace: 'session' });
      } catch (err) {
        setError(`Failed to create session: ${err instanceof Error ? err.message : String(err)}`);
        setSessionStatus('error');
      }
    },
    [applyUiSnapshot, clearError, deps.api.appFolder, deps.api.session, setError, setInput]
  );

  const openSession = useCallback(
    async (targetSessionDir: string) => {
      const status = sessionStatusRef.current;
      if (status === 'initializing' || status === 'creating' || status === 'loading') {
        return;
      }

      setSessionStatus('loading');
      clearError();

      try {
        const result = await deps.api.session.load(targetSessionDir);
        if (!result.ok) {
          setError(`Failed to load session: ${result.message}`);
          setSessionStatus('error');
          return;
        }

        applyUiSnapshot({
          type: 'session_ui_snapshot',
          uiRevision: result.uiRevision,
          session: result.session,
          sessionDir: result.sessionDir,
        });

        if (result.session.inProgressRecording) {
          await recoverInterruptedRecording({ reason: 'startup' });
          return;
        }

        setSessionStatus('stopped');
        setInput({ workspace: 'session' });
      } catch (err) {
        setError(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
        setSessionStatus('error');
      }
    },
    [applyUiSnapshot, clearError, deps.api.session, recoverInterruptedRecording, setError, setInput]
  );

  const closeSession = useCallback(async () => {
    const status = sessionStatusRef.current;
    if (status === 'initializing' || status === 'creating' || status === 'loading') {
      return;
    }

    try {
      const closeResult = await deps.api.session.close();
      if (!closeResult.ok) {
        setError(`Failed to close session: ${closeResult.message}`);
        return;
      }

      const getResult = await deps.api.session.get();
      if (!getResult.ok) {
        setError(`Failed to get session after close: ${getResult.message}. Session may be inconsistent.`);
        setSessionStatus('error');
        return;
      }

      applyUiSnapshot({
        type: 'session_ui_snapshot',
        uiRevision: getResult.uiRevision,
        session: getResult.session,
        sessionDir: getResult.sessionDir,
      });
      setSessionStatus('idle');
      setInput({ workspace: 'home' });
      clearError();
    } catch (err) {
      setError(`Error closing session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [applyUiSnapshot, clearError, deps.api.session, setError, setInput]);

  const renameSession = useCallback(
    async (newName: string) => {
      if (!session) {
        setEditingSessionName(null);
        return;
      }

      const trimmedName = newName.trim();
      if (!trimmedName || trimmedName === session.name) {
        setEditingSessionName(null);
        return;
      }

      try {
        const ipcResult = await deps.api.session.rename(trimmedName);
        if (!ipcResult.ok) {
          setError(`Failed to rename session: ${ipcResult.message}`);
          return;
        }
        persistence.markDirty();
      } catch (err) {
        setError(`Failed to rename session: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setEditingSessionName(null);
      }
    },
    [deps.api.session, persistence, session, setError]
  );

  const importMediaFromDisk = useCallback(async () => {
    if (!session) {
      return;
    }

    try {
      const dialogResult = await deps.api.dialog.pickMediaFiles();
      if (!dialogResult.ok) return;

      for (const filePath of dialogResult.paths) {
        const result = await deps.api.media.addAsset(filePath);
        if (!result.ok) {
          setError(`Failed to add media: ${result.message}`);
          continue;
        }

        const addResult = await deps.api.session.addMediaAsset(result.asset);
        if (!addResult.ok) {
          setError(`Failed to add media to session: ${addResult.message}`);
          continue;
        }

        persistence.markDirty();
      }
    } catch (err) {
      setError(`Failed to import media: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [deps.api.dialog, deps.api.media, deps.api.session, persistence, session, setError]);

  const getMediaReferenceCount = useCallback(
    async (
      mediaId: string
    ): Promise<
      | { ok: true; markerCount: number; eventCount: number }
      | { ok: false; code: string; message: string }
    > => {
      if (!session) {
        const message = 'No active session';
        setError(message);
        return { ok: false as const, code: 'no_active_session', message };
      }

      try {
        const result = await deps.api.session.getMediaReferenceCount(mediaId);
        if (!result.ok) {
          setError(`Failed to check media references: ${result.message}`);
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to check media references: ${message}`);
        return { ok: false as const, code: 'exception', message };
      }
    },
    [deps.api.session, session, setError]
  );

  const removeMediaFromSession = useCallback(async (mediaId: string) => {
    if (!session) {
      return;
    }

    const oldAssets = session.media.assets;
    const oldCount = oldAssets.length;
    const removedIndex = oldAssets.findIndex((asset) => asset.mediaId === mediaId);
    const currentHighlighted = highlightedClipIndexRef.current;
    const oldImportIndex = oldCount;

    try {
      const result = await deps.api.session.removeMediaAsset(mediaId);
      if (!result.ok) {
        if (result.code === 'media_not_found') {
          return;
        }
        setError(`Failed to remove media (${result.code}): ${result.message}`);
        return;
      }

      persistence.markDirty();

      const newCount = Math.max(0, oldCount - (removedIndex >= 0 ? 1 : 0));
      let nextHighlighted = currentHighlighted;

      if (currentHighlighted === oldImportIndex) {
        nextHighlighted = newCount;
      } else if (removedIndex >= 0 && currentHighlighted > removedIndex) {
        nextHighlighted = currentHighlighted - 1;
      } else if (removedIndex >= 0 && currentHighlighted === removedIndex) {
        nextHighlighted = newCount === 0 ? -1 : Math.min(removedIndex, newCount - 1);
      }

      const minHighlight = -1;
      const maxHighlight =
        currentHighlighted === oldImportIndex
          ? newCount
          : Math.max(-1, newCount - 1);
      const clampedHighlight = Math.min(Math.max(nextHighlighted, minHighlight), maxHighlight);

      if (highlightedClipIndexRef.current !== currentHighlighted) {
        return;
      }
      if (clampedHighlight !== currentHighlighted) {
        setInput({ highlightedClipIndex: clampedHighlight });
      }
    } catch (err) {
      setError(`Failed to remove media: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [deps.api.session, persistence, session, setError, setInput]);

  return {
    state: {
      session,
      sessionDir,
      uiRevision,
      sessionStatus,
      editingSessionName,
    },
    actions: {
      syncOnMount,
      recoverInterruptedRecording,
      createSession,
      openSession,
      closeSession,
      renameSession,
      importMediaFromDisk,
      getMediaReferenceCount,
      removeMediaFromSession,
      setSessionStatus,
      setEditingSessionName,
    },
    persistence,
  };
}
