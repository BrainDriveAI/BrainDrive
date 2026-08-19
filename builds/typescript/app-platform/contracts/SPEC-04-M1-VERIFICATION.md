# Spec 04 Milestone 1 verification plan

Status: Accepted

Accountable owner: DJJones, Project Owner and initial project/security/release/desktop authority

Accepted source decision: 2026-08-07; M1 conformance closure authorized 2026-08-08

## Authority and reproducible context

The behavioral authority is the accepted `spec-04-resume-builder-packaging-installation-and-lifecycle.md` in `/home/hex/Reference/Designs/BrainDrive-Tools/Resume-Builder/MVP/`. Its implementation plan, prompt pack, accepted Specs 01–03 and 05, and the accepted MVP `test-plan.md` are required companion context.

Repository authority and executable evidence are:

- `AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json`, and `docs/developers/verification.md`.
- `app-platform/contracts/ADRS.md` for accepted cross-spec decisions.
- `package.ts`, `lifecycle.ts`, `lifecycle-foundation.ts`, `supervisor.ts`, `audit.ts`, and `errors.ts` for version-1 contracts.
- `fixtures/spec-04/package-corpus.json`, `m1-evidence.json`, and `requirements.json` for reproducible vectors and matrices.
- `app-lifecycle.m1.test.ts` for the executable M1 audit.

The repository-consistent contract location is `builds/typescript/app-platform/contracts`, not a parallel `app-lifecycle` runtime. The focused test filename retains `app-lifecycle` so the accepted milestone command selects the intended tests.

## Accepted decisions

| Prompt decision | Accepted contract | Accountable owner |
|---|---|---|
| OQ-4-1 archive, canonicalization, manifest, signing and rotation | `.bdapp` stored ZIP profile; canonical JSON plus LF; SHA-256; Ed25519; pinned app root authorizes bounded release keys | DJJones, project/security/release authority |
| OQ-4-2 package sources | Signed repository fixture index for Docker; credential-free signed BrainDrive release assets for native Windows | DJJones, project/release authority |
| OQ-4-3 LKG, snapshot, quota and checkpoint | Active plus one non-revoked LKG and one pre-migration snapshot until one authenticated request succeeds under the new runtime generation | DJJones, project/data authority |
| OQ-4-4 revocation | BrainDrive release authority; signed monotonic list; hourly refresh, stale after 24 hours; explicit match fails closed; cached last-valid list remains binding | DJJones, security/release authority |
| OQ-4-5 retained-data deletion | Deferred to a separate accepted privacy/data-management specification; default uninstall preserves owner data and exports | DJJones, project/privacy authority |
| OQ-4-6 desktop target | Native Windows x64 is the first claimed packaged target; macOS/Linux remain unclaimed until separately accepted and live-tested | DJJones, desktop release/QA authority |

## Version-1 contract gate

| Contract | Authority | Fail-closed rule |
|---|---|---|
| Package/archive/source/revocation/trust | `package.ts` | Unknown versions, fields, algorithms, keys, targets, capabilities, paths, link/device entries, collisions and limits reject before execution |
| Lifecycle/operation/result | `lifecycle.ts` | Missing state reads as `not_installed`; invalid transitions and ambiguous commit/recovery outcomes reject |
| Storage/mixed versions/Spec 02 adapter | `lifecycle-foundation.ts` | Storage roots stay distinct; newer contracts do not execute; owner data is preserved for repair/export |
| Grant/token | `package.ts` | Exact installation-scoped capabilities only; widening requires a new owner decision; no credential or raw path |
| Spec 05 supervisor | `supervisor.ts` | Typed start/readiness/health/register/stop/revoke/cleanup/reconcile; ambiguous stop never acknowledges termination |
| Errors and diagnostics | `errors.ts`, `audit.ts` | Stable safe codes and one strict metadata allowlist; content, manifests, signatures, tokens, credentials, URLs, app output and paths are not fields |

`InstalledAppSupervisor` exposes exactly `start`, `awaitReady`, `health`, `register`, `stop`, `revokeTokens`, `cleanup`, and `reconcile`. `ResumeLifecycleDataAdapter` exposes exactly `inspectSchema`, `discoverRetainedData`, `snapshot`, `migrate`, and `restore`; it has no retained-data deletion method.

## G0–G6 evidence gates

| Gate | Owner | Required evidence | M1 disposition |
|---|---|---|---|
| G0 Decision authority | Project owner | Accepted Spec 04, this plan, and cross-spec ADR with OQ owners | Automated artifact audit plus human approval |
| G1 Contract conformance | Contract owner | Strict schemas, transition table, errors, mixed-version and adapter boundaries | Automated M1 tests |
| G2 Package trust | Security/release owner | Public-key-only signed corpus; deterministic negative cases; no pre-verification execution | Automated M1 tests and repository secret scan |
| G3 Lifecycle recovery | Lifecycle/runtime owner | Idempotency, failure/transition matrix, durable recovery and diagnostic allowlist | M1 contract evidence; runtime proof belongs to later milestones |
| G4 Owner-data integrity | Spec 02 data owner | Storage separation, opaque adapter, migration/restore and retained-data evidence | M1 contract evidence; live retention belongs to later milestones |
| G5 Supervisor boundary | Spec 05 supervisor owner | Typed supervisor interface, revoke/stop ordering, Docker/desktop normalized outcomes | M1 contract evidence; live supervision belongs to later milestones |
| G6 Release acceptance | Desktop release/QA owner | Signed release artifacts, Docker report, native Windows report, revocation drill and human review | Defined now; cannot pass from M1 source tests alone |

The machine-readable gate, transition, and failure matrices are in `fixtures/spec-04/m1-evidence.json`. The exact REQ-001–REQ-040 evidence-method/gate/owner mapping is in `fixtures/spec-04/requirements.json`. Automated, live, human, and release evidence are deliberately distinct; one cannot substitute for another.

## Fixture corpus

The corpus contains `signed-good`, `wrong-key`, `tampered`, `malformed`, `incompatible`, `capability-widened`, `revoked`, `traversal`, `unsafe-link`, `duplicate-path`, `case-collision`, and `oversize`. Each vector has one expected stable code and a canonical per-case SHA-256 identity computed by the focused test. The valid package/source/revocation vectors contain public keys and mutually verified signatures only. Their one-time signing keys were discarded; no fixture generation or M1 test needs private signing material.

No fixture entrypoint is executed. The M1 test imports contract modules only and does not import the gateway, package store, lifecycle service, supervisor implementation, MCP registry, Docker, Tauri, or Resume Builder package.

## Verification commands

From `builds/typescript`:

```bash
npm run test -- app-lifecycle
npm run lint
npm run test
npm run build
npm run docs:verify
```

From the repository root:

```bash
node tools/docs/sync-generated.mjs --check
tools/security/scan-secrets.sh --current
git diff --check
```

Review the complete diff and status after the commands. Confirm the M1 diff contains no route, process launch, package fetch/store, persistent lifecycle service, API/UI, Docker/Tauri binding, private key, or retained-data delete operation.

## Branch baseline limitation

This plan and its new contracts do not enable package execution. The current `feature/resume-builder-app` branch already contains later-milestone lifecycle/runtime code from an earlier commit, so a review of this M1 closure must distinguish the current diff from that pre-existing branch capability. A clean standalone M1 branch would remain execution-disabled; this advanced branch does not.
