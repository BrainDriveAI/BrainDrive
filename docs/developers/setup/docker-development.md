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
- If using `PAA_LIBRARY_HOST_PATH`, you are authorized to mount and, during container startup, change ownership of that exact host path. The default is a named Docker volume; select a task-owned bind path when a host memory directory is needed.
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
| Side effects | Ensures the selected lane's named volumes and Compose network exist; may build/start/recreate services; recursively changes ownership of the active memory mount plus secrets/dependency state to the configured host UID/GID; runs `npm ci` with read-only source mounts and writable dependency volumes; binds Vite and its proxied API; and may attempt a browser open |
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
| TypeScript source | Read-only bind mount from `builds/typescript/` |
| Web source | Read-only bind mount from `builds/typescript/client_web/` |
| Runtime memory | Named volume `BRAINDRIVE_DEV_MEMORY_VOLUME` (default `braindrive_dev_memory`); `PAA_LIBRARY_HOST_PATH` can select an existing host bind instead |
| Secrets | External named volume `BRAINDRIVE_DEV_SECRETS_VOLUME` (default `braindrive_secrets`) |
| Runtime dependencies | Named volume `BRAINDRIVE_DEV_APP_NODE_MODULES_VOLUME` (default `braindrive_dev_app_node_modules`) |
| Web dependencies | Named volume `BRAINDRIVE_DEV_WEB_NODE_MODULES_VOLUME` (default `braindrive_dev_web_node_modules`) |
| Network | Selected `BRAINDRIVE_DEV_PROJECT_NAME` Compose network (default `braindrive_dev_default`); app remains internal while Vite exposes the selected host bind and proxies `/api` to the app |

For concurrent checkouts, give each lane a unique project name, host port, image tag, memory volume, secrets volume, and both dependency volumes in its ignored `installer/docker/.env`. Keep `BRAINDRIVE_DEV_BIND_HOST=127.0.0.1` unless LAN access is intentional. The internal Vite, gateway, and MCP ports stay fixed inside each project's network.

For example, a second checkout can use `BRAINDRIVE_DEV_PROJECT_NAME=braindrive_ws2`, `BRAINDRIVE_DEV_PORT=5075`, `BRAINDRIVE_APP_IMAGE_LOCAL=braindrive-ws2-app:local`, and the matching `braindrive_ws2_*` volume names. The first checkout can keep the default `5073` port. Inspect the selected project's containers and volume names before changing an existing installation: switching from the old memory bind to a named volume starts with different memory data. Set `PAA_LIBRARY_HOST_PATH` to the old path if that data must remain active. Do not delete the old bind or volumes as part of the switch.

On app-container startup, the root entrypoint recursively applies `chown` to the active memory mount, secrets volume, app dependency volume, and its temporary home before dropping to `BRAINDRIVE_DEV_HOST_UID` / `BRAINDRIVE_DEV_HOST_GID` (both default to `1000`). Both app and web containers run `npm ci` into their named dependency volumes. The source mounts are read-only, so a startup script cannot change tracked source files; lockfile drift fails startup. Review the worktree after a recreate to catch changes from other processes.

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
- [`start.sh`](../../../installer/docker/scripts/start.sh) selects dev Compose, ensures the selected external secrets volume exists, starts services, prints status, and attempts a browser open. Compose creates the selected memory and dependency volumes.
- [`stop.sh`](../../../installer/docker/scripts/stop.sh) stops services without removing containers or volumes.
- [`native-command.ps1`](../../../installer/docker/scripts/native-command.ps1) owns fail-closed native exit handling for the PowerShell install/start/stop paths; [`powershell-lifecycle.test.mjs`](../../../tools/docs/test/powershell-lifecycle.test.mjs) enforces the source contract in WSL.
- [`installer/docker/scripts/README.md`](../../../installer/docker/scripts/README.md) owns the per-script reference; the [Docker overview](../../../installer/docker/README.md) owns mode distinctions.
