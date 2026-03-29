import type { Keymap } from './Keymap';

export const SESSION_MODAL_KEYMAPS: {
  help: Keymap;
  newSessionInput: Keymap;
  newSessionButtons: Keymap;
  closeConfirm: Keymap;
  deleteConfirm: Keymap;
} = {
  help: {
    id: 'session.modal.help',
    unhandled: { default: 'preventDefault' },
    bindings: {
      Escape: { id: 'modals.close' },
      Enter: { id: 'modals.close' },
      F1: { id: 'modals.close' },
    },
  },

  newSessionInput: {
    id: 'session.modal.newSession.input',
    bindings: {
      Escape: { id: 'modals.close' },
      ArrowDown: { id: 'modals.newSessionFocusDown' },
      ArrowUp: { id: 'input.noop' }, // parity: prevented even while typing
      Enter: { id: 'modals.newSessionSubmit' },
    },
  },

  newSessionButtons: {
    id: 'session.modal.newSession.buttons',
    bindings: {
      Escape: { id: 'modals.close' },
      ArrowUp: { id: 'modals.newSessionFocusUp' },
      ArrowLeft: { id: 'modals.newSessionToggleButton' },
      ArrowRight: { id: 'modals.newSessionToggleButton' },
      ArrowDown: { id: 'input.noop' }, // parity: prevented (no-op) on buttons
      Enter: { id: 'modals.newSessionSubmit' },
    },
  },

  closeConfirm: {
    id: 'session.modal.closeConfirm',
    unhandled: { default: 'preventDefault' },
    bindings: {
      ArrowLeft: { id: 'modals.closeConfirmCycleLeft' },
      ArrowRight: { id: 'modals.closeConfirmCycleRight' },
      Enter: { id: 'modals.closeConfirmActivate' },
      Space: { id: 'modals.closeConfirmActivate' },
      Escape: { id: 'modals.close' },
    },
  },

  deleteConfirm: {
    id: 'session.modal.deleteConfirm',
    unhandled: { default: 'preventDefault' },
    bindings: {
      ArrowLeft: { id: 'modals.deleteConfirmToggleChoice' },
      ArrowRight: { id: 'modals.deleteConfirmToggleChoice' },
      Enter: { id: 'modals.deleteConfirmActivate' },
      Space: { id: 'modals.deleteConfirmActivate' },
      Escape: { id: 'modals.close' },
    },
  },
};
