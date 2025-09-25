# Display Layout Controller Hooks

- `useDisplayLayoutController` wraps the V2 controller state machine and buffer logic, exposing `displayedLayouts`, shared refs, and logging helpers to display-only components.
- `useGuardedCommitQueue` encapsulates the guarded commit pipeline (version tracking, queue flushing, highlight state) so Studio code paths remain synchronous.
- `useDisplayLayoutState` is a thin wrapper over `useUnifiedLayoutState` to keep display-specific state wiring in one module.

These hooks are intentionally isolated from Studio bundles—`StudioLayoutEngine` should never import from this directory.
