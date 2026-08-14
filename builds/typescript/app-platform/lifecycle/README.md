# Trusted app lifecycle and runtime supervisor

The Spec 05 Milestone 6 dynamic Docker/desktop supervisor, M2 negotiation gate, bounded recovery, exact process-group cleanup, and redacted evidence are documented in `SPEC-05-M6-SUPERVISOR.md`.

The corrective Spec 04 Milestone 6 owner lifecycle boundary is documented in `M6-OWNER-LIFECYCLE.md`. It exposes the M1–M5 lifecycle decisions through owner-bound DTOs and an accessible direct Apps surface, and adds journaled selective uninstall/fresh reinstall. The M5 transactional update kernel remains documented in `M5-TRANSACTIONAL-UPDATE.md`.

The corrective Spec 04 Milestone 4 supervised-activation kernel is documented in `M4-SUPERVISED-ACTIVATION.md`. It adapts the accepted version-1 `InstalledAppSupervisor` contract to the existing `ProcessAppSupervisor`, adds target-checked Docker and packaged-Windows bindings, persists only opaque reconciliation authority, and implements install/disable/re-enable ordering over the M2/M3 stores. It does not add a gateway route or alter fixed MCP discovery.

The dormant Spec 04 Milestone 3 verified-install kernel is documented in `M3-VERIFIED-INSTALL.md`. Its signed source resolver, strict non-executing verifier, immutable package store, exact grant store, and atomic installer use the M1 supervisor interface with a fake only; they add no gateway, real process, MCP registry, or owner-data wiring.

The dormant Spec 04 Milestone 2 persistence kernel is documented in `M2-DURABLE-STATE.md`. Its `LifecycleStateMachine`, versioned `LifecycleStore`, lease, journal, reconciler, and allowlisted diagnostics have no package-verification, process, gateway, MCP, capability, or owner-memory adapter. The runtime/service material described below is pre-existing later-milestone branch capability and is not imported by that kernel.

This directory is the lifecycle/runtime boundary for trusted first-party apps. Spec 08 adds host-derived per-registration lifecycle, idempotency, runtime, and owner-data roots, a reviewed generic data-adapter interface, app/version-keyed first-party package authority, and one parameterized lifecycle route family. The active gateway registers the reviewed Resume Builder and Brief Builder first-party packages through the same platform. This internal-beta proof is not a marketplace, public SDK/ABI, arbitrary package loader, third-party distribution path, or app workflow.

The gateway enables this boundary only when `BRAINDRIVE_APP_PLATFORM_ENABLED=true`. Docker development selects `docker_linux_x64` and persists host-owned installation state at `BRAINDRIVE_APP_STATE_ROOT=/data/app-platform`. Packaged Windows selects `desktop_windows_x64`; packaged macOS selects `desktop_macos_universal`; both use the Tauri platform data root and authenticated loopback transport. Owner career data remains in the separate logical namespace below the configured memory root. Lifecycle policy reaches it only through the narrow `OwnerDataLifecycle` validation/cleanup interface: default uninstall removes abandoned transient stages but retains every durable owner record.

## Runtime boundaries

- `fixture-repository.ts` generates the legacy stored-ZIP fixtures, the independently signed modern Resume fixture, and task-owned generic two-app fixtures. Authorities and package paths are indexed by `(app_id, package_version)`, so equal versions cannot collide. Each source uses an ephemeral Ed25519 test authority on first initialization. Only public trust metadata, signed descriptors/index/revocations, archives, SBOM, and provenance are written. No private signing material is stored or logged.
- `package-verifier.ts` receives the expected registered app/publisher identity and validates it through package lookup, source entry, signed descriptor, canonical archive manifest, target, and signed revocation state before extraction. It also validates the trust root and release-key authorization, archive digest/length, complete file inventory, and host compatibility. Explicit revocation and every identity disagreement fail closed.
- `store.ts` persists the version-1 lifecycle record, version-1 operation journal, grants, verified package metadata, app-scoped idempotent results, uninstall evidence, and explicit-data-deletion records with file/directory sync plus atomic rename. One app-scoped mutation lock prevents lifecycle work from overlapping retained-data deletion. A durable `prepared` deletion record blocks lifecycle activation after a fault or restart until the exact operation retries and becomes `committed`. Lifecycle updates require an exact generation compare-and-swap and exact registered app identity.
- `capability-token.ts` issues random, short-lived, audience/install/package/grant/operation-bound one-use tokens. Only token hashes are retained in process memory; disable, update, uninstall, quarantine, crash recovery, and shutdown rotate or revoke authority.
- `process-supervisor.ts` is the bounded process adapter shared by Docker, packaged Windows, and packaged macOS. It launches one verified Node entrypoint per active installation, provides only the five allowlisted environment values, authenticates health/MCP access, caps captured output accounting, uses bounded readiness/stop time, and exhausts after three crash restarts with 1/2/4-second policy defaults. Docker reports container-internal transport; both desktop targets report random authenticated loopback transport.
- `service.ts` implements install, disable, enable, update, rollback, uninstall/reinstall, cancellation, quarantine, last-known-good retention, restart reconciliation, and separately confirmed retained-data deletion. Identity is injected from a validated registration; lifecycle operations and idempotency authority bind that app and installation. It validates retained-data compatibility before package activation/restart and invokes bounded transient cleanup after runtime authority is revoked. The active registry pointer changes only after readiness succeeds.
- `platform.ts` creates one context per validated first-party registration. Roots are derived solely from the canonical host route key at `state/apps/<route-key>`, `runtime/apps/<route-key>`, and `memory/apps/<route-key>`; manifest/client paths are never accepted.
- `owner-data.ts` is the narrow host-owned generic data lifecycle interface and adapter-binding/backup-identity gate. Default uninstall retains durable data. Explicit deletion requires trusted owner confirmation bound to the app, is allowed only in `not_installed`, invokes only that app's reviewed adapter, and atomically records content-free app-scoped intent before adapter work. Adapter or final-write failure retains the prepared record for exact idempotent recovery; activation remains unavailable until the committed tombstone is durable.
- `state-migration.ts` migrates only synthetic/current Resume control-plane JSON from the singleton `state/registry` layout. It validates bounded Resume records, retains a verified pre-migration snapshot, copies to a temporary app root, compares canonical tree digests, atomically renames, and writes a receipt. Missing, repeated, exact partial, corrupt, and conflicting layouts have deterministic safe outcomes. It never receives or traverses the owner-data root.
- `errors.ts` freezes the lifecycle operation error-code vocabulary as an executable Zod enum; unknown codes fail contract validation.
- `routes.ts` resolves the canonical `:appKey` before request-body or app-state work and exposes one owner-administration handler family below `/apps/:appKey`. `/apps` is sorted by route key and projects only sanitized manifest facts after read-only, app/version-bound verification plus host registration/lifecycle state. Catalog verification checks signatures, identity joins, compatibility, revocation, archive digest, and inventory but does not extract, stage, start, or inspect owner data. Failed verification produces a deterministic unavailable status and no install, launch, update, enable, or recover action. Manifests cannot supply host action labels or executable bindings. Retention classes derive from the reviewed manifest policy; Resume-specific class names are emitted only for Resume Builder. Activation admission is serialized and fail-closed at two active/activating first-party apps. Existing per-process one-CPU/512-MiB containment and three-restart budget are unchanged. DTOs omit host paths, connection tokens (except the explicit owner session response), raw package metadata, credentials, and content.

The existing static MCP configuration and tool registry remain unchanged. The authenticated modern MCP Apps host is documented in `../mcp-host/README.md`; data, inference, and renderer authorities remain in their dedicated modules. Tauri owns only staging, platform configuration, native process-tree containment, and the native save chooser, not a duplicate lifecycle policy.

## Durable layout and migration

The host state root contains shared safe fixture/package primitives plus app-scoped `state/apps/<route-key>/registry/` and `runtime/apps/<route-key>/` roots. Owner data remains separately rooted at `memory/apps/<route-key>/`. A missing app registry initializes lifecycle schema version 1 in `not_installed`; an invalid, mismatched, or unknown existing record fails startup rather than downgrading or overwriting it. Version-1 records are validated by the accepted contracts on every read/write. Package paths are internal references and never enter owner DTOs or content-free lifecycle audit events.

On Resume startup, a legacy `state/registry/` tree is treated as immutable migration source evidence. The migration preserves lifecycle generation, installation, package, grant, operation, and idempotency records byte-for-byte beneath the new Resume app root; the receipt binds source, snapshot, and destination digests. An exact destination without a receipt is recovered by receipt completion. Any digest disagreement blocks Resume activation and leaves both layouts intact. Rollback after migration restores code plus the verified pre-migration control snapshot; owner data is never rolled back or reset. Downgrade after new app-scoped writes remains unsupported.

Restart reconciliation applies durable intent:

- `active`: reverify the cached signed package and recreate exactly one authenticated runtime if none survives.
- `disabled`, `quarantined`, and `not_installed`: revoke in-memory authority and stop observed runtime processes.
- `staged`: compensate to `not_installed`.
- `updating` or `rollback_pending`: restore the journaled prior `active` or `disabled` intent.
- `uninstalling`: resume the uninstall journal, retry missing/partial cleanup safely, and finish at `not_installed` while retaining owner data.

Install, reinstall, enable, update, rollback, and active restart must first satisfy the verified package manifest's data-schema window. A failed check leaves the lifecycle pointer and retained bytes unchanged. Whole-memory migration/import excludes lifecycle mutation through the gateway's shared in-progress callback. Default uninstall stops/unregisters the runtime and revokes session authority before revoking the grant; it then journals cleanup, clears executable references, removes only validated unshared package/cache/runtime roots, and commits `not_installed`. Immutable Resume revisions, the active owner catalog, recovery evidence, completed operation lookup, and owner exports remain for a compatible reinstall under new installation, grant, and operation identities.

## Owner API

All routes pass through the existing gateway transport and owner authentication hooks, then require `administration` authority:

- `GET /apps`
- `GET /apps/:appKey`, `/status`, or `/inspect`
- `POST /apps/:appKey/install`, `/reinstall`, `/disable`, `/enable`, `/update`, `/rollback`, `/uninstall`, or `/recover`
- `GET /apps/:appKey/operations/:operationId`
- `POST /apps/:appKey/operations/:operationId/cancel`
- `POST /apps/:appKey/session`
- `POST /apps/:appKey/data/delete`

`resume-builder` and `brief-builder` are registered values of the generic route parameter, not separately registered lifecycle aliases. The maintained web adapter exports only app-key-parameterized lifecycle functions; no Resume-only lifecycle endpoint remains.

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

Focused verification from `builds/typescript` is `npm run test -- app-platform/lifecycle`. `desktop-parity.test.ts` runs the same lifecycle sequence against Docker, packaged Windows, and packaged macOS and checks that no supervised process remains after disable, uninstall, or shutdown. The two-app isolation test runs Resume Builder and Brief Builder concurrently on Docker and macOS targets. The milestone gate also requires the full runtime/MCP/web/app-package checks, Compose validation, a controlled live Docker lifecycle/restart/shutdown exercise, and actual build/install/live evidence on native Windows and macOS.

The reviewed Brief Builder service uses the same verifier, immutable package store, process supervisor, app-scoped state, restart budget, and generic route family as Resume Builder. Its signed `1.2.0` package declares Docker Linux x64, desktop Windows x64, and desktop macOS universal artifacts, while its adapter reports and retains only Brief owner data, approved revision history, and lifecycle evidence on uninstall. Version-specific signed fixture authority is retained so an installed prior version can be verified and transactionally updated instead of being replaced under the same package identity.
