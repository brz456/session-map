# Domains

Domains are bounded slices of application behavior. Each domain owns a slice of state, exposes actions (and optional queries), and registers command handlers for its prefix.

## Domain Pattern

Every domain follows this structure:

```typescript
// *Domain.ts
export interface FooDomainState { ... }
export interface FooDomainActions { ... }
export interface FooDomainQueries { ... }  // optional

export interface FooDomain {
  state: FooDomainState;
  actions: FooDomainActions;
  queries?: FooDomainQueries;
}

export function useFooDomain(deps: FooDeps): FooDomain { ... }

// commands.ts
export function createFooCommands(deps: FooCommandDeps): PartialCommandRegistry { ... }
```

## Domain Inventory

| Domain | Prefix | Responsibility |
|--------|--------|----------------|
| `input` | `input.*` | Keyboard routing state (workspace, modes, highlights, focus tracking) |
| `home` | `home.*` | Home session list, search/filter/sort, delete flow |
| `session` | `session.*` | Session lifecycle (create/open/close/rename), UI snapshot subscription |
| `playback` | `playback.*` | Media playback (play/pause, seek, rate, media selection) |
| `recording` | `recording.*` | OBS recording control, telemetry emission |
| `markers` | `markers.*` | Marker CRUD, selection, drawing, navigation |
| `buckets` | `buckets.*` | Bucket CRUD, reordering, assignment to markers |
| `tags` | `tags.*` | Tag CRUD, spatial navigation, assignment to markers |
| `modals` | `modals.*` | Modal open/close, payloads, focus management |
| `export` | `export.*` | Export operations (stills, clips) |

## Dependency Rules

1. **AppShell is the only composition root**: Only `AppShell.tsx` calls `use*Domain()` hooks.

2. **Explicit dependencies**: Domains receive dependencies via their `deps` parameter, never via context or globals.

3. **Type-only cross-imports**: Domains may `import type { ... }` from other domains but never runtime imports.

4. **No circular dependencies**: The dependency graph must be acyclic.

## State Ownership

Each piece of state has exactly one owner:

| State | Owner |
|-------|-------|
| `workspace`, `sessionMode`, `homeMode`, `modalKind` | `input` |
| `homeHighlightedSessionId`, `highlightedBucketId`, etc. | `input` |
| `session`, `sessionDir`, `uiRevision`, `sessionStatus` | `session` |
| `isPaused`, `mediaTimeSec`, `playbackRate`, `activeMediaIndex` | `playback` |
| `isRecording`, `sessionTimeSec` | `recording` |
| `selectedMarkerIds`, `drawingColor`, `drawingToolIndex` | `markers` |
| `modalPayload` | `modals` |
| `visibleSessions`, `searchQuery`, `sortKey` | `home` |
| `isExporting` | `export` |

## Command Ownership

Commands are registered by prefix. Each domain's `createFooCommands()` returns handlers only for its prefix:

```typescript
// markers/commands.ts
export function createMarkerCommands(deps): PartialCommandRegistry {
  return {
    'markers.dropMarker': () => { ... },
    'markers.navigateNext': () => { ... },
    // Only markers.* commands
  };
}
```

The command registry is composed in `AppShell` via `composeCommandRegistry()`.

## Domain Files

Each domain folder contains:

```
domains/foo/
  fooDomain.ts       # Hook: useFooDomain(deps) -> { state, actions, queries? }
  commands.ts        # Factory: createFooCommands(deps) -> PartialCommandRegistry
  *.ts               # Optional: selectors, utilities, spatial navigation, etc.
```

### Markers Domain (Extended)

The markers domain has additional modules:
- `selectors.ts` - Derived data (sorted markers, grouped markers)
- `selection.ts` - Click selection logic (single, extend, toggle)
- `markerPresentation.ts` - Registry for marker kind rendering

### Tags Domain (Extended)

- `spatialNavigation.ts` - 2D spatial navigation for tag chip layout
