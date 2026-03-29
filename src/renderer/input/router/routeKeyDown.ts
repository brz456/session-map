import type { InputState } from '../modes';
import type { CommandRegistry } from '../commands/registry';
import { COMMAND_SPECS } from '../commands/spec';
import { dispatchCommand } from '../commands/registry';
import { toKeyChord } from '../keys/chords';
import { selectKeymapStack } from './selectKeymap';
import { isTextInputLike } from '../../utils/dom';

export function routeKeyDown(
  e: KeyboardEvent,
  state: InputState,
  commands: CommandRegistry,
  reportError: (message: string) => void
): void {
  if (e.key === 'Tab') {
    e.preventDefault();
    return;
  }

  const chord = toKeyChord(e);
  if (!chord) {
    return;
  }

  const keymaps = selectKeymapStack(state);
  let invocation = null as null | { id: keyof typeof COMMAND_SPECS; args?: unknown };
  for (const keymap of keymaps) {
    const match = keymap.bindings[chord];
    if (match) {
      invocation = match;
      break;
    }
  }

  if (!invocation) {
    let policy: 'ignore' | 'preventDefault' = 'ignore';
    const hasCtrlOrMeta = chord.includes('Ctrl') || chord.includes('Meta');
    for (const keymap of keymaps) {
      if (!keymap.unhandled) {
        continue;
      }
      if (hasCtrlOrMeta && keymap.unhandled.ctrlOrMeta) {
        policy = keymap.unhandled.ctrlOrMeta;
      } else {
        policy = keymap.unhandled.default;
      }
      break;
    }
    if (policy === 'preventDefault') {
      e.preventDefault();
    }
    return;
  }

  const spec = COMMAND_SPECS[invocation.id];
  if (!spec) {
    reportError(`Unknown command spec for ${invocation.id}`);
    return;
  }

  if (isTextInputLike(document.activeElement) && spec.allowInTextInput === false) {
    return;
  }

  e.preventDefault();
  void dispatchCommand({
    registry: commands,
    invocation,
    reportError,
  });
}
