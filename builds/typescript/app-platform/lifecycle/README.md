# Trusted app lifecycle and runtime supervisor

This directory is the Milestone 2 runtime boundary for the accepted Resume Builder specifications. It can install and supervise only the signed repository fixture for `ai.braindrive.resume-builder`; it is not a marketplace, a general plugin SDK, or the Resume Builder workflow.

The gateway enables this boundary only when `BRAINDRIVE_APP_PLATFORM_ENABLED=true`. Docker development selects `docker_linux_x64` and persists host-owned installation state at `BRAINDRIVE_APP_STATE_ROOT=/data/app-platform`. Packaged Windows selects `desktop_windows_x64` and uses its Tauri platform data root. Owner career data remains in the separate logical namespace below the configured memory root. Lifecycle code never enumerates or deletes that namespace, and default uninstall removes executable/cache/grant/token/runtime authority only.

## Runtime boundaries

- `fixture-repository.ts` generates the legacy version-1/version-2 stored-ZIP fixtures and the independently signed modern version-3 MCP Apps fixture. Each source uses an ephemeral Ed25519 test authority on first initialization. Only public trust metadata, signed descriptors/index/revocations, archives, SBOM, and provenance are written. No private signing material is stored or logged.
- `package-verifier.ts` validates the trust root and release-key authorization, source index, descriptor signature, archive digest/length, canonical manifest, complete file inventory, host compatibility, and signed revocation state before extraction. Explicit revocation fails closed.
- `store.ts` persists the version-1 lifecycle record, version-1 operation journal, grants, verified package metadata, and idempotent results with file/directory sync plus atomic rename. Lifecycle updates require an exact generation compare-and-swap.
- `capability-token.ts` issues random, short-lived, audience/install/package/grant/operation-bound one-use tokens. Only token hashes are retained in process memory; disable, update, uninstall, quarantine, crash recovery, and shutdown rotate or revoke authority.
- `process-supervisor.ts` is the bounded process adapter shared by Docker and packaged Windows. It launches one verified Node entrypoint per active installation, provides only the five allowlisted environment values, authenticates health/MCP access, caps captured output accounting, uses bounded readiness/stop time, and exhausts after three crash restarts with 1/2/4-second policy defaults. Docker reports container-internal transport; Windows reports random authenticated loopback transport.
- `service.ts` implements install, disable, enable, update, rollback, uninstall/reinstall, cancellation, quarantine, last-known-good retention, and restart reconciliation. The active registry pointer changes only after readiness succeeds.
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
- `uninstalling`: finish at `not_installed` while retaining owner data.

## Owner API

All routes pass through the existing gateway transport and owner authentication hooks, then require `administration` authority:

- `GET /apps/resume-builder`
- `POST /apps/resume-builder/install`
- `POST /apps/resume-builder/disable`
- `POST /apps/resume-builder/enable`
- `POST /apps/resume-builder/update`
- `POST /apps/resume-builder/rollback`
- `POST /apps/resume-builder/uninstall`
- `GET /apps/resume-builder/operations/:operationId`
- `POST /apps/resume-builder/operations/:operationId/cancel`
- `POST /apps/resume-builder/session`

Mutation bodies carry a 16–256 character `idempotency_key`. Install/update also carry the exact fixture `version` and an explicit `approve_capabilities` decision. Equivalent retries return the stored committed result; reuse with different input fails deterministically.

## Requirement evidence

| Requirement | Milestone 2 executable evidence |
|---|---|
| REQ-001–REQ-004 | Signed `.bdapp` fixture, trust/source/revocation verifier, owner lifecycle API, capability delta and explicit approval tests |
| REQ-010 | Atomic/CAS store, operation journal, equivalent/conflicting retry, duplicate side-effect, cancellation-boundary tests |
| REQ-021–REQ-022 | Scoped one-use tokens; non-public authenticated process supervisor; readiness, health, stop, crash budget, shutdown and reconciliation tests |
| REQ-027–REQ-031 | Contract event name, allowlisted content-free fields, safe route errors/DTOs, auth/redaction tests, Docker-first feature gate |
| REQ-034 | Diff and docs preserve the static MCP path and exclude renderer, data, inference, export, product UI, desktop and marketplace behavior |

Focused verification from `builds/typescript` is `npm run test -- app-platform/lifecycle`. `desktop-parity.test.ts` runs the same lifecycle sequence against both accepted runtime targets and checks that no supervised process remains after disable, uninstall, or shutdown. The milestone gate also requires the full runtime/MCP/web/resume package checks, Compose validation, a controlled live Docker lifecycle/restart/shutdown exercise, and actual build/install/live evidence on the selected native Windows target.
