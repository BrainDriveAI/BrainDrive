# Milestone 2 implementation decisions

These records apply the project-owner approvals dated 2026-08-07 in Resume Builder Specs 1–5, the accepted verification plan, and the M1 contract ADRs. The source spec remains behavioral authority.

## ADR-RB-008 — Reuse `app-platform` and isolate host state

**Decision:** Land runtime code at `builds/typescript/app-platform/lifecycle`, matching the M1 repository-consistent mapping instead of creating parallel `app-lifecycle` or `resume-domain` abstractions. Persist Docker host state in the dedicated `braindrive_dev_app_platform` volume at `/data/app-platform`. Keep the retained owner-data namespace logically separate below the configured memory root.

**Reason:** The live repository has no app registry precedent, while M1 already established `app-platform` as the narrow shared boundary. Separate storage lets lifecycle uninstall and reconciliation remove authority without traversing owner content.

## ADR-RB-009 — Docker adapter is an authenticated child inside the app container

**Decision:** For Docker development, supervise the verified compiled-JS fixture as one child process inside BrainDrive's app container. It binds `127.0.0.1` within that container and is represented by the M1 `container`/`container_internal` supervisor contract. It receives no arguments and only the five accepted environment values. The endpoint is never published by Compose.

**Reason:** The app container has the already accepted packaged Node runtime and no Docker socket. A child process provides real failure, readiness, signal, orphan, and restart behavior without granting the gateway host-level container authority. Desktop remains a separate later adapter.

## ADR-RB-010 — Repository fixture authority and update source

**Decision:** On first Docker-state initialization, generate an ephemeral Ed25519 root/release authority in process memory, sign versions 1.0.0 and 2.0.0 plus the source index and revocation list, persist only public trust artifacts and signed packages, then discard the private keys. Version 2.0.0 adds `app.inference.request`, making capability widening executable in tests. Milestone 3 adds the independently signed version-3 modern conformance fixture without rewriting this authority, as recorded by ADR-RB-017. No install occurs automatically.

**Reason:** This satisfies the accepted repository-controlled Docker fixture source while ensuring no test private key is checked in, baked into an image, returned by an API, or written to runtime state.

## ADR-RB-011 — Preserve the fixed MCP registry

**Decision:** M2 runtime registration remains private to the lifecycle supervisor. Do not append installed apps to `mcp/servers*.json`, `mcp/config.ts`, `mcp/registry.ts`, or `tools.ts`.

**Reason:** Those paths implement legacy fixed tool discovery. Modern authenticated MCP connection and Apps resources are Milestone 3 scope; treating static config as dynamic registration would create duplicate abstractions and weaken the accepted boundary.

## ADR-RB-012 — Version-1 registry initialization, no legacy migration

**Decision:** Initialize a missing registry directly as version 1. Validate every durable authority record with its M1 strict Zod schema and fail startup on invalid/unknown versions. Do not import owner memory, fixed MCP configuration, or whole-product backup data into the lifecycle registry.

**Reason:** Repository investigation confirmed no prior installed-app state exists. A fabricated migration would add risk without a source format. Later versions must add an explicit migration before writes.

## ADR-RB-013 — Feature enablement boundary

**Decision:** Enable M2 only in Docker `compose.dev.yml` through `BRAINDRIVE_APP_PLATFORM_ENABLED=true`. Native/local/prod and desktop remain unchanged until their accepted milestone gates. Even when enabled, activation requires an authenticated owner install mutation and successful package/readiness verification.

**Reason:** Docker dev is the accepted first ground truth. This avoids silently enabling unfinished product/UI/desktop behavior or changing production configuration.
