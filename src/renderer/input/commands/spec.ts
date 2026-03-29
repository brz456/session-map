export interface CommandSpec {
  /**
   * If true, the command may trigger while a text input is focused.
   * If false, keydown is ignored (do not preventDefault) so typing never triggers global shortcuts.
   */
  allowInTextInput: boolean;
}

export const COMMAND_SPECS = {
  // Home (list/search/deleteConfirm)
  'home.enterSearch': { allowInTextInput: true },
  'home.createNewSession': { allowInTextInput: true },
  'home.focusRowOpen': { allowInTextInput: false },
  'home.focusRowDelete': { allowInTextInput: false },
  'home.listMoveUp': { allowInTextInput: false },
  'home.listMoveDown': { allowInTextInput: false },
  'home.listActivate': { allowInTextInput: false },
  'home.listRequestDelete': { allowInTextInput: false },
  'home.listEscape': { allowInTextInput: false },
  'home.searchMoveDownToList': { allowInTextInput: true },
  'home.searchEnterToList': { allowInTextInput: true },
  'home.searchEscape': { allowInTextInput: true },
  'home.deleteConfirmToggleChoice': { allowInTextInput: false },
  'home.deleteConfirmActivate': { allowInTextInput: false },
  'home.deleteConfirmCancel': { allowInTextInput: false },
  'home.deleteConfirmConfirm': { allowInTextInput: false },

  // Input (generic)
  'input.exitToPlayerMode': { allowInTextInput: true },
  'input.noop': { allowInTextInput: true }, // used to block specific keys deterministically
  'input.blockUnlessTyping': { allowInTextInput: false }, // used to block Ctrl+Z/Y only when not typing

  // Modals (session workspace)
  'modals.openHelp': { allowInTextInput: true },
  'modals.close': { allowInTextInput: true },
  'modals.newSessionFocusDown': { allowInTextInput: true },
  'modals.newSessionFocusUp': { allowInTextInput: true },
  'modals.newSessionToggleButton': { allowInTextInput: true },
  'modals.newSessionSubmit': { allowInTextInput: true },
  'modals.newSessionCreate': { allowInTextInput: true },
  'modals.newSessionCancel': { allowInTextInput: true },
  'modals.closeConfirmCycleLeft': { allowInTextInput: false },
  'modals.closeConfirmCycleRight': { allowInTextInput: false },
  'modals.closeConfirmActivate': { allowInTextInput: false },
  'modals.closeConfirmSave': { allowInTextInput: false },
  'modals.closeConfirmDiscard': { allowInTextInput: false },
  'modals.closeConfirmCancel': { allowInTextInput: false },
  'modals.deleteConfirmToggleChoice': { allowInTextInput: false },
  'modals.deleteConfirmActivate': { allowInTextInput: false },
  'modals.deleteConfirmConfirm': { allowInTextInput: false },
  'modals.deleteConfirmCancel': { allowInTextInput: false },

  // Session / recording
  'session.importMedia': { allowInTextInput: true },
  'session.goHome': { allowInTextInput: false }, // Backspace parity: ignored while typing
  'recording.toggle': { allowInTextInput: true },

  // Playback (video viewport)
  'playback.selectMedia1': { allowInTextInput: true },
  'playback.selectMedia2': { allowInTextInput: true },
  'playback.selectMedia3': { allowInTextInput: true },
  'playback.selectMedia4': { allowInTextInput: true },
  'playback.selectMedia5': { allowInTextInput: true },
  'playback.selectMedia6': { allowInTextInput: true },
  'playback.selectMedia7': { allowInTextInput: true },
  'playback.selectMedia8': { allowInTextInput: true },
  'playback.selectMedia9': { allowInTextInput: true },
  'playback.selectMedia10': { allowInTextInput: true }, // Ctrl+0 maps to index 9 parity
  'playback.enterClipsMode': { allowInTextInput: false },
  'playback.togglePlayPause': { allowInTextInput: false },
  'playback.seekBackCoarse': { allowInTextInput: false },
  'playback.seekBackFine': { allowInTextInput: false },
  'playback.seekForwardCoarse': { allowInTextInput: false },
  'playback.seekForwardFine': { allowInTextInput: false },
  'playback.stepFrameBack': { allowInTextInput: false },
  'playback.stepFrameForward': { allowInTextInput: false },
  'playback.rateDown': { allowInTextInput: false },
  'playback.rateUp': { allowInTextInput: false },
  'playback.clipsMoveUp': { allowInTextInput: false },
  'playback.clipsMoveDown': { allowInTextInput: false },
  'playback.clipsActivate': { allowInTextInput: false },
  'playback.clipsDeleteHighlighted': { allowInTextInput: false },

  // Markers (selection, marker list mode, drawing)
  'markers.deselectAll': { allowInTextInput: false },
  'markers.deselectAllAndExitToPlayerMode': { allowInTextInput: true },
  'markers.enterMarkerListMode': { allowInTextInput: false },
  'markers.enterNoteMode': { allowInTextInput: false },
  'markers.enterDrawingMode': { allowInTextInput: false },
  'markers.dropMarker': { allowInTextInput: false },
  'markers.requestDeleteSelected': { allowInTextInput: false },
  'markers.requestDeleteHighlighted': { allowInTextInput: false },
  'markers.setImportance1': { allowInTextInput: false },
  'markers.setImportance2': { allowInTextInput: false },
  'markers.setImportance3': { allowInTextInput: false },
  'markers.groupSelected': { allowInTextInput: false },
  'markers.ungroupSelected': { allowInTextInput: false },
  'markers.navigatePrev': { allowInTextInput: false },
  'markers.navigateNext': { allowInTextInput: false },
  'markers.navigatePrevExtend': { allowInTextInput: false },
  'markers.navigateNextExtend': { allowInTextInput: false },
  'markers.markerListHighlightPrev': { allowInTextInput: false },
  'markers.markerListHighlightNext': { allowInTextInput: false },
  'markers.markerListHighlightPrevExtend': { allowInTextInput: false },
  'markers.markerListHighlightNextExtend': { allowInTextInput: false },
  'markers.markerListEnter': { allowInTextInput: false },
  'markers.markerListEnterCtrl': { allowInTextInput: false },
  'markers.markerListEnterShift': { allowInTextInput: false },
  'markers.drawingUndo': { allowInTextInput: false },
  'markers.drawingRedo': { allowInTextInput: false },
  'markers.drawingToolPrev': { allowInTextInput: false },
  'markers.drawingToolNext': { allowInTextInput: false },
  'markers.drawingActivateTool': { allowInTextInput: false },
  'markers.drawingColorPrev': { allowInTextInput: false },
  'markers.drawingColorNext': { allowInTextInput: false },

  // Buckets
  'buckets.enterMode': { allowInTextInput: false },
  'buckets.highlightPrev': { allowInTextInput: true },
  'buckets.highlightNext': { allowInTextInput: true },
  'buckets.quickSelect1': { allowInTextInput: true },
  'buckets.quickSelect2': { allowInTextInput: true },
  'buckets.quickSelect3': { allowInTextInput: true },
  'buckets.quickSelect4': { allowInTextInput: true },
  'buckets.quickSelect5': { allowInTextInput: true },
  'buckets.quickSelect6': { allowInTextInput: true },
  'buckets.quickSelect7': { allowInTextInput: true },
  'buckets.quickSelect8': { allowInTextInput: true },
  'buckets.quickSelect9': { allowInTextInput: true },
  'buckets.quickSelect10': { allowInTextInput: true }, // Alt+0 maps to index 9 parity
  'buckets.activate': { allowInTextInput: true },
  'buckets.requestDeleteHighlighted': { allowInTextInput: true },

  // Tags
  'tags.enterMode': { allowInTextInput: false },
  'tags.highlightPrev': { allowInTextInput: true },
  'tags.highlightNext': { allowInTextInput: true },
  'tags.highlightUp': { allowInTextInput: true },
  'tags.highlightDown': { allowInTextInput: true },
  'tags.activate': { allowInTextInput: true },
  'tags.requestDeleteHighlighted': { allowInTextInput: true },

  // Export
  'export.startAll': { allowInTextInput: false },
} as const satisfies Record<string, CommandSpec>;

export type CommandId = keyof typeof COMMAND_SPECS;

export type CommandInvocation = { id: CommandId; args?: unknown };
