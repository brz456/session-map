# Renderer Process

The renderer is a React application that provides the SessionMap UI. It communicates with the main process exclusively through typed IPC calls exposed via the preload script (`window.api`).

## Architecture

```
renderer/
  app/              # Application shell and infrastructure
  domains/          # Domain hooks (state + actions + commands)
  views/            # Workspace-level view composition
  components/       # Presentational React components
  input/            # Keyboard routing system
  drawing/          # Canvas drawing utilities
  export/           # Export coordination
  session/          # Session clock and persistence hooks
  telemetry/        # Telemetry event building
  styles/           # Theme and CSS
  utils/            # Shared utilities
```

## Key Concepts

### AppShell (Composition Root)

`app/AppShell.tsx` is the only module that instantiates domain hooks. It:
- Composes all domains with their dependencies
- Builds the command registry from domain command factories
- Validates keymaps against commands at boot (fail-fast)
- Installs the keyboard event listener
- Renders the workspace switcher (`AppView`)

### Domains

Each domain (`domains/*`) owns a slice of application state and exposes:
- `use*Domain(deps)` - Hook returning `{ state, actions, queries? }`
- `create*Commands(deps)` - Factory returning command implementations

Domains:
- `input` - Keyboard routing state (workspace, modes, highlights)
- `home` - Home list, search, sorting
- `session` - Session lifecycle, UI snapshot subscription
- `playback` - Media playback state, seeking, rate control
- `recording` - OBS recording control, telemetry
- `markers` - Marker selection, CRUD, drawing
- `buckets` - Bucket management
- `tags` - Tag management
- `modals` - Modal state and payloads
- `export` - Export operations

### Views

Views (`views/*`) are workspace-level compositions:
- `HomeView` - Session list, search, create/delete
- `SessionView` - Video player, course pane, recording controls
- `ProcessingView` - Future workspace (stub)

Views wire domains into presentational components but contain no IPC calls.

### Input System

The keyboard routing system (`input/`) provides:
- **Keymaps** - Declarative `KeyChord -> CommandId` bindings per mode
- **Commands** - Centralized behavior registry (`CommandId -> handler`)
- **Router** - Deterministic keydown handling with text-input guards

See `input/README.md` for details.

### Components

Presentational components (`components/`) are pure UI:
- `player/` - VideoPlayer, DrawingOverlay, icons
- `course/` - CoursePane, BucketPane, TagPane, MarkerList, MarkerInspector
- `session/` - ClipPanel

Components emit intents via callbacks; they never call `window.api` directly.

## Data Flow

1. **Session State**: Main process owns all session data. Renderer subscribes to `SessionUiEvent` broadcasts and applies snapshots via `uiRevision` ordering.

2. **User Actions**: User interactions trigger domain actions, which call `window.api.*` IPC methods. On success, main broadcasts an updated `SessionUiSnapshot`.

3. **Keyboard Input**: `routeKeyDown` selects the active keymap based on `InputState`, resolves the command, and dispatches it. Commands call domain actions.

## Entry Point

`main.tsx` renders `<AppShell />` inside the theme provider:

```tsx
<ThemeProvider>
  <AppShell />
</ThemeProvider>
```

## Development Notes

- All IPC is typed via `window.api` (see `app/rendererApi.ts`)
- Domains must not call other domains' hooks; dependencies are explicit
- Cross-domain imports are type-only to keep the runtime graph acyclic
- No local `SessionPackage` mutations; SSoT is main process
