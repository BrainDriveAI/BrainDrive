# BrainDrive Tauri desktop shell

<!-- catalog-contract:start tauri-desktop-boundary -->
> **Document contract**
> - Purpose: Define the source-adjacent Tauri shell, embedded runtime, platform, data, and verification boundary.
> - Audience: Recurring contributors, Maintainers, AI coding agents.
> - Status: Current on `dev`; Milestone 2.
> - Owner role: runtime-maintainers.
> - Expected outcome: A contributor locates the Rust shell, web bridge, embedded services, platform configuration, and focused checks.
> - Prerequisites: Rust and Tauri platform toolchain; Node.js and workspace dependencies; Root AGENTS.md.
> - Parent: [docs/developers/README.md](../../../docs/developers/README.md).
> - Adjacent topics: [Tauri desktop development](../../../docs/developers/setup/tauri-desktop.md); [Architecture overview](../../../docs/developers/architecture/README.md); [Change verification](../../../docs/developers/verification.md); [BrainDrive web client](../client_web/README.md).
> - Keywords: `Tauri desktop`, `Rust shell`, `embedded runtime`, `desktop transport`.
> - Sources: [`builds/typescript/src-tauri/src/main.rs`](./src/main.rs); [`builds/typescript/src-tauri/src/process_containment.rs`](./src/process_containment.rs); [`builds/typescript/src-tauri/src/native_export.rs`](./src/native_export.rs); [`builds/typescript/src-tauri/tauri.conf.json`](./tauri.conf.json); [`builds/typescript/scripts/desktop-stage-runtime.mjs`](../scripts/desktop-stage-runtime.mjs); [`builds/typescript/scripts/desktop-release-aliases.mjs`](../scripts/desktop-release-aliases.mjs); [`builds/typescript/client_web/src/api/runtime-api-base.ts`](../client_web/src/api/runtime-api-base.ts).
> - Tests: [`tools/docs/test/developer-journeys.test.mjs`](../../../tools/docs/test/developer-journeys.test.mjs).
<!-- catalog-contract:end tauri-desktop-boundary -->

This directory owns the native shell, not normal-user desktop installation. The canonical developer journey is [Tauri desktop setup](../../../docs/developers/setup/tauri-desktop.md); the cross-cutting component relationship remains in the [architecture overview](../../../docs/developers/architecture/README.md#tauri-desktop).

## Boundary

| Surface | Responsibility |
|---|---|
| `tauri.conf.json` | Dev/build hooks, Vite URL, windows, bundle targets, and embedded resource declaration |
| `src/main.rs` | Native lifecycle, dynamic loopback-port selection, persistent platform desktop data/config/secrets/log paths, MCP and gateway supervision, desktop transport token, app-platform target configuration, window readiness, browser-access boundary |
| `src/process_containment.rs` | Windows Job Object or Unix process-group containment for fixed runtime children and inherited app descendants, with shutdown orphan protection |
| `src/native_export.rs` | Native PDF save chooser, bounded request validation, atomic commit, and safe-label-only result |
| `src/tailscale_access.rs` / `src/tailscale_runtime.rs` | Platform discovery and guarded optional Tailscale browser-access lifecycle |
| `capabilities/default.json` | Tauri capability allowlist |
| `../client_web/src/api/runtime-api-base.ts` | Browser-versus-Tauri API base selection and desktop request header |
| `../scripts/desktop-prepare-dev.mjs` | Clean-clone creation of the ignored resource root required by Tauri development builds and Cargo tests |
| `../scripts/desktop-stage-runtime.mjs` | Release-build staging of Node, compiled gateway/MCP, web assets, adapters, starter pack, and the declared Resume Builder and Brief Builder UI resources |

During `desktop:dev`, the before-dev hook creates the ignored `desktop-runtime/` resource root when it is absent, then Vite serves the frontend. Rust resolves the source workspace, starts the built MCP package and gateway on free loopback ports, waits for health, and exposes runtime status through a Tauri command. Release builds replace that root with the staged runtime. Generated/staged runtime content is not hand-edited.

## Commands

Run from `builds/typescript/`:

```bash
npm run desktop:preflight
npm run desktop:test
npm run desktop:dev
```

- `desktop:preflight` builds the TypeScript gateway, builds the MCP package, and typechecks the web client.
- `desktop:test` prepares the ignored development resource root, runs runtime tests, builds MCP, runs web tests, and runs Cargo tests.
- `desktop:dev` invokes Tauri; its configured before-dev hook reruns preflight and starts Vite.
- `desktop:build:windows` and `desktop:build:mac` snapshot the expected platform/version before Tauri runs and refuse to alias an installer that was not produced by that invocation. A stale bundle can never satisfy a current release gate.

These commands do not need a model-provider credential for build, test, runtime health, or the desktop shell. A model response is a separate authorized integration check.

## Configuration, platform claims, and data safety

The bundle configuration targets Windows, macOS, and Linux. Configured output targets are not support claims. V1 J-05 claims native Windows and native macOS; Linux remains configured but unclaimed. WSL/Linux may run preflight, tests, builds, and launch diagnostics, but cannot satisfy either native report. Report the actual OS/toolchain used and never translate one environment into another platform's evidence.

Desktop startup creates application data, configuration, secret, and log directories through Tauri platform paths. Controlled runs must use isolated task-specific platform data roots; do not inspect or overwrite an existing owner's desktop state.

Optional browser/Tailscale access is not part of basic desktop readiness and must not be enabled as a setup side effect. It has separate network and mutation safeguards in source and tests.

The native first-party app runtime uses the same signed-package verifier, app-scoped operation journal, three-restart-per-installation budget, and per-app retention policy as Docker. Tauri stages both reviewed packages, selects `desktop_windows_x64` on Windows or `desktop_macos_universal` on macOS, and enables the app platform below the platform data root. Windows contains the backend tree in a kill-on-close Job Object with the existing one-logical-CPU-equivalent group ceiling and 512 MiB per-process ceiling. macOS launches each fixed backend child as a separate process group and terminates those groups on controlled shutdown, signal handling, or containment drop so Node descendants do not survive the shell. At most two first-party apps may be active. App processes bind authenticated random loopback and receive no inherited owner environment. Supervisor log lines are capped at 4 KiB and the file restarts at 1 MiB. The native export command opens the operating-system chooser and returns only a safe file label; renderer receipt finalization happens after the chooser outcome.

The JavaScript and PowerShell staging paths both include the two UI resources and pass source-side preflight/tests. Those checks do not prove the changed Spec 08 candidate on either native platform. Fresh native Windows and macOS J-05 plus the two-app lifecycle/process/owner journey on the exact immutable candidate remain required; WSL/Linux diagnostics are not a substitute.

`runtime-api-base.test.ts` covers dynamic gateway resolution, `/api` rewriting, the authoritative desktop transport header, browser proxy behavior, and fail-closed incomplete handoff. These source tests correct the shared boundary but do not turn the preserved WSL diagnostic failure into passing J-05 evidence; both native reports remain required under OPEN-03.

## Verification routing

- Rust shell, native chooser, or process containment: `cargo fmt --manifest-path Cargo.toml -- --check`, focused Cargo test, then `npm run desktop:test`.
- Web/Tauri adapter: focused Vitest, web lint/typecheck/test/build, then desktop tests.
- Dev/build hook or embedded runtime: `npm run desktop:preflight`, `npm run desktop:stage-runtime`, controlled `npm run desktop:dev`, and the platform command (`desktop:build:windows` or unsigned `desktop:build:mac`) plus install/live matrix when release packaging changed.
- Remote browser/Tailscale behavior: focused Rust/bridge tests plus the separate authorized manual boundary.

See [change verification](../../../docs/developers/verification.md) for the broader matrix and [safe debugging](../../../docs/developers/debugging.md) for evidence rules.
