# Input System

The input system provides deterministic keyboard routing via explicit keymaps and a centralized command registry.

## Architecture

```
input/
  modes.ts           # Type definitions for workspaces, modes, modals
  keys/
    chords.ts        # KeyChord conversion (toKeyChord)
  commands/
    spec.ts          # COMMAND_SPECS: SSoT for all command IDs and metadata
    registry.ts      # Command registry composition and dispatch
    validate.ts      # Boot-time keymap/command validation
  keymaps/
    Keymap.ts        # Keymap type definition
    home.ts          # Home workspace keymaps
    session.video.ts # Session workspace (video viewport) keymaps
    session.modal.ts # Session modal keymaps
    processing.ts    # Processing workspace keymaps (stub)
  router/
    selectKeymap.ts  # Select active keymap from InputState
    resolveInvocation.ts # Resolve KeyChord -> CommandInvocation
    routeKeyDown.ts  # Main keydown handler
    clickCapture.ts  # Click-outside-to-exit-mode logic
```

## Key Concepts

### KeyChord

A string representing a key combination, produced by `toKeyChord(e: KeyboardEvent)`:
- Format: `"[Ctrl+][Meta+][Alt+][Shift+]<Key>"`
- Examples: `"Ctrl+S"`, `"Shift+ArrowDown"`, `"Escape"`, `"1"`, `"Space"`, `"Shift+Comma"`

Conversion rules (`toKeyChord`):
- Single-character keys are uppercased (`a` → `A`)
- Space becomes `"Space"`, comma/period become `"Comma"`/`"Period"`
- Modifiers ordered: Ctrl, Meta, Alt, Shift
- Both `ctrlKey` and `metaKey` are represented (Ctrl+, Meta+)
- Tab is handled specially (always returns `"Tab"`)

### Keymaps

A keymap defines bindings from `KeyChord` to `CommandInvocation`:

```typescript
interface Keymap {
  id: string;                                      // e.g., "session.video.player"
  bindings: Record<KeyChord, CommandInvocation>;   // e.g., { "Space": { id: "playback.togglePlayPause" } }
  unhandled?: KeymapUnhandledPolicy;
}

interface KeymapUnhandledPolicy {
  default: 'ignore' | 'preventDefault';
  ctrlOrMeta?: 'ignore' | 'preventDefault';  // Optional override for Ctrl/Meta combos
}
```

**UnhandledKeyPolicy**:
- `ignore` - Keys without bindings are not prevented (default browser behavior)
- `preventDefault` - Unbound keys are blocked
- `ctrlOrMeta` - Optional override policy for Ctrl/Meta key combos

Keymaps are organized by workspace and mode:
- `HOME_KEYMAPS` - `list`, `search`, `deleteConfirm`
- `SESSION_VIDEO_KEYMAPS` - `player`, `buckets`, `tags`, `markerList`, `note`, `drawing`, `clips`
- `SESSION_MODAL_KEYMAPS` - `help`, `newSession`, `closeConfirm`, `bucketDeleteConfirm`, etc.
- `PROCESSING_KEYMAPS` - Future workspace (stub)

### Commands

Commands are the SSoT for keyboard behavior:

```typescript
// spec.ts - Command metadata
export const COMMAND_SPECS = {
  'playback.togglePlayPause': { allowInTextInput: false },
  'markers.dropMarker': { allowInTextInput: false },
  // ...
} as const satisfies Record<CommandId, CommandSpec>;

// registry.ts - Command implementations
type CommandHandler = (args: unknown) => void | Promise<void>;
type PartialCommandRegistry = Partial<Record<CommandId, CommandHandler>>;
```

**allowInTextInput**: If `false`, the command is ignored when a text input is focused (typing doesn't trigger global shortcuts).

**Phase 3 invariant**: Command args are forbidden. `dispatchCommand()` rejects any invocation with `args !== undefined`.

### Router

The router (`routeKeyDown.ts`) handles keydown events:

1. **Tab blocking**: Tab is always blocked up-front (`preventDefault`)
2. **Convert chord**: `toKeyChord(e)` converts `KeyboardEvent` to `KeyChord`
3. **Select keymap stack**: `selectKeymapStack(state)` returns ordered keymaps for current mode
4. **Resolve command**: Search keymaps in order for matching binding
5. **Apply unhandled policy**: If no match, apply `ignore` or `preventDefault` based on keymap policy (with `ctrlOrMeta` override)
6. **Text input guard**: If command found but `allowInTextInput === false` and focus is in text input, bail
7. **Dispatch**: `preventDefault` and execute the command handler

```typescript
routeKeyDown(
  e: KeyboardEvent,
  state: InputState,
  commands: CommandRegistry,
  reportError: (message: string) => void
): void
```

## Boot-Time Validation

`validateKeymapsAgainstCommands()` runs at app startup:
- Every `CommandId` in keymaps must exist in `COMMAND_SPECS`
- Every `CommandId` in keymaps must have a registered handler
- Command args are forbidden (Phase 3 invariant)

Validation failures throw immediately (fail-fast).

## Adding a New Command

1. Add the command ID and spec to `commands/spec.ts`:
   ```typescript
   'foo.doThing': { allowInTextInput: false },
   ```

2. Add the handler in the owning domain's `commands.ts`:
   ```typescript
   'foo.doThing': () => deps.foo.actions.doThing(),
   ```

3. Add the key binding to the appropriate keymap:
   ```typescript
   bindings: {
     'Ctrl+T': { id: 'foo.doThing' },
   }
   ```

## Adding a New Keymap

1. Create the keymap object in the appropriate file (or create a new file)
2. Add it to `ALL_KEYMAPS` in `AppShell.tsx` for boot validation
3. Update `selectKeymap.ts` to return it for the relevant `InputState`

## Mode Types

```typescript
type WorkspaceId = 'home' | 'session' | 'processing';
type SessionViewportKind = 'video' | 'browser' | 'whiteboard';
type HomeMode = 'list' | 'search' | 'deleteConfirm';
type SessionMode = 'player' | 'buckets' | 'tags' | 'markerList' | 'note' | 'drawing' | 'clips';
type ModalKind = 'none' | 'help' | 'closeConfirm' | 'newSession' | ...;
```

The `InputState` tracks the current values of all these, plus highlight/focus state for keyboard navigation.
