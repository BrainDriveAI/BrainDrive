# BrainDrive TypeScript runtime workspace

<!-- catalog-contract:start runtime-workspace-overview -->
> **Document contract**
> - Purpose: Provide the current source-adjacent entry to the gateway, engine, auth, memory, providers, web, desktop, and checks.
> - Audience: First-time contributors, Recurring contributors, Maintainers, AI coding agents.
> - Status: Current on `dev`; Milestone 1.
> - Owner role: runtime-maintainers.
> - Expected outcome: A contributor selects a workspace component and its focused verification command.
> - Prerequisites: Node.js and workspace dependencies; Root AGENTS.md.
> - Parent: [docs/developers/README.md](../../docs/developers/README.md).
> - Adjacent topics: [Repository map](../../docs/developers/repository-map.md); [Architecture overview](../../docs/developers/architecture/README.md); [BrainDrive web client](./client_web/README.md).
> - Keywords: `TypeScript runtime`, `gateway`, `engine`, `workspace`.
> - Sources: [`builds/typescript/README.md`](./README.md); [`builds/typescript/package.json`](./package.json); [`builds/typescript/gateway/server.ts`](./gateway/server.ts).
> - Tests: [`tools/docs/test/orientation.test.mjs`](../../tools/docs/test/orientation.test.mjs); [`builds/typescript/gateway/auth-routes.integration.test.ts`](./gateway/auth-routes.integration.test.ts); [`builds/typescript/engine/loop.test.ts`](./engine/loop.test.ts).
<!-- catalog-contract:end runtime-workspace-overview -->

This is the current source-adjacent entry for the main BrainDrive runtime. Use the [developer index](../../docs/developers/README.md) for persona and journey routing, the [native setup guide](../../docs/developers/setup/native.md) for the complete provider-independent startup contract, the [repository map](../../docs/developers/repository-map.md) for source/test locations, and the [architecture overview](../../docs/developers/architecture/README.md) for component relationships.

## Workspace boundaries

| Area | Start here | Representative verification |
|---|---|---|
| Gateway and API | [`gateway/server.ts`](gateway/server.ts), then the participating `gateway/` module | colocated gateway tests |
| Engine and tools | [`engine/loop.ts`](engine/loop.ts), [`engine/tool-executor.ts`](engine/tool-executor.ts), [`tools.ts`](tools.ts) | `engine/*.test.ts` and tool tests |
| Auth and config | [`auth/middleware.ts`](auth/middleware.ts), [`config.ts`](config.ts) | auth and config tests |
| File-backed memory and secrets | [`memory/init.ts`](memory/init.ts), [`memory-tools/file-ops/server.ts`](memory-tools/file-ops/server.ts), [`secrets/resolver.ts`](secrets/resolver.ts) | colocated memory, file-operation, and resolver tests |
| Providers and MCP | [`adapters/index.ts`](adapters/index.ts), [`mcp/registry.ts`](mcp/registry.ts) | adapter tests and MCP release-package unit tests; focused main-workspace MCP registry/config coverage is not currently declared |
| Web client | [`client_web/README.md`](client_web/README.md) | web typecheck, lint, tests, and build |
| Tauri desktop | [`client_web/src/api/runtime-api-base.ts`](client_web/src/api/runtime-api-base.ts), [`src-tauri/src/main.rs`](src-tauri/src/main.rs); optional remote-browser proxy in [`desktop/bridge.ts`](desktop/bridge.ts) | desktop preflight, bridge tests, and Cargo tests |

The shipped provider choices include BrainDrive Models, BYOK OpenRouter, and Ollama. Do not place BrainDrive-owned provider keys in client config, require BrainDrive Models credits for Ollama or owner-supplied OpenRouter credentials, or remove those independent choices while changing provider behavior.

## Common commands

Run these from this directory after installing dependencies:

```bash
npm run dev
npm run dev:server
npm run build
npm run lint
npm run test
```

Web checks are composed through the main package:

```bash
npm run web:typecheck
npm run web:lint
npm run web:test
npm run web:build
```

Desktop preflight is `npm run desktop:preflight`; the [Tauri subsystem README](src-tauri/README.md) and [Tauri setup guide](../../docs/developers/setup/tauri-desktop.md) own the desktop boundary and journey. Documentation verification is `npm run docs:verify`. Select broader checks from the [change verification matrix](../../docs/developers/verification.md), and use [safe debugging](../../docs/developers/debugging.md) before collecting failure evidence.

For Docker dev hot reload, follow the [Docker development guide](../../docs/developers/setup/docker-development.md). The [Docker installer README](../../installer/docker/README.md) owns dev/local/prod mode distinctions and operator context; the [scripts reference](../../installer/docker/scripts/README.md) owns per-script arguments and effects. This page does not replace mode-specific prerequisites or operator safeguards.
