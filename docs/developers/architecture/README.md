# Architecture overview

<!-- catalog-contract:start architecture-overview -->
> **Document contract**
> - Purpose: Explain component responsibilities and high-level relationships without claiming one universal request path.
> - Audience: First-time contributors, Recurring contributors, Integrators, Maintainers, AI coding agents, Verification agents and human reviewers.
> - Status: Current on `dev`; Milestone 1.
> - Owner role: runtime-maintainers.
> - Expected outcome: The reader identifies participating components and follows source or tests for exact behavior.
> - Prerequisites: Repository map; Terminology.
> - Parent: [docs/developers/README.md](../README.md).
> - Adjacent topics: [Repository map](../repository-map.md); [TypeScript runtime workspace](../../../builds/typescript/README.md); [BrainDrive web client](../../../builds/typescript/client_web/README.md); [MCP release servers](../../../builds/mcp_release/README.md).
> - Keywords: `architecture`, `gateway`, `engine`, `component boundary`.
> - Sources: [`builds/typescript/gateway/server.ts`](../../../builds/typescript/gateway/server.ts); [`builds/typescript/engine/loop.ts`](../../../builds/typescript/engine/loop.ts); [`builds/typescript/tools.ts`](../../../builds/typescript/tools.ts); [`builds/typescript/config.ts`](../../../builds/typescript/config.ts).
> - Tests: [`tools/docs/test/orientation.test.mjs`](../../../tools/docs/test/orientation.test.mjs); [`builds/typescript/gateway/auth-routes.integration.test.ts`](../../../builds/typescript/gateway/auth-routes.integration.test.ts); [`builds/typescript/engine/loop.test.ts`](../../../builds/typescript/engine/loop.test.ts).
<!-- catalog-contract:end architecture-overview -->

BrainDrive is a user-owned AI system with multiple clients and deployment modes. There is no single universal request path: authentication, provider/model operations, files, backups, projects, and chat involve different routes. This page describes stable repository responsibilities and high-level relationships; linked source and tests define exact behavior.

## Relationship overview

1. The web client or Tauri desktop shell calls the gateway/API.
2. The gateway loads runtime config, auth, memory, secrets references, providers, and tools needed by a route.
3. Chat routes invoke the engine, which streams model output and executes permission-allowed built-in or MCP tool calls. Approval behavior depends on preferences and client behavior; the current web client immediately approves approval requests rather than showing a human confirmation step.
4. Memory tools operate on file-backed memory. Secret material is handled through the separate secrets boundary.
5. Docker dev, Docker local, and Docker prod package these components differently without making their data and trust boundaries interchangeable.

## Web client

The React/Vite web client owns presentation, browser-side state, and typed gateway API adapters. Browser development uses a relative `/api` route through Vite; Tauri desktop resolves its native runtime connection. Start with the [web client README](../../../builds/typescript/client_web/README.md), [`runtime-api-base.ts`](../../../builds/typescript/client_web/src/api/runtime-api-base.ts), and [`useGatewayChat.ts`](../../../builds/typescript/client_web/src/api/useGatewayChat.ts). Representative coverage includes [`gateway-adapter.test.ts`](../../../builds/typescript/client_web/src/api/gateway-adapter.test.ts) and [`useGatewayChat.test.tsx`](../../../builds/typescript/client_web/src/api/useGatewayChat.test.tsx).

## Gateway and API

[`gateway/server.ts`](../../../builds/typescript/gateway/server.ts) is the main HTTP composition point. It wires configuration, authentication and authorization, projects, conversations, memory, backup/support behavior, provider activation, chat streaming, approvals, and the engine. Individual gateway modules and tests provide narrower evidence; [`auth-routes.integration.test.ts`](../../../builds/typescript/gateway/auth-routes.integration.test.ts) is one integration boundary.

## Engine and tools

[`engine/loop.ts`](../../../builds/typescript/engine/loop.ts) coordinates model turns, streamed output, and tool calls. [`engine/stream.ts`](../../../builds/typescript/engine/stream.ts) and [`engine/tool-executor.ts`](../../../builds/typescript/engine/tool-executor.ts) own narrower mechanics. [`tools.ts`](../../../builds/typescript/tools.ts) assembles built-in tools and MCP-backed capabilities. Follow [`engine/loop.test.ts`](../../../builds/typescript/engine/loop.test.ts) for executable examples.

## Authentication and configuration

[`config.ts`](../../../builds/typescript/config.ts) resolves runtime configuration including auth mode, install mode, adapter profiles, and persisted preferences. [`gateway/server.ts`](../../../builds/typescript/gateway/server.ts) reads `BD_DEPLOYMENT_MODE` for local/managed deployment classification. [`auth/middleware.ts`](../../../builds/typescript/auth/middleware.ts) authenticates requests and constructs request contexts; gateway routes and adjacent auth modules own signup bootstrap, accounts, and sessions. The protected `auth_mode=managed` header path has a source inconsistency and no focused passing test; it is not documented as an evidenced working contract. A deployment mode is not an authorization bypass.

## Memory and secrets

[`memory/init.ts`](../../../builds/typescript/memory/init.ts) participates in initializing file-backed memory; adjacent memory modules handle export/migration, remote backup/restore, history, and starter-pack behavior. [`memory-tools/file-ops/server.ts`](../../../builds/typescript/memory-tools/file-ops/server.ts) exposes file operations to the tool runtime. [`secrets/resolver.ts`](../../../builds/typescript/secrets/resolver.ts) separately resolves protected material. Remote Git memory backup excludes the external vault/master key, while the current gateway export is a secret-bearing migration archive. See the detailed [memory and secrets lifecycle](memory-and-secrets.md). Representative tests are [`memory/init.test.ts`](../../../builds/typescript/memory/init.test.ts), [`memory-tools/file-ops/server.test.ts`](../../../builds/typescript/memory-tools/file-ops/server.test.ts), and [`secrets/resolver.test.ts`](../../../builds/typescript/secrets/resolver.test.ts).

## Providers and MCP

[`adapters/index.ts`](../../../builds/typescript/adapters/index.ts) and [`adapters/openai-compatible.json`](../../../builds/typescript/adapters/openai-compatible.json) define model adapter profiles including BrainDrive Models, BYOK OpenRouter, and Ollama. BrainDrive Models credits must not become a requirement for Ollama or owner-supplied OpenRouter credentials, and BrainDrive-owned provider keys must not enter client config.

[`mcp/config.ts`](../../../builds/typescript/mcp/config.ts) and [`mcp/registry.ts`](../../../builds/typescript/mcp/registry.ts) resolve and register MCP servers used by tools. [`builds/mcp_release/README.md`](../../../builds/mcp_release/README.md) describes the first-party release package. [`adapters/index.test.ts`](../../../builds/typescript/adapters/index.test.ts) covers adapter selection. [`mcp_release/test/unit/memory-core.test.ts`](../../../builds/mcp_release/test/unit/memory-core.test.ts) narrowly covers project listing, fallback, and canonicalization—not the complete memory core or network integration. A focused main-workspace MCP registry/config test is not currently declared. Discoverability here is not a public compatibility or maturity promise; OPEN-02 remains unresolved.

## Docker and installer

[`installer/docker/README.md`](../../../installer/docker/README.md) is the operational mode overview. Docker dev mounts source and runs Vite hot reload; Docker local uses published images on a local bind; Docker prod composes app and edge services with production safeguards. [`entrypoint.sh`](../../../installer/docker/entrypoint.sh) coordinates container startup, while lifecycle contracts live in the [scripts reference](../../../installer/docker/scripts/README.md). Representative checks include [`install-prod-bootstrap.sh`](../../../installer/docker/scripts/test/install-prod-bootstrap.sh) and [`bootstrap-integrity.sh`](../../../installer/bootstrap/test/bootstrap-integrity.sh).

## Tauri desktop

[`client_web/src/api/runtime-api-base.ts`](../../../builds/typescript/client_web/src/api/runtime-api-base.ts) invokes the native runtime-status command provided by [`src-tauri/src/main.rs`](../../../builds/typescript/src-tauri/src/main.rs), which owns native application startup and local runtime integration. [`desktop/bridge.ts`](../../../builds/typescript/desktop/bridge.ts) is a narrower optional proxy for LAN or tailnet browser access, not the core in-window Tauri transport. Use desktop preflight, [`desktop/bridge.test.ts`](../../../builds/typescript/desktop/bridge.test.ts), and relevant Cargo tests embedded in `main.rs` for exact platform behavior.

## Tests, CI, security, and release

The [repository map](../repository-map.md#tests-and-ci) routes each component to focused tests and CI. Security reporting and sanitized evidence follow [`SECURITY.md`](../../../SECURITY.md) and [repository scanning guidance](../../repository-security.md). Release history is in [`CHANGELOG.md`](../../../CHANGELOG.md); installer trust is source-adjacent until the Milestone 5 release journey is complete.
