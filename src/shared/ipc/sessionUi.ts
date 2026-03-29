import type { SessionPackage } from "../sessionPackage/types";

// UI view model: same shape, but telemetry events are intentionally omitted from updates
export type SessionUiSnapshot = Omit<SessionPackage, "telemetry"> & {
  /**
   * Type-level guard: `never[]` makes accidental reads of telemetry events a compile-time error in the renderer.
   * Runtime value is always `[]` (main strips events in `toSessionUiSnapshot`).
   */
  telemetry: { events: readonly never[] };
};

export type SessionUiEvent = {
  type: "session_ui_snapshot";
  /**
   * Monotonic ordering guard.
   * Initial value at main-process boot is `0` (no session; `get()` returns `uiRevision: 0`).
   * Increments on every successful commit that broadcasts (create/load/close + every UI-relevant mutation), so the first broadcast uses `uiRevision: 1`.
   * Renderer must ignore any event where `uiRevision <= lastAppliedUiRevision` to prevent stale snapshot clobber.
   */
  uiRevision: number;
  /** null means "no active session" (e.g., after close). */
  session: SessionUiSnapshot | null;
  /** Convenience for renderer domains; mirrors main's active session dir. */
  sessionDir: string | null;
};
