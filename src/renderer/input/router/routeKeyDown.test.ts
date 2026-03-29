// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { InputState } from '../modes';
import type { CommandRegistry } from '../commands/registry';
import { routeKeyDown } from './routeKeyDown';

const baseState: InputState = {
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

const withState = (overrides: Partial<InputState>): InputState => ({
  ...baseState,
  ...overrides,
});

const makeEvent = (init: KeyboardEventInit): { event: KeyboardEvent; prevented: () => boolean } => {
  const event = new KeyboardEvent('keydown', init);
  let didPrevent = false;
  (event as unknown as { preventDefault(): void }).preventDefault = () => {
    didPrevent = true;
  };
  return { event, prevented: () => didPrevent };
};

describe('routeKeyDown unhandled policy', () => {
  const commands: CommandRegistry = {};
  const reportError = vi.fn();

  it('prevents default for markerList unbound ctrl/meta chords', () => {
    const state = withState({ workspace: 'session', sessionMode: 'markerList' });
    const { event, prevented } = makeEvent({ key: 'z', ctrlKey: true });
    routeKeyDown(event, state, commands, reportError);
    expect(prevented()).toBe(true);
  });

  it('prevents default for drawing unbound keys', () => {
    const state = withState({ workspace: 'session', sessionMode: 'drawing' });
    const { event, prevented } = makeEvent({ key: 'A' });
    routeKeyDown(event, state, commands, reportError);
    expect(prevented()).toBe(true);
  });

  it('prevents default for clips unbound keys', () => {
    const state = withState({ workspace: 'session', sessionMode: 'clips' });
    const { event, prevented } = makeEvent({ key: 'A' });
    routeKeyDown(event, state, commands, reportError);
    expect(prevented()).toBe(true);
  });

  it('prevents default for deleteConfirm unbound keys', () => {
    const state = withState({ workspace: 'session', modalKind: 'markerDeleteConfirm' });
    const { event, prevented } = makeEvent({ key: 'A' });
    routeKeyDown(event, state, commands, reportError);
    expect(prevented()).toBe(true);
  });

  it('does not prevent default for player unbound keys', () => {
    const state = withState({ workspace: 'session', sessionMode: 'player' });
    const { event, prevented } = makeEvent({ key: 'A' });
    routeKeyDown(event, state, commands, reportError);
    expect(prevented()).toBe(false);
  });

  it('does not prevent default for home list unbound keys', () => {
    const state = withState({ workspace: 'home', homeMode: 'list' });
    const { event, prevented } = makeEvent({ key: 'A' });
    routeKeyDown(event, state, commands, reportError);
    expect(prevented()).toBe(false);
  });
});
