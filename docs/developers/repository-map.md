# Repository map

<!-- catalog-contract:start repository-map -->
> **Document contract**
> - Purpose: Map change types and components to source, tests, and verification entry points.
> - Audience: First-time contributors, Recurring contributors, Maintainers, AI coding agents, Verification agents and human reviewers.
> - Status: Current on `dev`; Milestone 1.
> - Owner role: documentation-maintainers.
> - Expected outcome: The reader locates the smallest relevant source and test boundary.
> - Prerequisites: Repository access; Root AGENTS.md.
> - Parent: [docs/developers/README.md](./README.md).
> - Adjacent topics: [Architecture overview](./architecture/README.md); [TypeScript runtime workspace](../../builds/typescript/README.md); [Developer terminology and status vocabulary](./terminology.md).
> - Keywords: `repository map`, `source`, `tests`, `CI`.
> - Sources: [`AGENTS.md`](../../AGENTS.md); [`builds/typescript/package.json`](../../builds/typescript/package.json); [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
> - Tests: [`tools/docs/test/orientation.test.mjs`](../../tools/docs/test/orientation.test.mjs); [`tools/docs/test/links.test.mjs`](../../tools/docs/test/links.test.mjs).
<!-- catalog-contract:end repository-map -->

The primary development branch is `dev`. Read the root [`AGENTS.md`](../../AGENTS.md) and any closer scoped instructions before editing. The map below points to source and representative tests; it does not replace them.

## Top-level map

| Path | Role |
|---|---|
| [`builds/typescript/`](../../builds/typescript/README.md) | Main TypeScript gateway, engine, auth, memory, provider, web, and desktop workspaces |
| [`builds/mcp_release/`](../../builds/mcp_release/README.md) | First-party MCP release package; internal beta for same-release orchestration under resolved OPEN-02, not a public SDK |
| [`installer/`](../../installer/docker/README.md) | Bootstrap, Docker packaging, lifecycle, update, backup, and release assets |
| [`docs/`](../AGENTS.md) | User, operator, security, and canonical developer documentation |
| [`.github/`](../../.github/workflows/ci.yml) | Issue/PR collaboration surfaces and CI workflow |
| [`tools/docs/`](../../tools/docs/README.md) | Documentation schemas, validator, projections, fixtures, and evidence harness |

## Change-type map

| Change | Start in source | Closest tests or checks |
|---|---|---|
| Gateway/API route | [`gateway/server.ts`](../../builds/typescript/gateway/server.ts) and the participating gateway module | Colocated `gateway/*.test.ts`, especially [`auth-routes.integration.test.ts`](../../builds/typescript/gateway/auth-routes.integration.test.ts) |
| Engine/tool-call behavior | [`engine/loop.ts`](../../builds/typescript/engine/loop.ts), [`stream.ts`](../../builds/typescript/engine/stream.ts), [`tool-executor.ts`](../../builds/typescript/engine/tool-executor.ts) | [`engine/loop.test.ts`](../../builds/typescript/engine/loop.test.ts) and other `engine/*.test.ts` |
| Auth/account behavior | [`auth/middleware.ts`](../../builds/typescript/auth/middleware.ts) and relevant gateway routes | [`auth/signup-bootstrap.test.ts`](../../builds/typescript/auth/signup-bootstrap.test.ts), auth gateway integration tests |
| Runtime modes/provider config | [`config.ts`](../../builds/typescript/config.ts), [`adapters/index.ts`](../../builds/typescript/adapters/index.ts), provider profiles | [`config.test.ts`](../../builds/typescript/config.test.ts), adapter tests |
| Memory/files/history | [`memory/init.ts`](../../builds/typescript/memory/init.ts), [`memory-tools/file-ops/server.ts`](../../builds/typescript/memory-tools/file-ops/server.ts) | [`memory/init.test.ts`](../../builds/typescript/memory/init.test.ts), [`memory-tools/file-ops/server.test.ts`](../../builds/typescript/memory-tools/file-ops/server.test.ts) |
| Secrets/vault | [`secrets/resolver.ts`](../../builds/typescript/secrets/resolver.ts) | [`secrets/resolver.test.ts`](../../builds/typescript/secrets/resolver.test.ts) and provider-safety checks |
| Web UI/API adapter | [`client_web/src/App.tsx`](../../builds/typescript/client_web/src/App.tsx) | colocated Vitest files, [`App.test.tsx`](../../builds/typescript/client_web/src/App.test.tsx), and Playwright when relevant |
| Provider adapters and MCP | [`adapters/index.ts`](../../builds/typescript/adapters/index.ts), [`mcp/registry.ts`](../../builds/typescript/mcp/registry.ts), [`tools.ts`](../../builds/typescript/tools.ts), [`builds/mcp_release/README.md`](../../builds/mcp_release/README.md) | [`adapters/index.test.ts`](../../builds/typescript/adapters/index.test.ts), [`mcp_release/test/unit/memory-core.test.ts`](../../builds/mcp_release/test/unit/memory-core.test.ts); no focused main-workspace MCP registry/config test is currently declared |
| Tauri desktop | [`client_web/src/api/runtime-api-base.ts`](../../builds/typescript/client_web/src/api/runtime-api-base.ts), [`src-tauri/src/main.rs`](../../builds/typescript/src-tauri/src/main.rs); optional remote-browser proxy in [`desktop/bridge.ts`](../../builds/typescript/desktop/bridge.ts) | [`desktop/bridge.test.ts`](../../builds/typescript/desktop/bridge.test.ts), desktop preflight, and Rust tests embedded in `main.rs` |
| Docker/installer | [`installer/docker/README.md`](../../installer/docker/README.md) and [`scripts/README.md`](../../installer/docker/scripts/README.md) | [`install-prod-bootstrap.sh`](../../installer/docker/scripts/test/install-prod-bootstrap.sh), [`bootstrap-integrity.sh`](../../installer/bootstrap/test/bootstrap-integrity.sh), and targeted smoke checks |
| Documentation authority | [`catalog.json`](catalog.json), canonical page, source mapping | `npm run docs:verify` plus projection and secret-scan checks |

## Tests and CI

The main package scripts in [`builds/typescript/package.json`](../../builds/typescript/package.json) compose runtime, web, desktop, and documentation checks. The web and MCP workspaces retain their own scripts. [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) is the current CI job composition; a local command is evidence only for the environment in which it ran.

For documentation changes, run from `builds/typescript`:

```bash
npm run docs:test
npm run docs:check
npm run docs:verify
```

From the repository root, check projections with `node tools/docs/sync-generated.mjs --check`. Follow [repository security](../repository-security.md) for the current secret scan; do not inspect ignored owner data.

## Security and release

- Private vulnerability reporting: [`SECURITY.md`](../../SECURITY.md)
- Safe repository scanning: [`docs/repository-security.md`](../repository-security.md)
- Public version history: [`CHANGELOG.md`](../../CHANGELOG.md)
- Docker modes and operator behavior: [`installer/docker/README.md`](../../installer/docker/README.md)
- Pinned bootstrap trust: [`installer/bootstrap/README.md`](../../installer/bootstrap/README.md)

## Excluded boundaries

Do not treat vendored dependencies, generated outputs, backups, local credential files, ignored owner memory, or `docs/Security/` private planning material as public documentation authority. The documentation validator enumerates tracked and non-ignored candidates and fails closed on unsafe paths.

For responsibilities and relationships, continue to the [architecture overview](architecture/README.md).
