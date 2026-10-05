# Spec 05 Milestone 6 — dynamic installed-app supervisor

Milestone 6 extends the accepted version-1 `InstalledAppSupervisor`; it does not add a second lifecycle owner. Spec 04 remains authoritative for install, grants, durable lifecycle state, update, rollback, quarantine, uninstall, and persisted runtime authority. Final Resume Builder view/reconnect integration remains Milestone 7 work and is absent here.

## Contract and launch authority

The protocol remains version 1 with normalized states `starting`, `ready`, `unhealthy`, `backoff`, `restarting`, `failed_recoverable`, and `stopped`. `InstalledAppSupervisorAdapter` resolves the declared entrypoint through the immutable verified-package store, checks the exact live installation/package/grant identity, and passes only a resolved verified script to `ProcessAppSupervisor`.

Application arguments are exactly empty. Environment authority is the exact ordered list below; the child does not inherit the gateway environment:

1. `BRAINDRIVE_APP_CONNECTION_TOKEN`
2. `BRAINDRIVE_APP_ID`
3. `BRAINDRIVE_INSTALLATION_ID`
4. `BRAINDRIVE_PACKAGE_DIGEST`
5. `BRAINDRIVE_ENDPOINT_BIND`

The accepted resource policy is one process/container, one logical CPU, 512 MiB memory, 1 MiB output/request, 120-second request timeout, 30-second startup timeout, three crash restarts, and 1/2/4-second backoff followed by owner retry. The protocol schema rejects any changed value. Docker applies the container boundary; packaged Windows applies the Tauri-owned Job Object hard cap and kill-on-close boundary.

## Readiness, negotiation, and registration

Each generation receives a random host-issued connection token and a newly allocated `127.0.0.1` port. Docker describes the endpoint as authenticated `container_internal`; desktop describes authenticated `loopback`. Neither endpoint is public. An unauthenticated health request returns 401.

Registration is a strict gate:

```text
verified start -> authenticated readiness/health -> M2 core + Apps negotiation
               -> bounded catalog discovery -> exact dynamic registration -> token permit
```

`M2RuntimeRegistrationNegotiator` uses the existing M2 `McpConnectionManager` and official SDK peer. It requires modern core `2026-07-28`, Apps extension `2026-01-26`, tools/resources facilities, server identity, and bounded catalogs. Registration must present the exact endpoint descriptor returned by readiness. A failed negotiation, mismatched endpoint/connection/runtime identity, or capability-token permit closes the M2 connection and creates no registration. Duplicate identical registration is idempotent; a second differing registration is rejected.

## Recovery and cleanup

Unexpected exit, failed health, and output-limit containment revoke stale dynamic registration and token authority before backoff. Runtime and endpoint-token generations rotate on every launch. Attempts are bounded to three with exact 1,000/2,000/4,000 ms delays; the fourth failure removes the runtime and records actionable `restart_exhausted`/`failed_recoverable`. A recovered generation repeats readiness, M2 negotiation, dynamic registration, and token permit before reuse.

On Linux and macOS the Node child is the leader of a detached installation-owned process group; stop sends `SIGTERM` and then `SIGKILL` to that exact group if the grace deadline expires. A stale runtime identity cannot target a different live generation. On packaged Windows, the gateway descendant is additionally contained by Tauri's Job Object, which is the parent-loss and whole-runtime fail-safe. Stop/revoke/cleanup revoke token authority first, close the exact M2 registration, and then terminate the exact runtime. Reconciliation contains unknown or stale authority rather than adopting an ambiguous process.

The supervisor never stores stdout/stderr content. It stores a bounded metadata summary and a bounded diagnostic ring. A representative safe log summary is:

```json
{"observed_bytes":4096,"limit_bytes":4096,"truncated":true,"content_stored":false}
```

A representative recovery trace contains only state/action/generation/attempt/backoff/endpoint class/error code:

```text
unhealthy/revoke_before_restart -> backoff/1000 -> restarting -> ready
unhealthy/revoke_before_restart -> backoff/2000 -> restarting -> ready
unhealthy/revoke_before_restart -> backoff/4000 -> restarting -> ready
unhealthy/revoke_before_restart -> failed_recoverable/restart_exhausted
```

No path, command, token, environment value, stdout/stderr content, owner content, or credential enters these records.

## Docker and packaged desktop

Docker development explicitly selects `docker_linux_x64`, adds `no-new-privileges`, and publishes no app-service port. There is no Docker socket, app connection token, endpoint bind, or host user path in Compose. The fixed gateway and MCP children remain unchanged; the dynamic app remains a gateway-supervised child using the already packaged Node runtime.

Desktop uses the staged `desktop-runtime/node/{node|node.exe}` and compiled `typescript/dist/gateway/server.js`. Tauri selects `desktop_windows_x64`; the trusted gateway owns installed-app lifecycle control. The main webview capability remains `core:default` and contains no shell, process, command, or HTTP authority, so sandboxed iframe code cannot invoke process control. Native Windows x64 is the accepted packaged target; Linux runs TypeScript/process and non-Windows Rust conformance but cannot prove Windows Job Object execution or installer signing.

## Executable evidence

- `spec-05-m6-supervisor.test.ts`: invalid descriptors, argv/env/entrypoint/public-bind allowlists, occupied-port failure, process and `/proc` command-line observation, private token/port behavior, fake-clock 1/2/4 backoff, crash exhaustion, log flood containment/redaction, forced group kill, and unrelated-process survival.
- `spec-05-m6-adapter.test.ts`: readiness-before-registration, negotiation-before-permit, duplicate registration, stop cleanup, and token-issuer failure.
- `runtime-negotiator.test.ts`: live modern M2/Apps/catalog negotiation and legacy/malformed rejection.
- `app-lifecycle.m4.test.ts` and `app-lifecycle.m5.test.ts`: shared fake conformance, exact cleanup/orphan/restart behavior, duplicate/adopt ambiguity, lifecycle ordering/races, and sole-registration candidate promotion.
- `docker-runtime.test.ts`: target selection, no app port/socket/host path, read-only package input, and `no-new-privileges`.
- `desktop-supervisor-boundary.test.ts`, `desktop-parity.test.ts`, and Rust desktop tests: packaged runtime/compiled JS, trusted gateway/Tauri boundary, Job Object limits/parent-loss cleanup, no iframe authority, and shared lifecycle parity.

Live fixture tests create only task-owned loopback processes and remove them after each test. They do not modify or restart a pre-existing Docker stack.
