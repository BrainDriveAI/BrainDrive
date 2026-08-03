# Native TypeScript and web development

<!-- catalog-contract:start native-development-setup -->
> **Document contract**
> - Purpose: Start the source-native TypeScript gateway, MCP services, and Vite web client without making a model provider part of basic success.
> - Audience: First-time contributors, Recurring contributors, Maintainers, AI coding agents, Verification agents and human reviewers.
> - Status: Current on `dev`; Milestone 2.
> - Owner role: runtime-maintainers.
> - Expected outcome: The provider-independent gateway health check and web shell are observable from a controlled native development run.
> - Prerequisites: Node.js 22 and npm; Installed dependencies in all three TypeScript workspaces; Available development ports.
> - Parent: [docs/developers/README.md](../README.md).
> - Adjacent topics: [Docker development with hot reload](./docker-development.md); [Tauri desktop development](./tauri-desktop.md); [Change verification](../verification.md); [Safe debugging and failure evidence](../debugging.md).
> - Keywords: `native development`, `TypeScript`, `Vite`, `provider-independent startup`.
> - Sources: [`builds/typescript/scripts/dev-runtime.mjs`](../../../builds/typescript/scripts/dev-runtime.mjs); [`builds/typescript/client_web/vite.config.ts`](../../../builds/typescript/client_web/vite.config.ts); [`builds/typescript/gateway/server.ts`](../../../builds/typescript/gateway/server.ts); [`builds/typescript/secrets/paths.ts`](../../../builds/typescript/secrets/paths.ts).
> - Tests: [`tools/docs/test/developer-journeys.test.mjs`](../../../tools/docs/test/developer-journeys.test.mjs); [`builds/typescript/gateway/auth-routes.integration.test.ts`](../../../builds/typescript/gateway/auth-routes.integration.test.ts).
<!-- catalog-contract:end native-development-setup -->

Use this path when changing the gateway, engine, auth, memory, providers, MCP registration, or browser client directly on the host. It starts three first-party MCP services, waits for their health checks, starts the gateway, waits for `/health`, and then starts Vite.

## Prerequisites

- Node.js 22 and npm. Node 22 is the repository CI baseline.
- Git checkout on `dev` and the applicable [`AGENTS.md`](../../../AGENTS.md) instructions.
- Network access if `npm ci` must download dependencies.
- The gateway, web, and three MCP development ports must be free. A conflict is a bounded prerequisite failure; do not kill an unidentified process.

Install exact lockfile dependencies from the repository root. `npm ci` removes and recreates each ignored `node_modules/` tree, so preserve no manual changes there.

```bash
npm --prefix builds/typescript ci
npm --prefix builds/mcp_release ci
npm --prefix builds/typescript/client_web ci
```

## Command contract

| Field | Contract |
|---|---|
| Working directory | `builds/typescript/` |
| Command | `npm run dev` |
| Platform | Current controlled evidence is WSL/Linux. The Node supervisor is source-portable, but macOS and Windows are not evidenced by this milestone |
| Mode | Native source development; gateway install mode follows current runtime config unless explicitly overridden |
| Credential need | None for startup, health, configuration loading, local account UI, or the web shell |
| Side effects | Starts five child processes; binds the documented development ports; initializes or updates the selected file-backed memory root and runtime diagnostics; Vite watches source |
| Expected result | MCP health checks pass, the gateway reports ready, Vite starts, and the web shell is reachable |
| Failure classification | Prerequisite, dependency, port conflict, MCP startup, gateway startup, web startup, or later provider integration |
| Cleanup | Press `Ctrl-C`; the supervisor terminates its child processes. Remove only a task-specific temporary data root that you created |
| Risk tier | Tier B — controlled local execution |

Start from the required working directory:

```bash
cd builds/typescript
npm run dev
```

Do not treat the printed “web server starting” line alone as success. Observe the earlier gateway-ready line and confirm that the web shell responds. See [safe debugging](../debugging.md) before collecting logs.

## Provider-independent baseline

Basic success is limited to service health, configuration loading, the local authentication/onboarding surface, and the web shell. It does not include sending a chat message or receiving a model response. No BrainDrive Models credit, owner-supplied OpenRouter credential, or running Ollama model is required for this baseline.

For controlled evidence, set `PAA_MEMORY_ROOT` and `PAA_SECRETS_HOME` to two validated task-specific temporary directories before invoking `npm run dev`. Set them only for that process, confirm no provider credential is supplied to it, and delete only those exact task-owned locations after shutdown. `PAA_MEMORY_ROOT` is forwarded by the native supervisor; `PAA_SECRETS_HOME` is resolved by the secrets path layer. Do not inspect an existing owner secrets file to prove absence.

## Provider validation is separate

A model response is a separate Tier C integration check because it may require an authorized provider account, owner credential, network access, or local model. Use the provider-specific integration guidance only with explicit authority. Startup failure and provider-response failure are different classes.

## Failure classification

- `command not found` or unsupported Node version: prerequisite failure.
- `npm ci` failure: dependency, registry, proxy, or lockfile failure.
- Address already in use: port conflict. Identify the listener; choose a supported override where one exists or stop only a process you own.
- MCP health timeout before the gateway starts: MCP startup failure.
- Gateway health timeout: gateway/config/runtime-data failure.
- Vite exits after the gateway is ready: web startup failure, commonly its fixed dev port.
- Chat/provider error after the shell loads: provider integration failure, not basic startup failure.

## Cleanup and recovery

Use `Ctrl-C` once and wait for the supervisor to exit. Verify the development listeners are gone before retrying. If you used task-specific data directories, remove those explicit directories only after validating their paths. Never delete the repository memory fixture, owner memory, or secrets as generic cleanup.

## Source evidence

- [`dev-runtime.mjs`](../../../builds/typescript/scripts/dev-runtime.mjs) defines process order, health checks, ports, environment forwarding, and signal cleanup.
- [`vite.config.ts`](../../../builds/typescript/client_web/vite.config.ts) fixes the web port and defines the default gateway proxy target.
- [`gateway/server.ts`](../../../builds/typescript/gateway/server.ts) defines the health route and final listen behavior.
- [`config.ts`](../../../builds/typescript/config.ts) defines runtime mode, memory-root, bind-address, and gateway-port overrides.
- [`secrets/paths.ts`](../../../builds/typescript/secrets/paths.ts) defines the secrets-home override.
