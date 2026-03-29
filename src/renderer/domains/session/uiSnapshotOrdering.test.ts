// @vitest-environment jsdom
import React, { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionUiEvent, SessionUiSnapshot } from '../../../shared/ipc/sessionUi';
import type { InputDomain } from '../input/inputDomain';
import type { InputState } from '../../input/modes';
import type { AppBaseDeps } from '../../app/appDeps';
import type { SessionDomainActions } from './sessionDomain';
import { useSessionDomain } from './sessionDomain';

const baseInputState: InputState = {
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

const makeSession = (overrides: Partial<SessionUiSnapshot> = {}): SessionUiSnapshot => ({
  version: 1,
  sessionId: 'session-1',
  name: 'Session',
  createdAtIso: '2026-01-01T00:00:00.000Z',
  updatedAtIso: '2026-01-01T00:00:00.000Z',
  platform: { os: 'windows' },
  timebase: { origin: 'obs_recording_started', timeUnit: 'seconds' },
  recordings: [],
  media: { assets: [] },
  outline: { buckets: [] },
  taxonomy: { tags: [] },
  telemetry: { events: [] as never[] },
  markers: [],
  transcript: null,
  playbackState: { activeMediaId: null, mediaPositions: {} },
  ...overrides,
});

describe('ui snapshot ordering', () => {
  it('ignores stale uiRevision and applies newer snapshots', async () => {
    let latestUiRevision = -1;
    let latestSessionDir: string | null = null;
    let latestActions: SessionDomainActions | null = null;
    let callback: ((event: SessionUiEvent) => void) | null = null;
    let resolveGet: ((value: { ok: true; session: null; sessionDir: null; uiRevision: number }) => void) | null =
      null;
    const getPromise = new Promise<{ ok: true; session: null; sessionDir: null; uiRevision: number }>((resolve) => {
      resolveGet = resolve;
    });

    const deps: AppBaseDeps & { input: InputDomain } = {
      api: {
        session: {
          get: vi.fn().mockReturnValue(getPromise),
          subscribeUiSnapshot: vi.fn((cb) => {
            callback = cb;
            return 1;
          }),
          unsubscribeUiSnapshot: vi.fn(),
          cleanupInterruptedRecording: vi.fn(),
          save: vi.fn(),
          close: vi.fn(),
        },
      } as unknown as Window['api'],
      errors: { message: null, set: vi.fn(), clear: vi.fn() },
      feedback: { message: null, show: vi.fn(), clear: vi.fn() },
      input: {
        state: baseInputState,
        actions: { set: vi.fn(), resetToPlayerMode: vi.fn() },
      },
    };

    const container = document.createElement('div');
    const root: Root = createRoot(container);

    function Harness(): null {
      const session = useSessionDomain(deps);
      latestUiRevision = session.state.uiRevision;
      latestSessionDir = session.state.sessionDir;
      latestActions = session.actions;
      return null;
    }

    await act(async () => {
      root.render(React.createElement(Harness));
    });

    let cleanup: (() => void) | null = null;
    await act(async () => {
      cleanup = latestActions?.syncOnMount() ?? null;
    });

    await act(async () => {
      resolveGet?.({ ok: true, session: null, sessionDir: null, uiRevision: 0 });
      await getPromise;
      await Promise.resolve();
    });

    expect(callback).not.toBeNull();

    await act(async () => {
      callback?.({
        type: 'session_ui_snapshot',
        uiRevision: 2,
        session: makeSession({ sessionId: 'session-2' }),
        sessionDir: 'dir-2',
      });
    });

    expect(latestUiRevision).toBe(2);
    expect(latestSessionDir).toBe('dir-2');

    await act(async () => {
      callback?.({
        type: 'session_ui_snapshot',
        uiRevision: 1,
        session: makeSession({ sessionId: 'session-1' }),
        sessionDir: 'dir-1',
      });
    });

    expect(latestUiRevision).toBe(2);
    expect(latestSessionDir).toBe('dir-2');

    await act(async () => {
      callback?.({
        type: 'session_ui_snapshot',
        uiRevision: 3,
        session: makeSession({ sessionId: 'session-3' }),
        sessionDir: 'dir-3',
      });
    });

    expect(latestUiRevision).toBe(3);
    expect(latestSessionDir).toBe('dir-3');

    await act(async () => {
      cleanup?.();
    });
    await act(async () => {
      root.unmount();
    });
  });
});
