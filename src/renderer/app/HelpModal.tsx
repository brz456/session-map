import type { CommandId } from '../input/commands/spec';
import type { Keymap } from '../input/keymaps/Keymap';
import { SESSION_VIDEO_KEYMAPS } from '../input/keymaps/session.video';
import { SESSION_MODAL_KEYMAPS } from '../input/keymaps/session.modal';

type HelpEntryConfig = {
  label: string;
  commands: readonly CommandId[];
  keymaps: readonly Keymap[];
};

type HelpSectionConfig = {
  title: string;
  entries: readonly HelpEntryConfig[];
};

type HelpSection = {
  title: string;
  entries: Array<{ label: string; chords: string[] }>;
};

function collectChordsForCommand(commandId: CommandId, keymaps: readonly Keymap[]): string[] {
  const chords: string[] = [];
  for (const keymap of keymaps) {
    for (const [chord, invocation] of Object.entries(keymap.bindings)) {
      if (invocation.id !== commandId) continue;
      chords.push(chord);
    }
  }
  return chords;
}

function formatChordDisplay(chord: string): string {
  if (!chord) {
    throw new Error(`Invalid chord string: "${chord}"`);
  }
  const parts = chord.split('+');
  if (parts.length === 0) {
    throw new Error(`Invalid chord string: "${chord}"`);
  }
  const base = parts.pop();
  if (!base) {
    throw new Error(`Invalid chord string: "${chord}"`);
  }
  let modifiers = parts;
  let displayBase = base;

  const baseOverride: Record<string, string> = {
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    Escape: 'Esc',
    Space: 'Space',
    Comma: ',',
    Period: '.',
  };

  if (base === 'Comma' && modifiers.includes('Shift')) {
    displayBase = '<';
    modifiers = modifiers.filter((mod) => mod !== 'Shift');
  } else if (base === 'Period' && modifiers.includes('Shift')) {
    displayBase = '>';
    modifiers = modifiers.filter((mod) => mod !== 'Shift');
  } else if (baseOverride[base]) {
    displayBase = baseOverride[base];
  }

  if (displayBase.length === 1 && /[A-Z]/.test(displayBase)) {
    modifiers = modifiers.filter((mod) => mod !== 'Shift');
  }

  if (modifiers.length === 0) {
    return displayBase;
  }

  return `${modifiers.join('+')}+${displayBase}`;
}

function buildHelpSections(config: readonly HelpSectionConfig[]): HelpSection[] {
  return config.map((section) => {
    const entries = section.entries.map((entry) => {
      const displaySet = new Set<string>();
      const missing: CommandId[] = [];

      for (const commandId of entry.commands) {
        const chords = collectChordsForCommand(commandId, entry.keymaps);
        if (chords.length === 0) {
          missing.push(commandId);
          continue;
        }
        for (const chord of chords) {
          displaySet.add(formatChordDisplay(chord));
        }
      }

      if (missing.length > 0) {
        const keymapIds = entry.keymaps.map((keymap) => keymap.id).join(', ');
        throw new Error(
          `Help entry "${entry.label}" missing bindings for ${missing.join(', ')} (keymaps: ${keymapIds})`
        );
      }

      const chords = Array.from(displaySet);
      if (chords.length === 0) {
        throw new Error(`Help entry missing key bindings: ${entry.label}`);
      }

      return { label: entry.label, chords };
    });

    return { title: section.title, entries };
  });
}

const HELP_SECTIONS_LEFT: HelpSectionConfig[] = [
  {
    title: 'General',
    entries: [
      { label: 'Show this help', commands: ['modals.openHelp'], keymaps: [SESSION_VIDEO_KEYMAPS.global] },
      { label: 'Start / Stop recording', commands: ['recording.toggle'], keymaps: [SESSION_VIDEO_KEYMAPS.global] },
      { label: 'Import media', commands: ['session.importMedia'], keymaps: [SESSION_VIDEO_KEYMAPS.global] },
      {
        label: 'Select clip 1-10',
        commands: [
          'playback.selectMedia1',
          'playback.selectMedia2',
          'playback.selectMedia3',
          'playback.selectMedia4',
          'playback.selectMedia5',
          'playback.selectMedia6',
          'playback.selectMedia7',
          'playback.selectMedia8',
          'playback.selectMedia9',
          'playback.selectMedia10',
        ],
        keymaps: [SESSION_VIDEO_KEYMAPS.global],
      },
      { label: 'Back to home (player)', commands: ['session.goHome'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      {
        label: 'Exit mode / Close modal',
        commands: ['input.exitToPlayerMode', 'modals.close'],
        keymaps: [SESSION_VIDEO_KEYMAPS.buckets, SESSION_MODAL_KEYMAPS.closeConfirm],
      },
    ],
  },
  {
    title: 'Playback',
    entries: [
      { label: 'Play / Pause', commands: ['playback.togglePlayPause'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Seek -5s', commands: ['playback.seekBackCoarse'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Seek +5s', commands: ['playback.seekForwardCoarse'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Seek -1s', commands: ['playback.seekBackFine'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Seek +1s', commands: ['playback.seekForwardFine'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Frame back', commands: ['playback.stepFrameBack'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Frame forward', commands: ['playback.stepFrameForward'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Speed -/+ 0.25x', commands: ['playback.rateDown', 'playback.rateUp'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
    ],
  },
  {
    title: 'Markers',
    entries: [
      { label: 'Drop marker', commands: ['markers.dropMarker'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      {
        label: 'Set importance',
        commands: ['markers.setImportance1', 'markers.setImportance2', 'markers.setImportance3'],
        keymaps: [SESSION_VIDEO_KEYMAPS.player],
      },
      { label: 'Edit note', commands: ['markers.enterNoteMode'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Group selected', commands: ['markers.groupSelected'], keymaps: [SESSION_VIDEO_KEYMAPS.player, SESSION_VIDEO_KEYMAPS.markerList] },
      { label: 'Ungroup selected', commands: ['markers.ungroupSelected'], keymaps: [SESSION_VIDEO_KEYMAPS.player, SESSION_VIDEO_KEYMAPS.markerList] },
      {
        label: 'Delete marker',
        commands: ['markers.requestDeleteSelected', 'markers.requestDeleteHighlighted'],
        keymaps: [SESSION_VIDEO_KEYMAPS.player, SESSION_VIDEO_KEYMAPS.markerList],
      },
      { label: 'Deselect all', commands: ['markers.deselectAllAndExitToPlayerMode'], keymaps: [SESSION_VIDEO_KEYMAPS.global] },
      { label: 'Prev / Next marker', commands: ['markers.navigatePrev', 'markers.navigateNext'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Extend selection', commands: ['markers.navigatePrevExtend', 'markers.navigateNextExtend'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
    ],
  },
];

const HELP_SECTIONS_RIGHT: HelpSectionConfig[] = [
  {
    title: 'Modes',
    entries: [
      { label: 'Buckets mode', commands: ['buckets.enterMode'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Tags mode', commands: ['tags.enterMode'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Marker list mode', commands: ['markers.enterMarkerListMode'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Clips mode', commands: ['playback.enterClipsMode'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
      { label: 'Drawing mode', commands: ['markers.enterDrawingMode'], keymaps: [SESSION_VIDEO_KEYMAPS.player] },
    ],
  },
  {
    title: 'Drawing Mode',
    entries: [
      { label: 'Cycle tools', commands: ['markers.drawingToolPrev', 'markers.drawingToolNext'], keymaps: [SESSION_VIDEO_KEYMAPS.drawing] },
      { label: 'Cycle colors', commands: ['markers.drawingColorPrev', 'markers.drawingColorNext'], keymaps: [SESSION_VIDEO_KEYMAPS.drawing] },
      { label: 'Activate tool', commands: ['markers.drawingActivateTool'], keymaps: [SESSION_VIDEO_KEYMAPS.drawing] },
      { label: 'Undo / Redo', commands: ['markers.drawingUndo', 'markers.drawingRedo'], keymaps: [SESSION_VIDEO_KEYMAPS.drawing] },
    ],
  },
  {
    title: 'Buckets / Tags Mode',
    entries: [
      {
        label: 'Navigate items',
        commands: ['buckets.highlightPrev', 'buckets.highlightNext', 'tags.highlightPrev', 'tags.highlightNext', 'tags.highlightUp', 'tags.highlightDown'],
        keymaps: [SESSION_VIDEO_KEYMAPS.buckets, SESSION_VIDEO_KEYMAPS.tags],
      },
      { label: 'Create or assign', commands: ['buckets.activate', 'tags.activate'], keymaps: [SESSION_VIDEO_KEYMAPS.buckets, SESSION_VIDEO_KEYMAPS.tags] },
      { label: 'Delete item', commands: ['buckets.requestDeleteHighlighted', 'tags.requestDeleteHighlighted'], keymaps: [SESSION_VIDEO_KEYMAPS.buckets, SESSION_VIDEO_KEYMAPS.tags] },
      {
        label: 'Quick-select bucket',
        commands: [
          'buckets.quickSelect1',
          'buckets.quickSelect2',
          'buckets.quickSelect3',
          'buckets.quickSelect4',
          'buckets.quickSelect5',
          'buckets.quickSelect6',
          'buckets.quickSelect7',
          'buckets.quickSelect8',
          'buckets.quickSelect9',
          'buckets.quickSelect10',
        ],
        keymaps: [SESSION_VIDEO_KEYMAPS.buckets],
      },
    ],
  },
  {
    title: 'Marker List Mode',
    entries: [
      {
        label: 'Navigate markers',
        commands: ['markers.markerListHighlightPrev', 'markers.markerListHighlightNext', 'markers.markerListHighlightPrevExtend', 'markers.markerListHighlightNextExtend'],
        keymaps: [SESSION_VIDEO_KEYMAPS.markerList],
      },
      {
        label: 'Select and seek',
        commands: ['markers.markerListEnter'],
        keymaps: [SESSION_VIDEO_KEYMAPS.markerList],
      },
      {
        label: 'Add to selection',
        commands: ['markers.markerListEnterCtrl', 'markers.markerListEnterShift'],
        keymaps: [SESSION_VIDEO_KEYMAPS.markerList],
      },
      {
        label: 'Delete marker',
        commands: ['markers.requestDeleteHighlighted'],
        keymaps: [SESSION_VIDEO_KEYMAPS.markerList],
      },
    ],
  },
  {
    title: 'Clips Mode',
    entries: [
      { label: 'Navigate clips / Import', commands: ['playback.clipsMoveUp', 'playback.clipsMoveDown'], keymaps: [SESSION_VIDEO_KEYMAPS.clips] },
      { label: 'Select clip / Import', commands: ['playback.clipsActivate'], keymaps: [SESSION_VIDEO_KEYMAPS.clips] },
      { label: 'Delete clip', commands: ['playback.clipsDeleteHighlighted'], keymaps: [SESSION_VIDEO_KEYMAPS.clips] },
    ],
  },
];

const HELP_SECTIONS_LEFT_RENDER = buildHelpSections(HELP_SECTIONS_LEFT);
const HELP_SECTIONS_RIGHT_RENDER = buildHelpSections(HELP_SECTIONS_RIGHT);

export function HelpModal(props: { onClose(): void }): JSX.Element {
  return (
    <div className="app__modal-overlay" onClick={props.onClose}>
      <div className="app__modal app__modal--help" onClick={(e) => e.stopPropagation()}>
        <h3 className="app__modal-title">Keyboard Shortcuts</h3>

        <div className="app__help-columns">
          <div className="app__help-column">
            {HELP_SECTIONS_LEFT_RENDER.map((section) => (
              <div key={section.title}>
                <h4 className="app__help-section">{section.title}</h4>
                <table className="app__help-table">
                  <tbody>
                    {section.entries.map((entry) => (
                      <tr key={entry.label}>
                        <td>
                          <div className="app__help-chords">
                            {entry.chords.map((chord) => (
                              <kbd key={`${entry.label}-${chord}`}>{chord}</kbd>
                            ))}
                          </div>
                        </td>
                        <td>{entry.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="app__help-column">
            {HELP_SECTIONS_RIGHT_RENDER.map((section) => (
              <div key={section.title}>
                <h4 className="app__help-section">{section.title}</h4>
                <table className="app__help-table">
                  <tbody>
                    {section.entries.map((entry) => (
                      <tr key={entry.label}>
                        <td>
                          <div className="app__help-chords">
                            {entry.chords.map((chord) => (
                              <kbd key={`${entry.label}-${chord}`}>{chord}</kbd>
                            ))}
                          </div>
                        </td>
                        <td>{entry.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>

        <div className="app__modal-actions">
          <button
            type="button"
            className="app__btn app__btn--primary"
            onClick={props.onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
