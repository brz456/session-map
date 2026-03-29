import type { Keymap } from './Keymap';

export const SESSION_VIDEO_KEYMAPS: {
  global: Keymap;
  player: Keymap;
  buckets: Keymap;
  tags: Keymap;
  markerList: Keymap;
  note: Keymap;
  drawing: Keymap;
  clips: Keymap;
} = {
  global: {
    id: 'session.video.global',
    bindings: {
      F1: { id: 'modals.openHelp' },
      F12: { id: 'recording.toggle' },

      'Ctrl+D': { id: 'markers.deselectAllAndExitToPlayerMode' },
      'Ctrl+Shift+D': { id: 'markers.deselectAllAndExitToPlayerMode' },
      'Ctrl+I': { id: 'session.importMedia' },
      'Ctrl+Shift+I': { id: 'session.importMedia' },

      'Ctrl+1': { id: 'playback.selectMedia1' },
      'Ctrl+2': { id: 'playback.selectMedia2' },
      'Ctrl+3': { id: 'playback.selectMedia3' },
      'Ctrl+4': { id: 'playback.selectMedia4' },
      'Ctrl+5': { id: 'playback.selectMedia5' },
      'Ctrl+6': { id: 'playback.selectMedia6' },
      'Ctrl+7': { id: 'playback.selectMedia7' },
      'Ctrl+8': { id: 'playback.selectMedia8' },
      'Ctrl+9': { id: 'playback.selectMedia9' },
      'Ctrl+0': { id: 'playback.selectMedia10' },
    },
  },

  player: {
    id: 'session.video.player',
    bindings: {
      Escape: { id: 'markers.deselectAll' },

      // Mode entry (shift-insensitive parity)
      B: { id: 'buckets.enterMode' },
      'Shift+B': { id: 'buckets.enterMode' },
      T: { id: 'tags.enterMode' },
      'Shift+T': { id: 'tags.enterMode' },
      R: { id: 'markers.enterMarkerListMode' },
      'Shift+R': { id: 'markers.enterMarkerListMode' },
      I: { id: 'playback.enterClipsMode' },
      'Shift+I': { id: 'playback.enterClipsMode' },
      N: { id: 'markers.enterNoteMode' },
      'Shift+N': { id: 'markers.enterNoteMode' },
      D: { id: 'markers.enterDrawingMode' },
      'Shift+D': { id: 'markers.enterDrawingMode' },

      // Block Ctrl+Z/Y when not typing (legacy behavior)
      'Ctrl+Z': { id: 'input.blockUnlessTyping' },
      'Ctrl+Shift+Z': { id: 'input.blockUnlessTyping' },
      'Ctrl+Y': { id: 'input.blockUnlessTyping' },
      'Ctrl+Shift+Y': { id: 'input.blockUnlessTyping' },

      // Marker navigation (Ctrl+Arrow or Ctrl+J/L)
      'Ctrl+ArrowLeft': { id: 'markers.navigatePrev' },
      'Ctrl+ArrowRight': { id: 'markers.navigateNext' },
      'Ctrl+J': { id: 'markers.navigatePrev' },
      'Ctrl+L': { id: 'markers.navigateNext' },
      'Ctrl+Shift+ArrowLeft': { id: 'markers.navigatePrevExtend' },
      'Ctrl+Shift+ArrowRight': { id: 'markers.navigateNextExtend' },
      'Ctrl+Shift+J': { id: 'markers.navigatePrevExtend' },
      'Ctrl+Shift+L': { id: 'markers.navigateNextExtend' },

      // Frame stepping (Alt+Arrow or Alt+J/L)
      'Alt+ArrowLeft': { id: 'playback.stepFrameBack' },
      'Alt+ArrowRight': { id: 'playback.stepFrameForward' },
      'Alt+J': { id: 'playback.stepFrameBack' },
      'Alt+Shift+J': { id: 'playback.stepFrameBack' },
      'Alt+L': { id: 'playback.stepFrameForward' },
      'Alt+Shift+L': { id: 'playback.stepFrameForward' },

      // Player controls
      Space: { id: 'playback.togglePlayPause' },
      K: { id: 'playback.togglePlayPause' },
      'Shift+K': { id: 'playback.togglePlayPause' },

      M: { id: 'markers.dropMarker' },
      'Shift+M': { id: 'markers.dropMarker' },

      'Shift+Comma': { id: 'playback.rateDown' }, // physical key (`e.code`) parity
      'Shift+Period': { id: 'playback.rateUp' }, // physical key (`e.code`) parity

      ArrowLeft: { id: 'playback.seekBackCoarse' },
      'Shift+ArrowLeft': { id: 'playback.seekBackFine' },
      ArrowRight: { id: 'playback.seekForwardCoarse' },
      'Shift+ArrowRight': { id: 'playback.seekForwardFine' },
      J: { id: 'playback.seekBackCoarse' },
      'Shift+J': { id: 'playback.seekBackFine' },
      L: { id: 'playback.seekForwardCoarse' },
      'Shift+L': { id: 'playback.seekForwardFine' },

      '1': { id: 'markers.setImportance1' },
      '2': { id: 'markers.setImportance2' },
      '3': { id: 'markers.setImportance3' },
      Delete: { id: 'markers.requestDeleteSelected' },
      Backspace: { id: 'session.goHome' },
      G: { id: 'markers.groupSelected' },
      'Shift+G': { id: 'markers.groupSelected' },
      U: { id: 'markers.ungroupSelected' },
      'Shift+U': { id: 'markers.ungroupSelected' },
    },
  },

  buckets: {
    id: 'session.video.buckets',
    bindings: {
      Escape: { id: 'input.exitToPlayerMode' },
      ArrowUp: { id: 'buckets.highlightPrev' },
      ArrowDown: { id: 'buckets.highlightNext' },
      'Alt+1': { id: 'buckets.quickSelect1' },
      'Alt+2': { id: 'buckets.quickSelect2' },
      'Alt+3': { id: 'buckets.quickSelect3' },
      'Alt+4': { id: 'buckets.quickSelect4' },
      'Alt+5': { id: 'buckets.quickSelect5' },
      'Alt+6': { id: 'buckets.quickSelect6' },
      'Alt+7': { id: 'buckets.quickSelect7' },
      'Alt+8': { id: 'buckets.quickSelect8' },
      'Alt+9': { id: 'buckets.quickSelect9' },
      'Alt+0': { id: 'buckets.quickSelect10' },
      Enter: { id: 'buckets.activate' },
      Delete: { id: 'buckets.requestDeleteHighlighted' },
    },
  },

  tags: {
    id: 'session.video.tags',
    bindings: {
      Escape: { id: 'input.exitToPlayerMode' },
      ArrowLeft: { id: 'tags.highlightPrev' },
      ArrowRight: { id: 'tags.highlightNext' },
      ArrowUp: { id: 'tags.highlightUp' },
      ArrowDown: { id: 'tags.highlightDown' },
      Enter: { id: 'tags.activate' },
      Delete: { id: 'tags.requestDeleteHighlighted' },
    },
  },

  markerList: {
    id: 'session.video.markerList',
    unhandled: { default: 'ignore', ctrlOrMeta: 'preventDefault' },
    bindings: {
      Escape: { id: 'input.exitToPlayerMode' },
      R: { id: 'input.exitToPlayerMode' },
      'Shift+R': { id: 'input.exitToPlayerMode' },

      ArrowUp: { id: 'markers.markerListHighlightPrev' },
      ArrowDown: { id: 'markers.markerListHighlightNext' },
      'Shift+ArrowUp': { id: 'markers.markerListHighlightPrevExtend' },
      'Shift+ArrowDown': { id: 'markers.markerListHighlightNextExtend' },

      Enter: { id: 'markers.markerListEnter' },
      'Ctrl+Enter': { id: 'markers.markerListEnterCtrl' },
      'Shift+Enter': { id: 'markers.markerListEnterShift' },
      'Ctrl+Shift+Enter': { id: 'markers.markerListEnterCtrl' }, // parity: Ctrl wins over Shift

      Delete: { id: 'markers.requestDeleteHighlighted' },
      G: { id: 'markers.groupSelected' },
      'Shift+G': { id: 'markers.groupSelected' },
      U: { id: 'markers.ungroupSelected' },
      'Shift+U': { id: 'markers.ungroupSelected' },
    },
  },

  note: {
    id: 'session.video.note',
    bindings: {
      Enter: { id: 'input.exitToPlayerMode' }, // Shift+Enter intentionally unbound (newline)
      Escape: { id: 'input.exitToPlayerMode' },
    },
  },

  drawing: {
    id: 'session.video.drawing',
    unhandled: { default: 'preventDefault' },
    bindings: {
      Escape: { id: 'input.exitToPlayerMode' },
      D: { id: 'input.exitToPlayerMode' },
      'Shift+D': { id: 'input.exitToPlayerMode' },

      'Ctrl+Z': { id: 'markers.drawingUndo' },
      'Ctrl+Shift+Z': { id: 'markers.drawingUndo' },
      'Ctrl+Y': { id: 'markers.drawingRedo' },
      'Ctrl+Shift+Y': { id: 'markers.drawingRedo' },

      ArrowLeft: { id: 'markers.drawingToolPrev' },
      ArrowRight: { id: 'markers.drawingToolNext' },
      Enter: { id: 'markers.drawingActivateTool' },
      ArrowUp: { id: 'markers.drawingColorPrev' },
      ArrowDown: { id: 'markers.drawingColorNext' },
    },
  },

  clips: {
    id: 'session.video.clips',
    unhandled: { default: 'preventDefault' },
    bindings: {
      Escape: { id: 'input.exitToPlayerMode' },
      I: { id: 'input.exitToPlayerMode' },
      'Shift+I': { id: 'input.exitToPlayerMode' },

      ArrowUp: { id: 'playback.clipsMoveUp' },
      ArrowDown: { id: 'playback.clipsMoveDown' },
      Enter: { id: 'playback.clipsActivate' },
      Delete: { id: 'playback.clipsDeleteHighlighted' },
    },
  },
};
