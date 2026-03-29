# SessionMap

Session capture and course annotation tool for Windows.

SessionMap enables users to record sessions (screen capture via OBS), annotate them with time-stamped markers organized into buckets and tags, and export clips for course creation workflows.

## Requirements

- **Windows only** (uses OBS Studio Node for screen capture)
- Node.js 20+
- npm

### OBS Studio Node Setup

SessionMap depends on [obs-studio-node](https://github.com/stream-labs/obs-studio-node) for screen recording. This native module is not published to npm, so you must provide a build manually:

1. Build obs-studio-node from the [Streamlabs fork](https://github.com/stream-labs/obs-studio-node) (Windows x64, release configuration).
2. Extract the build into `vendor/obs-studio-node/` (must contain a valid `package.json`).
3. Run `npm install` — npm resolves the `file:` dependency from the local directory.

## Quick Start

```bash
# Install dependencies (requires obs-studio-node in vendor/, see above)
npm install

# Run in development mode
npm run dev

# Type check
npm run check

# Run tests
npm test

# Build for production
npm run build

# Package for distribution
npm run package
```

## Architecture Overview

SessionMap is an Electron application with a clean separation between main process, renderer process, and shared contracts.

```
src/
  main/           # Electron main process (Node.js)
  renderer/       # React UI (browser context)
  shared/         # Type contracts shared between processes
  preload/        # Electron preload scripts (IPC bridge)
```

### Design Principles

The architecture follows these principles to achieve **minimal blast radius** per feature and **easy reasoning** about the codebase:

#### 1. Strict Domain Boundaries

The renderer is organized into **domains** (`src/renderer/domains/*`), each owning:

- A slice of state (`use*Domain` hook)
- Actions that mutate that state
- Commands for keyboard routing (registered by prefix)

Domains must not call other domains' hooks. Dependencies are explicit via the `deps` parameter. Cross-domain imports are type-only to keep the runtime graph acyclic.

#### 2. Single Source of Truth (SSoT)

Every piece of state has exactly one owner:

| Concern                                           | Owner                                      |
| ------------------------------------------------- | ------------------------------------------ |
| Persisted session data                            | Main process `SessionStore`                |
| UI snapshot (session mirror)                      | Renderer receives from main via IPC events |
| Playback state (time, rate, paused)               | Renderer `playbackDomain`                  |
| Input routing state (workspace, mode, highlights) | Renderer `inputDomain`                     |
| Keyboard bindings                                 | Keymaps (declarative data)                 |
| Keyboard behavior                                 | Commands (implementations)                 |

The renderer never mutates `SessionPackage` locally. All session mutations flow through IPC to main, which broadcasts updated `SessionUiSnapshot` events back to the renderer.

#### 3. Composition Over Configuration

`AppShell` is the **composition root** - the only module that instantiates domain hooks. It composes domains explicitly with no dependency injection framework or plugin registry:

```typescript
const markers = useMarkerDomain({ ...deps });
const buckets = useBucketDomain({ ...deps });
// ...
const commands = composeCommandRegistry([
  createMarkerCommands({ markers, ... }),
  createBucketCommands({ buckets, ... }),
  // ...
]);
```

#### 4. Keymaps + Commands (Two-Layer Routing)

Keyboard routing is split into two explicit layers:

- **Keymaps** (SSoT for bindings): Pure data mapping `KeyChord -> CommandInvocation` (currently `{ id: CommandId }`), selected by current mode
- **Commands** (SSoT for behavior): Each `CommandId` resolves to exactly one implementation

This separation means:

- Changing a key binding: edit one keymap file
- Changing behavior: edit one command file
- Adding a new command: add to spec, add handler, add binding

#### 5. Deterministic, Explicit Flows

- **No silent fallbacks**: Invalid data fails explicitly with typed error codes
- **Typed IPC contracts**: Request/response types enforced at boundaries
- **Monotonic ordering**: `uiRevision` guards prevent stale/out-of-order snapshot application
- **Exhaustive handling**: Workspace/mode switches are exhaustive (fail-closed on unknown values)

#### 6. Minimal Blast Radius

The architecture minimizes files touched per feature:

| Scenario              | Files Touched                          |
| --------------------- | -------------------------------------- |
| Add keyboard shortcut | 2 (keymap + domain commands)           |
| Add new marker action | 2-3 (domain actions + maybe keymap)    |
| Add new domain        | ~5 (domain module + commands + wiring) |

#### 7. No Mega-Files

Avoid multi-thousand-line orchestrators. Responsibility boundaries matter more than line counts, but keeping modules focused makes them easier to reason about and review.

## Project Structure

### Main Process (`src/main/`)

The main process handles:

- Window creation and management
- Session persistence (load/save/create sessions)
- OBS integration for screen recording
- Media file management
- IPC handlers for all session operations

Key modules:

- `app/` - Application bootstrap and window creation
- `session/` - SessionStore and domain-specific mutators
- `ipc/` - IPC handler registration (session, appFolder, media, obs, dialog)
- `obs/` - OBS Studio Node integration

### Renderer Process (`src/renderer/`)

The renderer is a React application organized into:

- `app/` - AppShell (composition root), error/feedback controllers, modal layer
- `domains/` - Domain hooks and commands (input, home, session, playback, recording, markers, buckets, tags, modals, export)
- `views/` - Workspace-level views (HomeView, SessionView, ProcessingView)
- `components/` - Presentational React components
- `input/` - Keyboard routing system (keymaps, commands, router)

### Shared Contracts (`src/shared/`)

Type definitions and contracts shared between main and renderer:

- `ipc/` - IPC channel names and request/response types
- `sessionPackage/` - SessionPackage schema, validation, types

## Session Package

A session is persisted as a folder containing:

- `session.json` - Session metadata, markers, buckets, tags, telemetry
- `recording/` - OBS recording files (session-relative paths)
- `transcript.json` - Optional transcript data

Media assets are referenced by absolute path (not copied into the session folder).

The `SessionPackage` schema (v1) includes:

- Recording segments with session time offsets
- Media assets (video files)
- Markers with timestamps, notes, drawings, importance levels
- Buckets (organizational containers for markers)
- Tags (cross-cutting labels)
- Playback telemetry events (main-only; renderer snapshots omit telemetry)

## Keyboard Shortcuts

Press `F1` in the app to see the full keyboard shortcuts help modal.

Key navigation concepts:

- **Workspaces**: Home, Session, Processing (future)
- **Session Modes**: Player, Buckets, Tags, MarkerList, Note, Drawing, Clips
- **Modals**: Help, Close Confirm, New Session, Delete Confirms

## Development

### Type Checking

```bash
npm run check
```

### Testing

```bash
npm test           # Run once
npm run test:watch # Watch mode
```

### Build

```bash
npm run build              # Build all
npm run build:renderer     # Vite build for renderer
npm run build:electron     # esbuild for main + preload
```

## License

The SessionMap source code in this repository is licensed under [MIT](LICENSE).

SessionMap depends on two GPL-licensed components at runtime:

- [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) (GPL-3.0-or-later) — installed via npm and bundled in the packaged app; invoked as a subprocess for media export
- [obs-studio-node](https://github.com/stream-labs/obs-studio-node) (GPL-2.0) — not included in this repository (`vendor/` is gitignored); must be built manually and loaded as a native addon for screen capture

Because the packaged application includes GPL-licensed binaries, distributing a combined binary carries the GPL obligations of those components. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for full attribution.
