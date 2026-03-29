import type { CommandInvocation } from '../commands/spec';
import type { KeyChord } from '../keys/chords';

export type UnhandledKeyPolicy = 'ignore' | 'preventDefault';

/**
 * Some modes intentionally block keys that are not explicitly handled (e.g., confirm modals, drawing mode).
 * This must be expressible in the keymap data so behavior remains SSoT.
 */
export interface KeymapUnhandledPolicy {
  /** Applied when no binding matches. */
  default: UnhandledKeyPolicy;
  /** Optional override for Ctrl/Meta combos (used by current marker list mode). */
  ctrlOrMeta?: UnhandledKeyPolicy;
}

export interface Keymap {
  id: string; // stable identifier for debugging
  bindings: Record<KeyChord, CommandInvocation>;
  unhandled?: KeymapUnhandledPolicy;
}
