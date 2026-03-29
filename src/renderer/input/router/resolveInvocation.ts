import type { InputState } from '../modes';
import type { KeyChord } from '../keys/chords';
import type { CommandInvocation } from '../commands/spec';
import { selectKeymapStack } from './selectKeymap';

export function resolveCommandInvocation(
  state: InputState,
  chord: KeyChord
): CommandInvocation | null {
  const keymaps = selectKeymapStack(state);
  for (const keymap of keymaps) {
    const invocation = keymap.bindings[chord];
    if (invocation) {
      return invocation;
    }
  }
  return null;
}
