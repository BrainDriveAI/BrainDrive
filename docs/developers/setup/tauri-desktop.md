# Tauri desktop development

<!-- catalog-contract:start tauri-desktop-setup -->
> **Document contract**
> - Purpose: Run the Tauri 2 desktop shell and its embedded local BrainDrive runtime with platform and data effects explicit.
> - Audience: First-time contributors, Recurring contributors, Maintainers, AI coding agents, Verification agents and human reviewers.
> - Status: Current on `dev`; Milestone 2.
> - Owner role: runtime-maintainers.
> - Expected outcome: Desktop preflight passes and the provider-independent desktop shell reaches its ready local runtime on an evidenced claimed platform.
> - Prerequisites: Node.js 22 and npm; Rust toolchain; Tauri platform dependencies; Graphical desktop session; Installed TypeScript, web, and MCP dependencies.
> - Parent: [docs/developers/README.md](../README.md).
> - Adjacent topics: [BrainDrive Tauri desktop shell](../../../builds/typescript/src-tauri/README.md); [Native TypeScript and web development](./native.md); [Change verification](../verification.md); [Safe debugging and failure evidence](../debugging.md).
> - Keywords: `Tauri desktop`, `Rust`, `embedded runtime`, `provider-independent startup`.
> - Sources: [`builds/typescript/src-tauri/tauri.conf.json`](../../../builds/typescript/src-tauri/tauri.conf.json); [`builds/typescript/src-tauri/src/main.rs`](../../../builds/typescript/src-tauri/src/main.rs); [`builds/typescript/src-tauri/src/process_containment.rs`](../../../builds/typescript/src-tauri/src/process_containment.rs); [`builds/typescript/src-tauri/src/native_export.rs`](../../../builds/typescript/src-tauri/src/native_export.rs); [`builds/typescript/scripts/desktop-stage-runtime.mjs`](../../../builds/typescript/scripts/desktop-stage-runtime.mjs); [`builds/typescript/scripts/desktop-release-aliases.mjs`](../../../builds/typescript/scripts/desktop-release-aliases.mjs); [`builds/typescript/package.json`](../../../builds/typescript/package.json).
> - Tests: [`tools/docs/test/developer-journeys.test.mjs`](../../../tools/docs/test/developer-journeys.test.mjs).
<!-- catalog-contract:end tauri-desktop-setup -->

The Tauri shell uses the Vite client during development. Its designed runtime boundary bypasses the browser Vite proxy: Rust starts three MCP processes and a gateway on free loopback ports, returns that runtime URL plus a desktop transport token to the web client, and stores desktop data separately from the repository development fixture. A controlled run must verify that the client actually makes that switch; embedded-runtime health alone is not a passing desktop journey.

## Prerequisites

- Node.js 22/npm and dependencies installed in `builds/typescript/`, `builds/typescript/client_web/`, and `builds/mcp_release/`.
- Rust stable with `cargo` and a native compiler/linker.
- Tauri 2 platform prerequisites from the [official prerequisite guide](https://v2.tauri.app/start/prerequisites/): WebView2 and Microsoft C++ Build Tools on native Windows; Xcode or Xcode Command Line Tools on native macOS. Linux WebKitGTK, GTK, OpenSSL, and build packages may be used for source/build diagnostics, but do not establish a V1 Linux desktop support claim.
- A graphical desktop session. Headless shells can run preflight/tests but do not prove the desktop window journey.
- The Vite development port must be free. The embedded MCP and gateway ports are selected dynamically.

Repository configuration defines Windows, macOS, and Linux bundle targets. That is configuration truth, not the claimed-platform matrix. V1 J-05 now claims native Windows and native macOS; Linux remains configured without a V1 J-05 support claim.

Windows and macOS each require their own native exact-candidate J-05 report. WSL/Linux may run `desktop:preflight`, `desktop:test`, compilation, and controlled launch diagnostics, but those results cannot substitute for either claimed platform. Final readiness fails closed until both native reports are present, valid, and compatible with the source candidate.

## Command contract

| Field | Contract |
|---|---|
| Working directory | `builds/typescript/` |
| Commands | `npm run desktop:preflight`, then `npm run desktop:dev` |
| Platform | V1 J-05 claims native Windows and native macOS. Linux remains configured but unclaimed; WSL/Linux is diagnostic-only |
| Mode | Tauri development shell with local embedded runtime; not Docker or managed deployment |
| Credential need | None for preflight, runtime health, local authentication UI, or the desktop shell |
| Side effects | Preflight emits TypeScript/MCP build output; dev creates the ignored Tauri resource root when absent, starts Vite and compiles Rust, writes Cargo target artifacts, starts local child services, creates desktop app data/config/secrets/log directories, and opens native windows |
| Expected result | Preflight exits 0; Vite and Rust compile; MCP and gateway health checks pass; the splash closes and the main window becomes usable |
| Failure classification | Toolchain, platform library, build/typecheck, Vite port, Rust compile/link, embedded runtime, desktop transport handoff, or window/display |
| Cleanup | Press `Ctrl-C` in the Tauri process and wait for child services to stop. Remove only task-specific XDG/app-data locations created for controlled evidence |
| Risk tier | Tier B — platform-specific controlled execution |

```bash
cd builds/typescript
npm run desktop:preflight
npm run desktop:dev
```

`desktop:dev` already invokes preflight and creates the ignored `src-tauri/desktop-runtime/` resource root through `tauri.conf.json`; running preflight separately first makes failures easier to classify and provides an independent check result. Development still runs against the source workspace. Release builds replace that root with the fully staged runtime.

`desktop:test` invokes the same resource preparation before its runtime, MCP, web, and Cargo checks. A clean clone therefore does not need an earlier `desktop:dev` run to satisfy Tauri's declared resource path.

The bare development command uses the current OS account's normal application data/config/cache paths. For isolated Windows or macOS evidence, set `APPDATA` and `LOCALAPPDATA` to explicit subdirectories of a validated task-owned root before starting BrainDrive; the Rust shell honors those overrides. For isolated Linux/WSL diagnostics, set `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME` instead. Stop the process and verify its children have exited before removing only that task-owned root; never redirect, inspect, or delete an owner's normal desktop directories.

## Prior WSL diagnostic record

The 2026-08-01 WSL/Linux controlled journey failed to reach the usable shell. Preflight passed, Vite and Rust compiled, the native window and WebKit processes launched, all three MCP services became ready, and the dynamically allocated gateway health check passed. In two isolated runs, however, the client continued sending `/api` traffic through the Vite proxy to its fixed native-development gateway target. The local auth/bootstrap surface therefore did not reach the usable-shell baseline even though the embedded runtime was healthy.

This remains a diagnostic failure record. It is not relabeled as passing J-05 evidence, does not establish Linux/WSL support, and cannot substitute for either claimed native platform. Do not work around it by starting an unrelated gateway on the Vite proxy target or by reusing owner desktop data: either action would hide the failed desktop transport handoff.

The shared client handoff was subsequently corrected under focused source tests: a Tauri status without a ready state, loopback gateway URL, and desktop transport token now fails closed instead of caching `/api`, and caller headers cannot replace the native token. That correction invalidates older platform evidence and requires fresh native runs. It does not retroactively change this WSL result or prove a native window journey.

| Claimed platform | J-05 evidence state |
|---|---|
| Native Windows | Prior J-05 evidence is stale for Spec 08 desktop staging/runtime changes; fresh exact-candidate two-app evidence is required |
| Native macOS | Claimed; fresh exact-candidate two-app evidence is required |
| WSL/Linux | Not claimed for V1 J-05; diagnostics only |

## Provider-independent baseline

Basic desktop success is the ready embedded MCP/gateway runtime plus the rendered shell and local auth/onboarding surface. It does not require a provider credential, model credit, model download, or chat response. The shell sets a local Ollama-compatible default address for later use, but no Ollama server is required to reach runtime readiness.

Use task-specific platform data roots for controlled evidence so a run does not read or overwrite an existing desktop owner's data. Do not inspect existing desktop secrets or logs to prove a clean baseline.

## Provider validation is separate

Any model response is a separate Tier C check with explicit provider authority. Desktop transport-token behavior is part of the local shell/runtime boundary; provider authorization is not.

## Failure classification

- `cargo`, compiler, WebView, or platform library missing: toolchain/platform prerequisite failure.
- TypeScript/MCP build or web typecheck fails: preflight failure.
- Vite cannot bind: port conflict, usually an existing native or Docker web process.
- Rust compile/link error: desktop build failure.
- Window cannot open in a headless session: display/environment failure.
- Splash reports local runtime failure: inspect the task-specific supervisor and service logs after sanitization; classify MCP versus gateway health.
- Embedded runtime is ready but Vite reports proxy failures: desktop transport handoff failure. Do not classify it as provider failure or satisfy the proxy with an unrelated gateway.
- Provider error after the main shell is ready: provider integration failure.

## Cleanup and recovery

Stop with `Ctrl-C` and verify no task-owned Tauri, Vite, gateway, or MCP process remains. Restore any pre-existing service temporarily stopped to free the Vite port. Preserve Cargo and package caches unless the failure specifically implicates generated output; never delete owner desktop data as a generic retry.

## Source evidence

- [`tauri.conf.json`](../../../builds/typescript/src-tauri/tauri.conf.json) owns the before-dev command, Vite URL, windows, bundles, and embedded resource declaration.
- [`main.rs`](../../../builds/typescript/src-tauri/src/main.rs) owns desktop data paths, free-port allocation, child services, health checks, transport token, and window readiness.
- [`desktop-prepare-dev.mjs`](../../../builds/typescript/scripts/desktop-prepare-dev.mjs) ensures a clean clone has the resource root required by Tauri development builds and Cargo tests.
- [`runtime-api-base.ts`](../../../builds/typescript/client_web/src/api/runtime-api-base.ts) owns browser-versus-Tauri API resolution.
- [`package.json`](../../../builds/typescript/package.json) owns preflight, dev, build, and desktop-test command composition.

Focused tests cover `resolveGatewayBaseUrl`, `/api` rewriting to the dynamic gateway, the desktop request header, and fail-closed incomplete handoff. OPEN-03 tracks the required native Windows and macOS reports while preserving Linux as configured but unclaimed. Evidence-policy changes may revalidate compatible native evidence across source revisions; executable Tauri/runtime/API/script/package changes still force a native rerun on both claimed platforms.
