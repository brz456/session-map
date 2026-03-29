import type { CommandId, CommandInvocation } from './spec';

export type CommandHandler = (args: unknown) => void | Promise<void>;

export type PartialCommandRegistry = Partial<Record<CommandId, CommandHandler>>;
export type CommandRegistry = PartialCommandRegistry;

export function composeCommandRegistry(
  parts: readonly PartialCommandRegistry[]
): CommandRegistry {
  const registry: CommandRegistry = {};
  for (const part of parts) {
    for (const [id, handler] of Object.entries(part) as Array<[CommandId, CommandHandler]>) {
      if (handler === undefined) {
        continue;
      }
      if (registry[id]) {
        throw new Error(`Duplicate command registration: ${id}`);
      }
      registry[id] = handler;
    }
  }
  return registry;
}

/**
 * Dispatch must be safe for async handlers:
 * - never allow an unhandled promise rejection
 * - surface failures to the app error boundary
 */
export async function dispatchCommand(opts: {
  registry: CommandRegistry;
  invocation: CommandInvocation;
  reportError(message: string): void;
}): Promise<void> {
  const { registry, invocation, reportError } = opts;

  if (invocation.args !== undefined) {
    reportError(`Command args are not allowed in Phase 3: ${invocation.id}`);
    return;
  }

  const handler = registry[invocation.id];
  if (!handler) {
    reportError(`No command handler registered for ${invocation.id}`);
    return;
  }

  try {
    await Promise.resolve(handler(invocation.args)).catch((err) => {
      reportError(
        `Command failed (${invocation.id}): ${err instanceof Error ? err.message : String(err)}`
      );
    });
  } catch (err) {
    reportError(
      `Command failed (${invocation.id}): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
