# Trusted app lifecycle and runtime supervisor

The Spec 05 Milestone 6 dynamic Docker/desktop supervisor, M2 negotiation gate, bounded recovery, exact process-group cleanup, and redacted evidence are documented in `SPEC-05-M6-SUPERVISOR.md`.

The corrective Spec 04 Milestone 6 owner lifecycle boundary is documented in `M6-OWNER-LIFECYCLE.md`. It exposes the M1–M5 lifecycle decisions through owner-bound DTOs and an accessible direct Apps surface, and adds journaled selective uninstall/fresh reinstall. The M5 transactional update kernel remains documented in `M5-TRANSACTIONAL-UPDATE.md`.

The corrective Spec 04 Milestone 4 supervised-activation kernel is documented in `M4-SUPERVISED-ACTIVATION.md`. It adapts the accepted version-1 `InstalledAppSupervisor` contract to the existing `ProcessAppSupervisor`, adds target-checked Docker and packaged-Windows bindings, persists only opaque reconciliation authority, and implements install/disable/re-enable ordering over the M2/M3 stores. It does not add a gateway route or alter fixed MCP discovery.

The dormant Spec 04 Milestone 3 verified-install kernel is documented in `M3-VERIFIED-INSTALL.md`. Its signed source resolver, strict non-executing verifier, immutable package store, exact grant store, and atomic installer use the M1 supervisor interface with a fake only; they add no gateway, real process, MCP registry, or owner-data wiring.

The dormant Spec 04 Milestone 2 persistence kernel is documented in `M2-DURABLE-STATE.md`. Its `LifecycleStateMachine`, versioned `LifecycleStore`, lease, journal, reconciler, and allowlisted diagnostics have no package-verification, process, gateway, MCP, capability, or owner-memory adapter. The runtime/service material described below is pre-existing later-milestone branch capability and is not imported by that kernel.

This directory is the Milestone 2 runtime boundary for the accepted Resume Builder specifications. It can install and supervise only the signed repository fixture for `ai.braindrive.resume-builder`; it is not a marketplace, a general plugin SDK, or the Resume Builder workflow.

The gateway enables this boundary only when `BRAINDRIVE_APP_PLATFORM_ENABLED=true`. Docker development selects `docker_linux_x64` and persists host-owned installation state at `BRAINDRIVE_APP_STATE_ROOT=/data/app-platform`. Packaged Windows selects `desktop_windows_x64` and uses its Tauri platform data root. Owner career data remains in the separate logical namespace below the configured memory root. Lifecycle policy reaches it only through the narrow `OwnerDataLifecycle` validation/cleanup interface: default uninstall removes abandoned transient stages but retains every durable owner record.

## Runtime boundaries

- `fixture-repository.ts` generates the legacy version-1/version-2 stored-ZIP fixtures and the independently signed modern MCP Apps fixture, currently Resume Builder `3.2.2`. This patch fixture adds submitted owner-visible interview-turn provenance while retaining the same capability set and lifecycle contract. Each source uses an ephemeral Ed25519 test authority on first initialization. Only public trust metadata, signed descriptors/index/revocations, archives, SBOM, and provenance are written. No private signing material is stored or logged.
- `package-verifier.ts` validates the trust root and release-key authorization, source index, descriptor signature, archive digest/length, canonical manifest, complete file inventory, host compatibility, and signed revocation state before extraction. Explicit revocation fails closed.
- `store.ts` persists the version-1 lifecycle record, version-1 operation journal, grants, verified package metadata, and idempotent results with file/directory sync plus atomic rename. Lifecycle updates require an exact generation compare-and-swap.
- `capability-token.ts` issues random, short-lived, audience/install/package/grant/operation-bound one-use tokens. Only token hashes are retained in process memory; disable, update, uninstall, quarantine, crash recovery, and shutdown rotate or revoke authority.
- `process-supervisor.ts` is the bounded process adapter shared by Docker and packaged Windows. It launches one verified Node entrypoint per active installation, provides only the five allowlisted environment values, authenticates health/MCP access, caps captured output accounting, uses bounded readiness/stop time, and exhausts after three crash restarts with 1/2/4-second policy defaults. Docker reports container-internal transport; Windows reports random authenticated loopback transport.
- `service.ts` implements install, disable, enable, update, rollback, uninstall/reinstall, cancellation, quarantine, last-known-good retention, and restart reconciliation. It validates retained-data compatibility before package activation/restart and invokes bounded transient cleanup after runtime authority is revoked. The active registry pointer changes only after readiness succeeds.
- `owner-data.ts` is the narrow host-owned compatibility/cleanup interface. The Resume Builder adapter is implemented in `resume-domain/lifecycle.ts`; lifecycle code does not gain generic memory traversal or deletion authority.
- `errors.ts` freezes the lifecycle operation error-code vocabulary as an executable Zod enum; unknown codes fail contract validation.
- `routes.ts` exposes owner-administration APIs below `/apps/resume-builder`. DTOs omit host paths, connection tokens (except the explicit owner session response), raw package metadata, credentials, and content.

The existing static MCP configuration and tool registry remain unchanged. The authenticated modern MCP Apps host is documented in `../mcp-host/README.md`; data, inference, and renderer authorities remain in their dedicated modules. Tauri owns only staging, platform configuration, native process-tree containment, and the native save chooser, not a duplicate lifecycle policy.

## Durable layout and migration

The host state root contains `fixture-source/`, `state/registry/`, and `runtime/`. A missing registry initializes lifecycle schema version 1 in `not_installed`; an invalid or unknown existing record fails startup rather than downgrading or overwriting it. There is no prior app registry to migrate in this repository. Version-1 records are validated by the accepted M1 Zod contracts on every read/write. Package paths are internal references and never enter owner DTOs or content-free lifecycle audit events.

Restart reconciliation applies durable intent:

- `active`: reverify the cached signed package and recreate exactly one authenticated runtime if none survives.
- `disabled`, `quarantined`, and `not_installed`: revoke in-memory authority and stop observed runtime processes.
- `staged`: compensate to `not_installed`.
- `updating` or `rollback_pending`: restore the journaled prior `active` or `disabled` intent.
- `uninstalling`: resume the uninstall journal, retry missing/partial cleanup safely, and finish at `not_installed` while retaining owner data.

Install, reinstall, enable, update, rollback, and active restart must first satisfy the verified package manifest's data-schema window. A failed check leaves the lifecycle pointer and retained bytes unchanged. Whole-memory migration/import excludes lifecycle mutation through the gateway's shared in-progress callback. Default uninstall stops/unregisters the runtime and revokes session authority before revoking the grant; it then journals cleanup, clears executable references, removes only validated unshared package/cache/runtime roots, and commits `not_installed`. Immutable Resume revisions, the active owner catalog, recovery evidence, completed operation lookup, and owner exports remain for a compatible reinstall under new installation, grant, and operation identities.

## Owner API

All routes pass through the existing gateway transport and owner authentication hooks, then require `administration` authority:

- `GET /apps/resume-builder`
- `GET /apps`
- `GET /apps/resume-builder/status`
- `GET /apps/resume-builder/inspect`
- `POST /apps/resume-builder/install`
- `POST /apps/resume-builder/reinstall`
- `POST /apps/resume-builder/disable`
- `POST /apps/resume-builder/enable`
- `POST /apps/resume-builder/update`
- `POST /apps/resume-builder/rollback`
- `POST /apps/resume-builder/uninstall`
- `POST /apps/resume-builder/recover`
- `GET /apps/resume-builder/operations/:operationId`
- `POST /apps/resume-builder/operations/:operationId/cancel`
- `POST /apps/resume-builder/session`

Mutation bodies carry an owner-generated UUID `operation_id`, a 16–256 character `idempotency_key`, and `expected_generation`. Installed-state actions also carry the exact `installation_id`; install/reinstall require it to be `null`. Install/update/reinstall carry the exact fixture `version` and an explicit capability decision. Uninstall additionally requires `confirm_retained_data: true`. Equivalent retries return the stored committed result; stale generations, cross-install targets, and identity reuse with different input fail before mutation.

## Requirement evidence

| Requirement | Executable evidence |
|---|---|
| REQ-001–REQ-004 | Signed `.bdapp` fixture, trust/source/revocation verifier, owner lifecycle API, capability delta and explicit approval tests |
| REQ-010 | Atomic/CAS store, operation journal, equivalent/conflicting retry, duplicate side-effect, cancellation-boundary tests |
| REQ-021–REQ-022 | Scoped one-use tokens; non-public authenticated process supervisor; readiness, health, stop, crash budget, shutdown and reconciliation tests |
| REQ-027–REQ-031 | Contract event name, allowlisted content-free fields, safe route errors/DTOs, auth/redaction tests, Docker-first feature gate |
| REQ-034 | Diff and docs preserve the static MCP path and exclude renderer, data, inference, export, product UI, desktop and marketplace behavior |
| REQ-015–REQ-021, REQ-024–REQ-027, REQ-030–REQ-031, REQ-034–REQ-038 | `app-lifecycle.m5.test.ts`: explicit update/grant decisions, side-by-side candidate gating, migration compensation, LKG/checkpoint/rollback, signed monotonic revocation/offline behavior, quarantine, lease serialization, and restart-boundary matrix |
| REQ-002–REQ-003, REQ-010, REQ-022–REQ-030, REQ-035–REQ-038, REQ-040 | `app-lifecycle.m6.test.ts`, `routes.integration.test.ts`, client adapter/component tests: owner/install/generation binding, stable safe DTOs, selective restart-safe cleanup, retained hashes, fresh identities, transport ambiguity, confirmation/focus, and support-bundle redaction |

Focused verification from `builds/typescript` is `npm run test -- app-platform/lifecycle`. `desktop-parity.test.ts` runs the same lifecycle sequence against both accepted runtime targets and checks that no supervised process remains after disable, uninstall, or shutdown. The milestone gate also requires the full runtime/MCP/web/resume package checks, Compose validation, a controlled live Docker lifecycle/restart/shutdown exercise, and actual build/install/live evidence on the selected native Windows target.
