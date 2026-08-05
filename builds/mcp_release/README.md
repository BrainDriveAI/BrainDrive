# First-party MCP services

This package provides the memory, auth, and project services used by the standard orchestrated native, Docker, and Tauri runtime when a tracked full MCP source is selected. It is an internal beta BrainDrive application component supported only through standard same-release orchestration and its trusted network boundary, not an SDK, plugin ABI, or cross-version public compatibility contract. Configured `tool_sources` determine which services participate; custom or external MCP remains experimental.

> **Status:** Internal beta under the resolved OPEN-02 maintainer decision. Start at the [MCP and tools integration boundary](../../docs/developers/integrations/mcp-and-tools.md), then verify exact behavior in source and tests.

> **Trust boundary:** These services do not independently authenticate callers. Missing or malformed request-context headers default to a local owner context. Standard orchestration keeps them on loopback or its internal network; do not expose them to an untrusted network.

## Server Kinds

1. `memory`:
   1. `memory_read`
   2. `memory_write`
   3. `memory_edit`
   4. `memory_delete`
   5. `memory_list`
   6. `memory_search`
   7. `memory_history`
   8. `memory_export`
2. `auth`:
   1. `auth_whoami`
   2. `auth_check`
   3. `auth_export`
3. `project`:
   1. `project_list`

## Local Development

### `npm run dev` command contract

```bash
npm run dev
```

- Working directory: `builds/mcp_release`.
- Risk tier: B.
- Prerequisites: installed lockfile dependencies; an explicit controlled `MEMORY_ROOT`; one selected `SERVER_KIND`; an available loopback port.
- Target: one local first-party MCP service and the explicit task-owned memory root.
- Side effects: prepares/initializes memory and Git state, writes the selected root, starts an HTTP service, and binds the configured host/port.
- Authority: developer controlling the process, port, and exact task-owned memory root.
- Expected result: the selected service starts on loopback and responds through its MCP endpoint.
- Cleanup: stop with Ctrl-C and remove only task-owned state.
- Recovery: stop the service, inspect sanitized errors/config, and never delete or reinitialize a pre-existing owner root as a retry.

Environment variables:

1. `SERVER_KIND` (`memory|auth|project`)
2. `HOST` (source default `127.0.0.1`; the standalone Compose file explicitly overrides it to `0.0.0.0`)
3. `PORT` (defaults by server kind)
4. `MEMORY_ROOT` (default `/data/memory`)

## Build And Test

```bash
npm run build
npm test
```

The package script `test:integration` currently references absent `test/integration/mcp-smoke.ts`; it is not passing evidence and should not be run/cited until reconciled. Current unit coverage is narrow and does not establish network/authentication/compatibility behavior.

## Docker Compose

The standalone Compose file publishes ports 8911–8913 on all host interfaces and shares a named memory volume. Use it only in a controlled trusted local environment; it is not a hardened deployment recipe.

### Standalone Compose command contract

```bash
docker compose -f docker-compose.yml up -d --build
```

- Working directory: `builds/mcp_release`.
- Risk tier: B.
- Prerequisites: Docker/Compose; free ports 8911–8913; a trusted local network; authority over the named Compose project/volume.
- Target: three local MCP containers, built image, Compose network, published host ports, and `mcp_release_memory` volume.
- Side effects: builds images, creates/starts containers/network/volume, initializes shared memory, and exposes unauthenticated MCP services on all host interfaces.
- Authority: developer controlling the Docker daemon, host ports, trusted network, and exact Compose project data.
- Expected result: memory, auth, and project MCP services start in the controlled environment.
- Cleanup: use the volume-preserving shutdown below.
- Recovery: inspect sanitized Compose status/logs, then stop without `-v`; do not expose or delete data as a retry.

Volume-preserving shutdown:

```bash
docker compose -f docker-compose.yml down
```

> **Destructive cleanup command contract:** `docker compose -f docker-compose.yml down -v` is Risk tier B. Prerequisites: confirm the exact Compose project and that `mcp_release_memory` is disposable or separately recoverable. Target/effect: stops/removes this package's containers/network and irreversibly deletes that named volume. Authority: owner of that exact disposable test state. Recovery: none from the command; restore only from a separately authorized backup.

## Source and tests

- Server/runtime: `src/index.ts`, `server-factory.ts`, `first-party-tools.ts`, and `request-context.ts`.
- Memory behavior: `src/memory-core.ts` and `src/git.ts`.
- Current package unit evidence: `test/unit/memory-core.test.ts`.
- Main runtime registration: `../typescript/tools.ts` and `../typescript/mcp/`.
