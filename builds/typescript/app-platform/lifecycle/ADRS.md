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

## ADR-RB-014 — Corrective Spec 04 M2 durable-state boundary

**Decision:** Close the accepted Spec 04 Milestone 2 persistence gate with a dormant kernel in this existing directory: one M1-table-driven state machine, checksummed version-1 store envelopes, opaque active/LKG and package-reference records, an exclusive per-app lease, canonical operation replay, and journal-only restart reconciliation. Do not wire this kernel to the pre-existing later-milestone bootstrap/service path in this change. Missing state is deterministic generation-0 `not_installed`; unsupported or corrupt evidence is preserved and fails closed. A restart before the state envelope commits restores prior pointers and records `rolled_back`; a restart after the state envelope commits finishes the proposed refs/pointers and records `committed`.

**Reason:** The advanced feature branch already contains an older runtime-coupled store and supervisor behavior, but it lacks cross-process serialization and complete crash-boundary proof. A source-adjacent dormant kernel satisfies M2 without duplicating the repository area, broadening gateway/runtime authority, or pretending the advanced branch is a standalone execution-disabled milestone branch. Later integration must explicitly choose and migrate one store authority; this M2 change does not silently replace an active runtime store.

## ADR-RB-027 — Corrective Spec 04 M3 verified-install boundary

**Decision:** Add a dormant verified-install kernel beside M2. Use the frozen M1 Ed25519/source/revocation/archive/grant/supervisor contracts, accept only the signed Docker fixture or credential-free BrainDrive release origin through bounded transports, extract only after complete trust verification with `0400` files, promote by same-filesystem rename to immutable SHA-256 content, and publish an active M2 pointer only after fake start/readiness/registration and exact grant persistence. Use the M1 supervisor `cleanup` operation as unregister/orphan cleanup during compensation. Preserve the pre-existing process supervisor and gateway service as a separate committed branch baseline; do not import or activate them.

**Reason:** M3 must prove package trust, storage, authorization, and transaction ordering without claiming Spec 05 production supervision. A public-key-only frozen fixture gives reproducible evidence without retaining a signing secret. Keeping M3 on injected contracts makes the production adapter choice and migration from the older branch service explicit later work.

## ADR-RB-028 — Spec 04 M4 reuses the accepted Spec 05 supervisor

**Decision:** Adapt the M1 version-1 `InstalledAppSupervisor` contract to the existing Spec 05 `ProcessAppSupervisor`; do not add a second process owner or mutate fixed MCP configuration. The shared environment binding rejects Docker descriptors that are not `container`/`container_internal` and packaged-Windows descriptors that are not `packaged_node`/`loopback`. A ready, authenticated health result and one matching in-memory dynamic registration are required before the M2 active pointer commits. Durable reconciliation authority contains only matching app/install/version/digest/grant/runtime/registration/connection identities.

Disable prepares durable intent, revokes operation authority, stops and unregisters by exact runtime identity, confirms cleanup, removes durable runtime authority, and only then commits `disabled`. Re-enable fully repeats source/signature/archive/compatibility/revocation verification, re-hashes immutable stored package bytes, validates the exact unexpired grant, and repeats start/readiness/registration before committing `active`. A failed or ambiguous attempt is contained to no runtime and stays non-active.

**Reason:** M4 must connect M2/M3 lifecycle authority to the already accepted supervisor without broadening static service discovery or introducing M5 update/rollback/revocation-feed behavior. Exact-identity containment prevents a stale identifier from stopping or untracking a newer runtime generation, while the separate opaque authority record gives restart reconciliation enough evidence without persisting endpoints, credentials, command lines, environment, or paths.

## ADR-RB-029 — M5 uses one non-authoritative candidate runtime slot

**Decision:** Extend the accepted supervisor start request with an optional `candidate` role. Permit at most one active and one candidate process for the same installation during a journaled M5 mutation, while keeping dynamic registration and capability-token authority on the active runtime only. Candidate promotion is legal only after exact revocation/stop of the old runtime. Persist update intent and opaque data hashes in a separate bounded journal, then use M2 generation transitions for `updating`/`rollback_pending` and the final active/LKG/checkpoint switch.

**Reason:** Readiness must be established beside the still-serving version, but two authoritative registrations or writers are prohibited. A distinct candidate slot resolves that ordering without weakening M4's steady-state one-runtime invariant or adding a second supervisor.

## ADR-RB-030 — Verified monotonic revocations remain authoritative offline

**Decision:** Refresh revocations independently through the existing verified-feed cache only after pinned-root/release-key signature and monotonic-chain validation. Never replace the last valid cache with an invalid, older, equivocated, or fetch-failed candidate. Preserve explicit matches across stale/offline operation and immediately quarantine a matching live package under the lifecycle lease. Allow stale verified-local execution only for a non-match and never for a new update switch.

**Reason:** Network availability cannot erase a known denial or fabricate one. Separating external freshness from cached explicit-match authority provides deterministic fail-closed behavior while retaining the accepted bounded offline use of previously verified local bytes.
