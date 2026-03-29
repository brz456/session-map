import type { CommandRegistry } from './registry';
import type { Keymap } from '../keymaps/Keymap';
import type { CommandSpec, CommandInvocation } from './spec';

export function validateKeymapsAgainstCommands(opts: {
  keymaps: readonly Keymap[];
  specs: Record<string, CommandSpec>;
  commands: CommandRegistry;
}): void {
  const { keymaps, specs, commands } = opts;

  for (const keymap of keymaps) {
    for (const [chord, invocation] of Object.entries(keymap.bindings) as Array<
      [string, CommandInvocation]
    >) {
      if (!specs[invocation.id]) {
        throw new Error(`Unknown command id in keymap ${keymap.id}: ${invocation.id} (${chord})`);
      }
      if (!commands[invocation.id]) {
        throw new Error(`Missing command handler for ${invocation.id} (keymap ${keymap.id})`);
      }
      if (invocation.args !== undefined) {
        throw new Error(`Command args are forbidden in Phase 3: ${invocation.id}`);
      }
    }
  }
}
