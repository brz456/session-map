// src/renderer/utils/format.ts
// Shared formatting utilities for renderer components

/**
 * UI-only formatter: formats seconds as MM:SS.
 * Contract: `seconds` must be finite and >= 0 (validated where mediaTimeSec is computed).
 * Throws on invalid input to surface upstream bugs during development.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`formatTime: invalid input (${seconds}). Caller must validate.`);
  }
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get CSS variable for marker importance color.
 * Returns a CSS var() reference (CSS is SSoT for colors).
 */
export function getImportanceColor(importance: 1 | 2 | 3): string {
  switch (importance) {
    case 3: return 'var(--color-importance-high)';
    case 2: return 'var(--color-importance-medium)';
    case 1: return 'var(--color-importance-low)';
    default: {
      const _exhaustive: never = importance;
      return _exhaustive;
    }
  }
}
