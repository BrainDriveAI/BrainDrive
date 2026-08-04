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
> - Sources: [`builds/typescript/src-tauri/src/main.rs`](./src/main.rs); [`builds/typescript/src-tauri/tauri.conf.json`](./tauri.conf.json); [`builds/typescript/client_web/src/api/runtime-api-base.ts`](../client_web/src/api/runtime-api-base.ts).
> - Tests: [`tools/docs/test/developer-journeys.test.mjs`](../../../tools/docs/test/developer-journeys.test.mjs).
<!-- catalog-contract:end tauri-desktop-boundary -->

This directory owns the native shell, not normal-user desktop installation. The canonical developer journey is [Tauri desktop setup](../../../docs/developers/setup/tauri-desktop.md); the cross-cutting component relationship remains in the [architecture overview](../../../docs/developers/architecture/README.md#tauri-desktop).

## Boundary

| Surface | Responsibility |
|---|---|
| `tauri.conf.json` | Dev/build hooks, Vite URL, windows, bundle targets, and embedded resource declaration |
| `src/main.rs` | Native lifecycle, dynamic loopback-port selection, persistent platform desktop data/config/secrets/log paths, MCP and gateway supervision, desktop transport token, window readiness, browser-access boundary |
| `src/tailscale_access.rs` / `src/tailscale_runtime.rs` | Platform discovery and guarded optional Tailscale browser-access lifecycle |
| `capabilities/default.json` | Tauri capability allowlist |
| `../client_web/src/api/runtime-api-base.ts` | Browser-versus-Tauri API base selection and desktop request header |
| `../scripts/desktop-prepare-dev.mjs` | Clean-clone creation of the ignored resource root required by Tauri development builds and Cargo tests |
| `../scripts/desktop-stage-runtime.mjs` | Release-build staging of Node, compiled gateway/MCP, web assets, adapters, and starter pack |

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

These commands do not need a model-provider credential for build, test, runtime health, or the desktop shell. A model response is a separate authorized integration check.

## Configuration, platform claims, and data safety

The bundle configuration targets Windows, macOS, and Linux. Configured output targets are not support claims. V1 J-05 claims native Windows and native macOS; both reports are `DEFERRED — REQUIRED BEFORE MILESTONE 7`. WSL/Linux may run preflight, tests, builds, and launch diagnostics, but is not a claimed J-05 environment unless separately adopted and evidenced. Report the actual OS/toolchain used and never translate WSL execution into native Windows evidence.

Desktop startup creates application data, configuration, secret, and log directories through Tauri platform paths. Controlled runs must use isolated task-specific platform data roots; do not inspect or overwrite an existing owner's desktop state.

Optional browser/Tailscale access is not part of basic desktop readiness and must not be enabled as a setup side effect. It has separate network and mutation safeguards in source and tests.

`runtime-api-base.test.ts` now covers dynamic gateway resolution, `/api` rewriting, the authoritative desktop transport header, browser proxy behavior, and fail-closed incomplete handoff. These source tests correct the shared boundary but do not turn the preserved WSL diagnostic failure into passing J-05 evidence; native Windows and macOS reports remain required under OPEN-03.

## Verification routing

- Rust shell or lifecycle: focused Cargo test, then `npm run desktop:test`.
- Web/Tauri adapter: focused Vitest, web lint/typecheck/test/build, then desktop tests.
- Dev/build hook or embedded runtime: `npm run desktop:preflight`, controlled `npm run desktop:dev`, and build staging only when release packaging changed.
- Remote browser/Tailscale behavior: focused Rust/bridge tests plus the separate authorized manual boundary.

See [change verification](../../../docs/developers/verification.md) for the broader matrix and [safe debugging](../../../docs/developers/debugging.md) for evidence rules.
