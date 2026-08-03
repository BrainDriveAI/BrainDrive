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
> - Sources: [`builds/typescript/src-tauri/tauri.conf.json`](../../../builds/typescript/src-tauri/tauri.conf.json); [`builds/typescript/src-tauri/src/main.rs`](../../../builds/typescript/src-tauri/src/main.rs); [`builds/typescript/package.json`](../../../builds/typescript/package.json).
> - Tests: [`tools/docs/test/developer-journeys.test.mjs`](../../../tools/docs/test/developer-journeys.test.mjs).
<!-- catalog-contract:end tauri-desktop-setup -->

The Tauri shell uses the Vite client during development. Its designed runtime boundary bypasses the browser Vite proxy: Rust starts three MCP processes and a gateway on free loopback ports, returns that runtime URL plus a desktop transport token to the web client, and stores desktop data separately from the repository development fixture. A controlled run must verify that the client actually makes that switch; embedded-runtime health alone is not a passing desktop journey.

## Prerequisites

- Node.js 22/npm and dependencies installed in `builds/typescript/`, `builds/typescript/client_web/`, and `builds/mcp_release/`.
- Rust stable with `cargo` and a native compiler/linker.
- Tauri 2 platform prerequisites from the [official prerequisite guide](https://v2.tauri.app/start/prerequisites/): WebView2 and Microsoft C++ Build Tools on native Windows; Xcode or Xcode Command Line Tools on native macOS. Linux WebKitGTK, GTK, OpenSSL, and build packages may be used for source/build diagnostics, but do not establish a V1 Linux desktop support claim.
- A graphical desktop session. Headless shells can run preflight/tests but do not prove the desktop window journey.
- The Vite development port must be free. The embedded MCP and gateway ports are selected dynamically.

Repository configuration defines Windows, macOS, and Linux bundle targets. That is configuration truth, not the claimed-platform matrix. V1 J-05 claims native Windows and native macOS. WSL and Linux are not claimed J-05 platforms unless a later maintainer decision explicitly adopts them and supplies their own successful evidence.

WSL may run `desktop:preflight`, `desktop:test`, compilation, and controlled launch diagnostics. Those results cannot satisfy native Windows or native macOS J-05 evidence. While the V1 claims remain, both required reports are recorded as `DEFERRED — REQUIRED BEFORE MILESTONE 7`; final readiness must fail closed if either native report is absent.

## Command contract

| Field | Contract |
|---|---|
| Working directory | `builds/typescript/` |
| Commands | `npm run desktop:preflight`, then `npm run desktop:dev` |
| Platform | V1 J-05 claims native Windows and native macOS. WSL/Linux is diagnostic-only and is not claimed desktop-support evidence |
| Mode | Tauri development shell with local embedded runtime; not Docker or managed deployment |
| Credential need | None for preflight, runtime health, local authentication UI, or the desktop shell |
| Side effects | Preflight emits TypeScript/MCP build output; dev starts Vite and compiles Rust, writes Cargo target artifacts, starts local child services, creates desktop app data/config/secrets/log directories, and opens native windows |
| Expected result | Preflight exits 0; Vite and Rust compile; MCP and gateway health checks pass; the splash closes and the main window becomes usable |
| Failure classification | Toolchain, platform library, build/typecheck, Vite port, Rust compile/link, embedded runtime, desktop transport handoff, or window/display |
| Cleanup | Press `Ctrl-C` in the Tauri process and wait for child services to stop. Remove only task-specific XDG/app-data locations created for controlled evidence |
| Risk tier | Tier B — platform-specific controlled execution |

```bash
cd builds/typescript
npm run desktop:preflight
npm run desktop:dev
```

`desktop:dev` already invokes preflight through `tauri.conf.json`; running it separately first makes failures easier to classify and provides an independent check result.

The bare development command uses the current OS account's normal application data/config/cache paths. For isolated Linux/WSL evidence, allocate a task-owned root first and set `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME` to explicit subdirectories of it for the `npm run desktop:dev` process. Stop the process before removing only that validated root. Windows and macOS need an authorized disposable OS account or equivalent isolated environment until a repository-supported path override is evidenced; do not redirect or delete an owner's normal desktop directories.

## Prior WSL diagnostic record

The 2026-08-01 WSL/Linux controlled journey failed to reach the usable shell. Preflight passed, Vite and Rust compiled, the native window and WebKit processes launched, all three MCP services became ready, and the dynamically allocated gateway health check passed. In two isolated runs, however, the client continued sending `/api` traffic through the Vite proxy to its fixed native-development gateway target. The local auth/bootstrap surface therefore did not reach the usable-shell baseline even though the embedded runtime was healthy.

This remains a diagnostic failure record. It is not relabeled as passing J-05 evidence, does not establish Linux/WSL support, and cannot substitute for either native claimed platform. Do not work around it by starting an unrelated gateway on the Vite proxy target or by reusing owner desktop data: either action would hide the failed desktop transport handoff.

| Claimed platform | J-05 evidence state |
|---|---|
| Native Windows | `DEFERRED — REQUIRED BEFORE MILESTONE 7` |
| Native macOS | `DEFERRED — REQUIRED BEFORE MILESTONE 7` |
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
- [`runtime-api-base.ts`](../../../builds/typescript/client_web/src/api/runtime-api-base.ts) owns browser-versus-Tauri API resolution.
- [`package.json`](../../../builds/typescript/package.json) owns preflight, dev, build, and desktop-test command composition.

There is no focused automated test for `resolveGatewayBaseUrl`, `/api` rewriting to the dynamic gateway, or the desktop request header. The prior WSL failure preserves this diagnostic gap; optional Tailscale/browser-access tests do not cover the core handoff. OPEN-03 now tracks the two deferred native platform reports and the rule that WSL/Linux cannot satisfy them.
