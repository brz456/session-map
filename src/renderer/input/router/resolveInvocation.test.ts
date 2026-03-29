import { describe, it, expect } from 'vitest';
import type { InputState } from '../modes';
import { resolveCommandInvocation } from './resolveInvocation';

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

const resolveId = (state: InputState, chord: string): string | null =>
  resolveCommandInvocation(state, chord)?.id ?? null;

describe('resolveCommandInvocation', () => {
  it('maps home list bindings', () => {
    const state = withState({ workspace: 'home', homeMode: 'list' });
    expect(resolveId(state, 'Ctrl+F')).toBe('home.enterSearch');
    expect(resolveId(state, 'Ctrl+N')).toBe('home.createNewSession');
    expect(resolveId(state, 'ArrowUp')).toBe('home.listMoveUp');
    expect(resolveId(state, 'ArrowDown')).toBe('home.listMoveDown');
    expect(resolveId(state, 'Enter')).toBe('home.listActivate');
    expect(resolveId(state, 'Delete')).toBe('home.listRequestDelete');
    expect(resolveId(state, 'Escape')).toBe('home.listEscape');
  });

  it('maps home search bindings', () => {
    const state = withState({ workspace: 'home', homeMode: 'search' });
    expect(resolveId(state, 'ArrowUp')).toBe('input.noop');
    expect(resolveId(state, 'ArrowDown')).toBe('home.searchMoveDownToList');
    expect(resolveId(state, 'Enter')).toBe('home.searchEnterToList');
    expect(resolveId(state, 'Escape')).toBe('home.searchEscape');
  });

  it('maps home delete-confirm bindings', () => {
    const state = withState({ workspace: 'home', homeMode: 'deleteConfirm' });
    expect(resolveId(state, 'ArrowLeft')).toBe('home.deleteConfirmToggleChoice');
    expect(resolveId(state, 'ArrowRight')).toBe('home.deleteConfirmToggleChoice');
    expect(resolveId(state, 'Enter')).toBe('home.deleteConfirmActivate');
    expect(resolveId(state, 'Space')).toBe('home.deleteConfirmActivate');
    expect(resolveId(state, 'Escape')).toBe('home.deleteConfirmCancel');
  });

  it('maps session global bindings', () => {
    const state = withState({ workspace: 'session', sessionMode: 'player' });
    expect(resolveId(state, 'F1')).toBe('modals.openHelp');
    expect(resolveId(state, 'F12')).toBe('recording.toggle');
    expect(resolveId(state, 'Ctrl+D')).toBe('markers.deselectAllAndExitToPlayerMode');
    expect(resolveId(state, 'Ctrl+I')).toBe('session.importMedia');
    const mediaCases: Array<[string, string]> = [
      ['Ctrl+1', 'playback.selectMedia1'],
      ['Ctrl+2', 'playback.selectMedia2'],
      ['Ctrl+3', 'playback.selectMedia3'],
      ['Ctrl+4', 'playback.selectMedia4'],
      ['Ctrl+5', 'playback.selectMedia5'],
      ['Ctrl+6', 'playback.selectMedia6'],
      ['Ctrl+7', 'playback.selectMedia7'],
      ['Ctrl+8', 'playback.selectMedia8'],
      ['Ctrl+9', 'playback.selectMedia9'],
      ['Ctrl+0', 'playback.selectMedia10'],
    ];
    for (const [chord, id] of mediaCases) {
      expect(resolveId(state, chord)).toBe(id);
    }
  });

  it('maps session player bindings', () => {
    const state = withState({ workspace: 'session', sessionMode: 'player' });
    expect(resolveId(state, 'Space')).toBe('playback.togglePlayPause');
    expect(resolveId(state, 'K')).toBe('playback.togglePlayPause');
    expect(resolveId(state, 'M')).toBe('markers.dropMarker');
    expect(resolveId(state, 'Backspace')).toBe('session.goHome');
    expect(resolveId(state, 'Delete')).toBe('markers.requestDeleteSelected');
    expect(resolveId(state, 'G')).toBe('markers.groupSelected');
    expect(resolveId(state, 'U')).toBe('markers.ungroupSelected');
    expect(resolveId(state, 'ArrowLeft')).toBe('playback.seekBackCoarse');
    expect(resolveId(state, 'Shift+ArrowLeft')).toBe('playback.seekBackFine');
    expect(resolveId(state, 'ArrowRight')).toBe('playback.seekForwardCoarse');
    expect(resolveId(state, 'Shift+ArrowRight')).toBe('playback.seekForwardFine');
    expect(resolveId(state, 'Alt+ArrowLeft')).toBe('playback.stepFrameBack');
    expect(resolveId(state, 'Alt+ArrowRight')).toBe('playback.stepFrameForward');
    expect(resolveId(state, 'Alt+J')).toBe('playback.stepFrameBack');
    expect(resolveId(state, 'Alt+L')).toBe('playback.stepFrameForward');
    expect(resolveId(state, 'Ctrl+ArrowLeft')).toBe('markers.navigatePrev');
    expect(resolveId(state, 'Ctrl+ArrowRight')).toBe('markers.navigateNext');
    expect(resolveId(state, 'Ctrl+J')).toBe('markers.navigatePrev');
    expect(resolveId(state, 'Ctrl+L')).toBe('markers.navigateNext');
    expect(resolveId(state, 'Shift+Comma')).toBe('playback.rateDown');
    expect(resolveId(state, 'Shift+Period')).toBe('playback.rateUp');
  });

  it('maps session buckets bindings', () => {
    const state = withState({ workspace: 'session', sessionMode: 'buckets' });
    expect(resolveId(state, 'Escape')).toBe('input.exitToPlayerMode');
    expect(resolveId(state, 'ArrowUp')).toBe('buckets.highlightPrev');
    expect(resolveId(state, 'ArrowDown')).toBe('buckets.highlightNext');
    expect(resolveId(state, 'Alt+1')).toBe('buckets.quickSelect1');
    expect(resolveId(state, 'Alt+0')).toBe('buckets.quickSelect10');
    expect(resolveId(state, 'Enter')).toBe('buckets.activate');
    expect(resolveId(state, 'Delete')).toBe('buckets.requestDeleteHighlighted');
  });

  it('maps session tags bindings', () => {
    const state = withState({ workspace: 'session', sessionMode: 'tags' });
    expect(resolveId(state, 'Escape')).toBe('input.exitToPlayerMode');
    expect(resolveId(state, 'ArrowLeft')).toBe('tags.highlightPrev');
    expect(resolveId(state, 'ArrowRight')).toBe('tags.highlightNext');
    expect(resolveId(state, 'ArrowUp')).toBe('tags.highlightUp');
    expect(resolveId(state, 'ArrowDown')).toBe('tags.highlightDown');
    expect(resolveId(state, 'Enter')).toBe('tags.activate');
    expect(resolveId(state, 'Delete')).toBe('tags.requestDeleteHighlighted');
  });

  it('maps session markerList bindings', () => {
    const state = withState({ workspace: 'session', sessionMode: 'markerList' });
    expect(resolveId(state, 'Escape')).toBe('input.exitToPlayerMode');
    expect(resolveId(state, 'R')).toBe('input.exitToPlayerMode');
    expect(resolveId(state, 'Enter')).toBe('markers.markerListEnter');
    expect(resolveId(state, 'Ctrl+Enter')).toBe('markers.markerListEnterCtrl');
    expect(resolveId(state, 'Shift+Enter')).toBe('markers.markerListEnterShift');
    expect(resolveId(state, 'Delete')).toBe('markers.requestDeleteHighlighted');
    expect(resolveId(state, 'G')).toBe('markers.groupSelected');
    expect(resolveId(state, 'U')).toBe('markers.ungroupSelected');
  });

  it('maps session note bindings', () => {
    const state = withState({ workspace: 'session', sessionMode: 'note' });
    expect(resolveId(state, 'Enter')).toBe('input.exitToPlayerMode');
    expect(resolveId(state, 'Escape')).toBe('input.exitToPlayerMode');
  });

  it('maps session drawing bindings', () => {
    const state = withState({ workspace: 'session', sessionMode: 'drawing' });
    expect(resolveId(state, 'Escape')).toBe('input.exitToPlayerMode');
    expect(resolveId(state, 'D')).toBe('input.exitToPlayerMode');
    expect(resolveId(state, 'Ctrl+Z')).toBe('markers.drawingUndo');
    expect(resolveId(state, 'Ctrl+Y')).toBe('markers.drawingRedo');
    expect(resolveId(state, 'ArrowLeft')).toBe('markers.drawingToolPrev');
    expect(resolveId(state, 'ArrowRight')).toBe('markers.drawingToolNext');
    expect(resolveId(state, 'ArrowUp')).toBe('markers.drawingColorPrev');
    expect(resolveId(state, 'ArrowDown')).toBe('markers.drawingColorNext');
    expect(resolveId(state, 'Enter')).toBe('markers.drawingActivateTool');
  });

  it('maps session clips bindings', () => {
    const state = withState({ workspace: 'session', sessionMode: 'clips' });
    expect(resolveId(state, 'Escape')).toBe('input.exitToPlayerMode');
    expect(resolveId(state, 'I')).toBe('input.exitToPlayerMode');
    expect(resolveId(state, 'ArrowUp')).toBe('playback.clipsMoveUp');
    expect(resolveId(state, 'ArrowDown')).toBe('playback.clipsMoveDown');
    expect(resolveId(state, 'Enter')).toBe('playback.clipsActivate');
    expect(resolveId(state, 'Delete')).toBe('playback.clipsDeleteHighlighted');
  });

  it('maps session modal help bindings', () => {
    const state = withState({ workspace: 'session', modalKind: 'help' });
    expect(resolveId(state, 'Escape')).toBe('modals.close');
    expect(resolveId(state, 'Enter')).toBe('modals.close');
    expect(resolveId(state, 'F1')).toBe('modals.close');
  });

  it('maps session modal newSession bindings', () => {
    const inputState = withState({
      workspace: 'session',
      modalKind: 'newSession',
      newSessionFocus: 'input',
    });
    expect(resolveId(inputState, 'ArrowDown')).toBe('modals.newSessionFocusDown');
    expect(resolveId(inputState, 'ArrowUp')).toBe('input.noop');
    expect(resolveId(inputState, 'Enter')).toBe('modals.newSessionSubmit');

    const buttonState = withState({
      workspace: 'session',
      modalKind: 'newSession',
      newSessionFocus: 'create',
    });
    expect(resolveId(buttonState, 'ArrowUp')).toBe('modals.newSessionFocusUp');
    expect(resolveId(buttonState, 'ArrowLeft')).toBe('modals.newSessionToggleButton');
    expect(resolveId(buttonState, 'ArrowRight')).toBe('modals.newSessionToggleButton');
    expect(resolveId(buttonState, 'ArrowDown')).toBe('input.noop');
    expect(resolveId(buttonState, 'Enter')).toBe('modals.newSessionSubmit');
  });

  it('maps session modal closeConfirm bindings', () => {
    const state = withState({ workspace: 'session', modalKind: 'closeConfirm' });
    expect(resolveId(state, 'ArrowLeft')).toBe('modals.closeConfirmCycleLeft');
    expect(resolveId(state, 'ArrowRight')).toBe('modals.closeConfirmCycleRight');
    expect(resolveId(state, 'Enter')).toBe('modals.closeConfirmActivate');
    expect(resolveId(state, 'Space')).toBe('modals.closeConfirmActivate');
    expect(resolveId(state, 'Escape')).toBe('modals.close');
  });

  it('maps session modal deleteConfirm bindings', () => {
    const state = withState({ workspace: 'session', modalKind: 'markerDeleteConfirm' });
    expect(resolveId(state, 'ArrowLeft')).toBe('modals.deleteConfirmToggleChoice');
    expect(resolveId(state, 'ArrowRight')).toBe('modals.deleteConfirmToggleChoice');
    expect(resolveId(state, 'Enter')).toBe('modals.deleteConfirmActivate');
    expect(resolveId(state, 'Space')).toBe('modals.deleteConfirmActivate');
    expect(resolveId(state, 'Escape')).toBe('modals.close');
  });
});
