// src/renderer/session/useSessionPersistence.ts
// Debounced saves through preload API; fail closed with explicit UI errors
// Serialized saves with dirty generation tracking to prevent race conditions

import { useCallback, useEffect, useRef, useState } from 'react';
import { nowIso } from '../../shared/sessionPackage/types';
import type { RendererApi } from '../app/rendererApi';

/** Deterministic debounce constant (MVP fixed). */
export const SAVE_DEBOUNCE_MS = 250;

export interface SaveStatus {
  /** Whether there are unsaved changes. */
  dirty: boolean;
  /** ISO timestamp of the last successful save. */
  lastSavedAtIso: string | null;
  /** Error message from the last failed save attempt. */
  lastError: string | null;
  /** Whether a save is currently in progress. */
  saving: boolean;
}

/** Typed result for explicit save result handling. */
export type SaveResult = { ok: true } | { ok: false; message: string };

export type SessionPersistenceApi = Pick<RendererApi['session'], 'save'>;

export interface UseSessionPersistenceResult {
  status: SaveStatus;
  /** Trigger an immediate save (bypasses debounce). Updates status but doesn't return result. */
  saveNow(): Promise<void>;
  /** Flush save with explicit typed result. Use before closing session to ensure fail-closed behavior. */
  flushSave(): Promise<SaveResult>;
  /** Mark the session as dirty (triggers debounced save). */
  markDirty(): void;
  /** Cancel all pending/queued saves and reset dirty flag. Use on Discard to prevent unwanted persistence. */
  cancelPendingSaves(): void;
}

/**
 * Hook to manage session persistence with debounced saves.
 *
 * Debounce semantics (deterministic):
 * - Schedule a save SAVE_DEBOUNCE_MS after the last state change
 * - If more changes occur before the timer fires, reset the timer
 * - Saves are serialized (queued) to prevent out-of-order completion
 * - Dirty flag uses generation counter to handle markDirty() during in-flight saves
 */
export function useSessionPersistence(
  api: SessionPersistenceApi,
  sessionDir: string | null
): UseSessionPersistenceResult {
  const [status, setStatus] = useState<SaveStatus>({
    dirty: false,
    lastSavedAtIso: null,
    lastError: null,
    saving: false,
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionDirRef = useRef<string | null>(sessionDir);

  // Session generation counter - incremented on each sessionDir change
  // Used to ignore stale saves from previous sessions
  const sessionGenerationRef = useRef<number>(0);

  // Dirty generation counter - incremented on each markDirty()
  // Used to determine if dirty should be cleared after save completes
  const dirtyGenerationRef = useRef<number>(0);

  // Save queue for serialization (prevents overlapping saves)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const cancelPendingDebounce = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Reset state when session changes (new session or closed)
  // Must cancel debounce, reset queue, and increment generation to invalidate in-flight saves
  useEffect(() => {
    // Cancel any pending debounce from previous session
    cancelPendingDebounce();

    // Reset queue to prevent prior-session saves from running
    saveQueueRef.current = Promise.resolve();

    // Increment session generation to invalidate any in-flight saves
    sessionGenerationRef.current += 1;

    // Update ref and reset dirty tracking
    sessionDirRef.current = sessionDir;
    dirtyGenerationRef.current = 0;

    setStatus({
      dirty: false,
      lastSavedAtIso: null,
      lastError: null,
      saving: false,
    });
  }, [sessionDir, cancelPendingDebounce]);

  const performSave = useCallback(async (): Promise<void> => {
    // Fail closed: no active session is an explicit error, not silent no-op
    if (!sessionDirRef.current) {
      setStatus((prev) => ({
        ...prev,
        lastError: 'Save failed: no active session',
        saving: false,
      }));
      return;
    }

    // Capture generations at save start
    const saveSessionGeneration = sessionGenerationRef.current;
    const saveDirtyGeneration = dirtyGenerationRef.current;

    setStatus((prev) => ({ ...prev, saving: true }));

    try {
      const result = await api.save();

      // Check if session changed during save - if so, ignore result (stale)
      if (sessionGenerationRef.current !== saveSessionGeneration) {
        return;
      }

      if (result.ok) {
        setStatus((prev) => ({
          // Only clear dirty if no new markDirty() occurred during save
          dirty: dirtyGenerationRef.current !== saveDirtyGeneration ? prev.dirty : false,
          lastSavedAtIso: nowIso(),
          lastError: null,
          saving: false,
        }));
      } else {
        setStatus((prev) => ({
          ...prev,
          lastError: `Save failed: ${result.message}`,
          saving: false,
        }));
      }
    } catch (err) {
      // Check if session changed during save - if so, ignore error (stale)
      if (sessionGenerationRef.current !== saveSessionGeneration) {
        return;
      }

      setStatus((prev) => ({
        ...prev,
        lastError: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        saving: false,
      }));
    }
  }, [api]);

  // Serialized save - queues behind any in-flight save
  const queuedSave = useCallback((): Promise<void> => {
    saveQueueRef.current = saveQueueRef.current.then(() => performSave());
    return saveQueueRef.current;
  }, [performSave]);

  const saveNow = useCallback(async (): Promise<void> => {
    cancelPendingDebounce();
    await queuedSave();
  }, [cancelPendingDebounce, queuedSave]);

  // Flush save with explicit typed result - for fail-closed close operations
  const flushSave = useCallback(async (): Promise<SaveResult> => {
    cancelPendingDebounce();

    // Fail closed: no active session is an explicit error
    if (!sessionDirRef.current) {
      return { ok: false, message: 'No active session' };
    }

    // Capture generation at save start
    const saveSessionGeneration = sessionGenerationRef.current;
    const saveDirtyGeneration = dirtyGenerationRef.current;

    setStatus((prev) => ({ ...prev, saving: true }));

    try {
      const result = await api.save();

      // Check if session changed during save - if so, result is stale
      if (sessionGenerationRef.current !== saveSessionGeneration) {
        return { ok: false, message: 'Session changed during save (stale)' };
      }

      if (result.ok) {
        setStatus((prev) => ({
          dirty: dirtyGenerationRef.current !== saveDirtyGeneration ? prev.dirty : false,
          lastSavedAtIso: nowIso(),
          lastError: null,
          saving: false,
        }));
        return { ok: true };
      } else {
        setStatus((prev) => ({
          ...prev,
          lastError: `Save failed: ${result.message}`,
          saving: false,
        }));
        return { ok: false, message: result.message };
      }
    } catch (err) {
      // Check if session changed during save - if so, result is stale
      if (sessionGenerationRef.current !== saveSessionGeneration) {
        return { ok: false, message: 'Session changed during save (stale)' };
      }

      const message = err instanceof Error ? err.message : String(err);
      setStatus((prev) => ({
        ...prev,
        lastError: `Save failed: ${message}`,
        saving: false,
      }));
      return { ok: false, message };
    }
  }, [api, cancelPendingDebounce]);

  const markDirty = useCallback(() => {
    // Increment generation - used to detect if dirty should be cleared after save
    dirtyGenerationRef.current += 1;
    setStatus((prev) => ({ ...prev, dirty: true }));

    // Reset debounce timer
    cancelPendingDebounce();
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      queuedSave();
    }, SAVE_DEBOUNCE_MS);
  }, [cancelPendingDebounce, queuedSave]);

  // Cancel all pending saves - for Discard flow to prevent unwanted persistence
  // Cancels debounce timer, invalidates queued saves via generation increment, resets dirty flag
  const cancelPendingSaves = useCallback(() => {
    // Cancel any pending debounced save
    cancelPendingDebounce();

    // Increment session generation to invalidate any in-flight/queued saves
    // (performSave checks generation before and after IPC)
    sessionGenerationRef.current += 1;

    // Reset dirty flag - user explicitly chose to discard
    setStatus((prev) => ({
      ...prev,
      dirty: false,
      saving: false,
    }));
  }, [cancelPendingDebounce]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelPendingDebounce();
    };
  }, [cancelPendingDebounce]);

  // Note: Flush on session null removed - callers must await saveNow() before closing session
  // The previous implementation was broken (sessionRef became null before flush could run)

  return {
    status,
    saveNow,
    flushSave,
    markDirty,
    cancelPendingSaves,
  };
}
