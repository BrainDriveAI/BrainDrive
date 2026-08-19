# Docker development with hot reload

<!-- catalog-contract:start docker-development-setup -->
> **Document contract**
> - Purpose: Start and stop the source-mounted Docker development stack with its state, network, and cleanup effects explicit.
> - Audience: First-time contributors, Recurring contributors, Maintainers, AI coding agents, Verification agents and human reviewers.
> - Status: Current on `dev`; Milestone 2.
> - Owner role: installer-maintainers.
> - Expected outcome: The provider-independent Docker dev web shell is observable and the contributor can preserve or clean up only intended state.
> - Prerequisites: Docker Engine or Desktop with the Compose plugin; Existing installer initialization for the start-only journey; Available configured web port.
> - Parent: [docs/developers/README.md](../README.md).
> - Adjacent topics: [Native TypeScript and web development](./native.md); [Docker installer and deployment overview](../../../installer/docker/README.md); [Docker lifecycle script reference](../../../installer/docker/scripts/README.md); [Safe debugging and failure evidence](../debugging.md).
> - Keywords: `Docker dev`, `hot reload`, `compose.dev.yml`, `provider-independent startup`.
> - Sources: [`installer/docker/compose.dev.yml`](../../../installer/docker/compose.dev.yml); [`installer/docker/scripts/start.sh`](../../../installer/docker/scripts/start.sh); [`installer/docker/scripts/stop.sh`](../../../installer/docker/scripts/stop.sh); [`installer/docker/scripts/native-command.ps1`](../../../installer/docker/scripts/native-command.ps1).
> - Tests: [`tools/docs/test/developer-journeys.test.mjs`](../../../tools/docs/test/developer-journeys.test.mjs); [`tools/docs/test/powershell-lifecycle.test.mjs`](../../../tools/docs/test/powershell-lifecycle.test.mjs); [`installer/docker/scripts/test/image-hardening.sh`](../../../installer/docker/scripts/test/image-hardening.sh).
<!-- catalog-contract:end docker-development-setup -->

Docker `dev` is the source-mounted hot-reload mode. It is not Docker `local`: `local` pulls published images and serves through the local edge container, while `dev` builds the app image, mounts source, runs the gateway under `tsx watch`, and runs Vite with HMR.

## Prerequisites

- Docker Engine or Docker Desktop is running and `docker compose version` succeeds.
- Run repository commands from the repository root. The only canonical script tree is `installer/docker/scripts/`.
- For the required start-only journey, installer initialization already exists. A first installation uses `./installer/docker/scripts/install.sh dev`, which creates a protected `.env`, generates a local secrets-encryption key, creates persistent Docker state, builds images, and starts the stack. Do not run it over an existing `.env`.
- You are authorized to mount and, during container startup, change ownership of the configured `PAA_LIBRARY_HOST_PATH`. The default is the repository development memory fixture; select a task-owned bind path for isolated evidence.
- The configured host web port is free. The gateway remains internal to the Compose network.
- Building or missing images/dependencies requires network access.

## Command contract

| Field | Contract |
|---|---|
| Working directory | Repository root |
| Command | `./installer/docker/scripts/start.sh dev` |
| Platform | Current execution evidence is WSL/Linux shell only. Shell entry points also exist for macOS; PowerShell entry points exist for Windows, but neither platform is evidenced here |
| Mode | Docker `dev` only; not `local`, `prod`, or managed deployment |
| Credential need | No model-provider credential for startup or the web shell; an existing install may contain a local secrets-encryption key that must not be printed |
| Side effects | Ensures named volumes and the Compose network exist; may build/start/recreate services; recursively changes ownership of the configured host memory bind plus secrets/dependency state to the configured host UID/GID; runs `npm install` in bind-mounted workspaces; persists feature-gated app lifecycle state in a separate named volume; binds Vite and its proxied API; and may attempt a browser open |
| Expected result | Compose reports the app healthy and web running; the web shell responds through the configured dev binding |
| Failure classification | Docker prerequisite, Compose/config, build/dependency, bind-mount/permission, port conflict, app health, or web startup |
| Cleanup | For a stack created for the task, run `./installer/docker/scripts/stop.sh dev`; this stops containers but preserves volumes and bind-mounted data. Do not stop a pre-existing stack merely to satisfy generic cleanup |
| Risk tier | Tier B — stateful controlled execution |

```bash
./installer/docker/scripts/start.sh dev
docker compose -f installer/docker/compose.dev.yml ps
```

## Provider-independent baseline

Basic success is the healthy app service, running web service, and responsive web shell. The Compose app can reach the MCP health endpoints and gateway health endpoint without BrainDrive Models credit, an OpenRouter credential, or a running Ollama model. Do not send a provider request as part of this baseline.

The default state map is exact:

| State | Docker dev behavior |
|---|---|
| TypeScript source | Bind-mounted from `builds/typescript/` |
| Web source | Bind-mounted from `builds/typescript/client_web/` |
| Runtime memory | Host bind mount from `PAA_LIBRARY_HOST_PATH`, defaulting to the repository development memory fixture |
| Secrets | External named volume `braindrive_secrets` |
| Runtime dependencies | Named volume `braindrive_dev_app_node_modules` |
| Web dependencies | Named volume `braindrive_dev_web_node_modules` |
| App lifecycle host state | Named volume `braindrive_dev_app_platform`, mounted at `/data/app-platform`; separate from the owner memory bind and enabled only by `BRAINDRIVE_APP_PLATFORM_ENABLED` |
| Network | Compose network `braindrive_dev_default`; app remains internal while Vite exposes the selected host bind and proxies `/api` to the app |

Although the lifecycle script ensures `braindrive_memory` exists in dev mode, the current `compose.dev.yml` memory mount is the host path above. Do not describe that unused created volume as the active dev memory store.

The reviewed Resume Builder and Brief Builder packages are available for explicit authenticated lifecycle exercises through one generic first-party app platform, but neither installs or starts automatically. Their supervised endpoints bind only inside the app container and Compose publishes no additional app port. Both package source mounts are read-only. `stop.sh dev` preserves the shared host-state volume and app-scoped records; do not remove that volume unless the exact lifecycle test state is task-owned and destructive cleanup is explicitly authorized.

On app-container startup, the root entrypoint recursively applies `chown` to the active memory bind, lifecycle host-state volume, secrets volume, app dependency volume, and its temporary home before dropping to `BRAINDRIVE_DEV_HOST_UID` / `BRAINDRIVE_DEV_HOST_GID` (both default to `1000`). Both app and web containers run `npm install` from bind-mounted workspace directories; `node_modules` is isolated in named volumes, but package metadata or lockfiles can still change if npm resolves a difference. Review the worktree after a recreate.

Authorize the exact host bind and UID/GID before starting. If ownership is wrong, stop the stack and recover only the verified affected target using its known prior ownership and appropriate host authority; do not apply a recursive ownership command to an unverified owner path.

The default web bind is loopback. Setting `BRAINDRIVE_DEV_BIND_HOST=0.0.0.0` exposes both the Vite shell and its proxied gateway API to the LAN. Use it only on a trusted LAN with understood local-auth state; it is a non-TLS development surface, not production exposure guidance.

## Current controlled evidence

The 2026-08-01 WSL/Linux journey exercised only `start.sh dev` against a pre-existing initialized stack. Compose reported the existing app healthy and reused the app/web containers; the web endpoint responded. The web service was temporarily stopped and restarted only to free its host port for other controlled journeys, then the original running app/web state was restored. No first install, rebuild, local/prod mode, PowerShell, Windows, or macOS result is claimed.

The PowerShell install/start/stop scripts now check every required native Docker process exit before printing completion. A WSL static contract test verifies the shared fail-closed wrapper and rejects unchecked direct Docker invocations. This closes the source defect only: do not cite it as passing Windows evidence until a controlled native Windows run exercises the scripts.

## Provider validation is separate

Provider response testing is Tier C and requires explicit authority for the selected provider, owner credential, network target, or local model. BrainDrive Models, owner-supplied OpenRouter, and Ollama remain independent choices. A provider failure after the shell loads does not invalidate the Docker startup baseline.

## Failure classification

- Docker daemon or Compose unavailable: prerequisite failure.
- `.env` or interpolation problem: installer/config failure; do not print the file.
- Build or `npm install` failure: image/dependency/network failure.
- Permission error under the mounted source or data path: UID/GID or bind-mount failure.
- Host bind failure: port conflict; identify the existing owner before changing it.
- App remains unhealthy: MCP/gateway startup failure; inspect sanitized service status before logs.
- App healthy but web absent: web dependency/Vite failure.
- PowerShell native Docker failure: the lifecycle script must throw before completion output; if a native Windows run observes otherwise, record a source regression and do not record a pass.

## Cleanup and recovery

For a task-created stack:

```bash
./installer/docker/scripts/stop.sh dev
docker compose -f installer/docker/compose.dev.yml ps
```

`stop` preserves containers, named volumes, `.env`, and bind-mounted memory. Removing volumes, resetting a new user, or deleting `.env` is destructive and is not routine development cleanup. If the stack existed before the task, restore its prior running/stopped state and do not remove its data.

## Source evidence

- [`compose.dev.yml`](../../../installer/docker/compose.dev.yml) is authoritative for mounts, ports, health checks, dependency installation, service commands, and named volumes.
- [`start.sh`](../../../installer/docker/scripts/start.sh) selects dev Compose, ensures volumes, starts services, prints status, and attempts a browser open.
- [`stop.sh`](../../../installer/docker/scripts/stop.sh) stops services without removing containers or volumes.
- [`native-command.ps1`](../../../installer/docker/scripts/native-command.ps1) owns fail-closed native exit handling for the PowerShell install/start/stop paths; [`powershell-lifecycle.test.mjs`](../../../tools/docs/test/powershell-lifecycle.test.mjs) enforces the source contract in WSL.
- [`installer/docker/scripts/README.md`](../../../installer/docker/scripts/README.md) owns the per-script reference; the [Docker overview](../../../installer/docker/README.md) owns mode distinctions.
