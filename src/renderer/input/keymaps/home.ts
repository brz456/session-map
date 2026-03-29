import type { Keymap } from './Keymap';

export const HOME_KEYMAPS: {
  list: Keymap;
  search: Keymap;
  deleteConfirm: Keymap;
} = {
  list: {
    id: 'home.list',
    bindings: {
      'Ctrl+F': { id: 'home.enterSearch' },
      'Ctrl+Shift+F': { id: 'home.enterSearch' }, // shift-insensitive parity (legacy uses lowerKey)
      'Ctrl+N': { id: 'home.createNewSession' },
      'Ctrl+Shift+N': { id: 'home.createNewSession' },

      ArrowLeft: { id: 'home.focusRowOpen' },
      ArrowRight: { id: 'home.focusRowDelete' },
      ArrowUp: { id: 'home.listMoveUp' },
      ArrowDown: { id: 'home.listMoveDown' },
      Enter: { id: 'home.listActivate' },
      Delete: { id: 'home.listRequestDelete' },
      Escape: { id: 'home.listEscape' },
    },
  },

  search: {
    id: 'home.search',
    bindings: {
      'Ctrl+F': { id: 'home.enterSearch' },
      'Ctrl+Shift+F': { id: 'home.enterSearch' },
      'Ctrl+N': { id: 'home.createNewSession' },
      'Ctrl+Shift+N': { id: 'home.createNewSession' },

      ArrowUp: { id: 'input.noop' }, // parity: Up is a no-op but is prevented in legacy search mode
      ArrowDown: { id: 'home.searchMoveDownToList' },
      Enter: { id: 'home.searchEnterToList' },
      Escape: { id: 'home.searchEscape' },
    },
  },

  deleteConfirm: {
    id: 'home.deleteConfirm',
    unhandled: { default: 'preventDefault' },
    bindings: {
      ArrowLeft: { id: 'home.deleteConfirmToggleChoice' },
      ArrowRight: { id: 'home.deleteConfirmToggleChoice' },
      Enter: { id: 'home.deleteConfirmActivate' },
      Space: { id: 'home.deleteConfirmActivate' },
      Escape: { id: 'home.deleteConfirmCancel' },
    },
  },
};
