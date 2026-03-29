import type { InputState } from '../modes';
import type { Keymap } from '../keymaps/Keymap';
import { HOME_KEYMAPS } from '../keymaps/home';
import { SESSION_VIDEO_KEYMAPS } from '../keymaps/session.video';
import { SESSION_MODAL_KEYMAPS } from '../keymaps/session.modal';
import { PROCESSING_KEYMAPS } from '../keymaps/processing';

export function selectKeymapStack(state: InputState): readonly Keymap[] {
  if (state.modalKind !== 'none') {
    switch (state.modalKind) {
      case 'help':
        return [SESSION_MODAL_KEYMAPS.help];
      case 'newSession':
        return [
          state.newSessionFocus === 'input'
            ? SESSION_MODAL_KEYMAPS.newSessionInput
            : SESSION_MODAL_KEYMAPS.newSessionButtons,
        ];
      case 'closeConfirm':
        return [SESSION_MODAL_KEYMAPS.closeConfirm];
      case 'bucketDeleteConfirm':
      case 'tagDeleteConfirm':
      case 'markerDeleteConfirm':
      case 'clipDeleteConfirm':
        return [SESSION_MODAL_KEYMAPS.deleteConfirm];
      default: {
        const _exhaustive: never = state.modalKind;
        throw new Error(`Unhandled modal kind: ${_exhaustive}`);
      }
    }
  }

  switch (state.workspace) {
    case 'home': {
      switch (state.homeMode) {
        case 'search':
          return [HOME_KEYMAPS.search];
        case 'deleteConfirm':
          return [HOME_KEYMAPS.deleteConfirm];
        case 'list':
          return [HOME_KEYMAPS.list];
        default: {
          const _exhaustive: never = state.homeMode;
          throw new Error(`Unhandled home mode: ${_exhaustive}`);
        }
      }
    }
    case 'processing':
      return [PROCESSING_KEYMAPS.global];
    case 'session': {
      if (state.sessionViewport !== 'video') {
        throw new Error(`Unsupported session viewport: ${state.sessionViewport}`);
      }
      const sessionMaps = SESSION_VIDEO_KEYMAPS;
      const sessionMode = state.sessionMode;

      switch (sessionMode) {
        case 'buckets':
          return [sessionMaps.buckets, sessionMaps.global];
        case 'tags':
          return [sessionMaps.tags, sessionMaps.global];
        case 'markerList':
          return [sessionMaps.markerList, sessionMaps.global];
        case 'note':
          return [sessionMaps.note, sessionMaps.global];
        case 'drawing':
          return [sessionMaps.drawing, sessionMaps.global];
        case 'clips':
          return [sessionMaps.clips, sessionMaps.global];
        case 'player':
          return [sessionMaps.player, sessionMaps.global];
        default: {
          const _exhaustive: never = sessionMode;
          throw new Error(`Unhandled session mode: ${_exhaustive}`);
        }
      }
    }
    default: {
      const _exhaustive: never = state.workspace;
      throw new Error(`Unhandled workspace: ${_exhaustive}`);
    }
  }
}
