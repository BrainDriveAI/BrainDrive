# Spec 04 Milestone 7 lifecycle acceptance

Recorded: 2026-08-09

Candidate: working tree based on `6af0a36f` on `feature/resume-builder-app`

Selected packaged target: native Windows x64

## Disposition

**Development acceptance passed. Production release approval is not claimed.**

The Spec 04 integration blockers did not depend on unfinished Spec 05 work. The accepted Spec 05 supervisor boundary was already present and is exercised by the M4-M7 conformance suites. M7 integration completed the missing immutable-package composition, Windows filesystem parity, live Docker restart, native Windows package build/install/runtime/uninstall/reinstall evidence, and owner-data retention checks.

Production Windows signing is owned by `/home/hex/Project/Release-Bridge/`; it is not implemented or duplicated in this repository. An isolated non-exportable test certificate was used only to prove the local installer-signing and tamper-detection path. Its private-key certificate, temporary trusted-root entry, public certificate, signing configuration, and thumbprint file were removed after the test. The official Release Bridge output and retained human UI/accessibility review remain release-stage evidence.

## Integration changes

- `lifecycle/verified-package-store.ts` owns content-addressed promotion, stable reference counting, Windows-safe idempotent destination reuse, integrity rechecks, and reference-safe removal.
- `lifecycle/package-verifier.ts` stages the signed canonical manifest with the verified package so later integrity checks do not depend on a download directory.
- `lifecycle/bootstrap.ts`, `service.ts`, and `store.ts` compose the immutable store into install, update, enable, rollback, restart, revocation, and uninstall; legacy staging-backed records migrate on initialization.
- `lifecycle/filesystem-durability.ts` keeps file flushes strict and tolerates only Windows' documented unsupported directory-fsync errors.
- `desktop-parity.test.ts`, `app-lifecycle.m3.test.ts`, `resume-data-m7.test.ts`, and `mcp-host/live-fixture.integration.test.ts` cover native parity, immutable execution, owner-data equivalence, authenticated MCP Apps operation, and complete cleanup.

No marketplace, third-party publishing, retained-data deletion, cloud/mobile target, silent update, provider/model redesign, or additional packaged OS target was added.

## Target evidence

| Target | Result | Evidence |
|---|---|---|
| Docker dev | Pass | App container restarted healthy; gateway `/health` returned `200 {"status":"ok"}`; the sole Resume Builder child executed `/data/app-platform/host-app-packages/030a1c.../payload/docker/index.js`; the immutable root contained `manifest.json`, `sbom/cyclonedx.json`, and `provenance/build.jsonl`. Authenticated live lifecycle operations previously converged active -> disabled -> active across durable generations. |
| Native Windows x64 conformance | Pass | Focused native corpus: 4 files/30 tests. Full single-worker native main corpus: 67 files/529 tests. Web: 21 files/206 tests. Rust: 54 passed/1 intentional containment helper ignored. MCP and desktop preflight builds passed. |
| Resume Builder package | Pass | Linux and native Windows each passed 4 files/11 tests and TypeScript build. Signed package/source/revocation, UI resource, workflow, inference MCP, and skeleton fixtures are public-key-only. |
| Installed Windows dev candidate | Pass | BrainDrive 26.7.14 was explicitly authorized for replacement. BrainDrive 26.7.23 installed, launched its packaged runtime, reached gateway/MCP readiness and `/health: ok`, gracefully closed with zero packaged processes, uninstalled executable and 98 MB runtime, preserved the complete owner-data tree, reinstalled, and was left running healthy. |

The installed dev candidate at evidence time was BrainDrive `26.7.23`, process `203780`, gateway port `63355`, health `ok`. Ports and process IDs are ephemeral and are recorded only to identify the observed run.

## Windows installer and retention evidence

- Test installer: `BrainDrive_26.7.23_x64-setup.exe`
- Size: `28,301,816` bytes
- SHA-256: `E592964ECA9C194A5CB493D28FCA95E87C337AE2633DBD8A8CA1499228BA01D9`
- Test signer during acceptance: `CN=BrainDrive M7 Isolated Acceptance Test`
- Signature status while the isolated test root was present: `Valid`
- Tamper check: a one-byte-modified temporary copy did not retain a valid signature and was removed.
- Release meaning: this is development evidence, not the official Release Bridge-signed artifact.

Before replacing 26.7.14, 337 owner-data files totaling 822,177 bytes had aggregate SHA-256 `1468391E546182037492AA6B95FD60293F8AF5A6F57DBB68FBE9C1311A87A7C9`; the tree matched exactly after replacement. The running candidate legitimately added runtime state. Immediately before the candidate's own graceful uninstall, 369 files were re-baselined; file count and aggregate hash were identical after uninstall. The executable and `desktop-runtime` were absent before reinstall.

A force-kill trial was rejected as uninstall evidence because it left two packaged Node bridge children holding runtime files open. Those exact processes and stale installed resources were removed, the candidate was restored, and the accepted cycle used normal window close. Normal close left zero packaged processes before uninstall.

## Requirement-to-evidence matrix

| Requirement | Result | Evidence |
|---|---|---|
| REQ-001 | Pass | Accepted authority, owner authorization, scoped diff review. |
| REQ-002 | Technical pass; human review pending | Authenticated routes, `AppsPage` component tests, Docker lifecycle probe, native parity suite. |
| REQ-003 | Pass | Auth integration, exact grants, forbidden-field and secret scans. |
| REQ-004 | Pass | M2 state-machine, transition, persistence, and recovery tests. |
| REQ-005 | Pass | M1 strict package/identity schemas and M3 deterministic fixtures. |
| REQ-006 | Pass | Wrong-key, tamper, digest, manifest, archive, compatibility, capability, and revocation rejection tests. |
| REQ-007 | Pass | Immutable-store tests and live Docker child path under `host-app-packages`. |
| REQ-008 | Pass | M2-M5 interruption/restart reconciliation and installed restart evidence. |
| REQ-009 | Pass | Duplicate/concurrent operation and package-reference serialization tests. |
| REQ-010 | Technical pass; human review pending | Inspection DTO/API/component assertions cover identity, trust, capability, source, compatibility, and retention. |
| REQ-011 | Pass | Installation-scoped grant, denial, widening, revocation, and reinstall identity tests. |
| REQ-012 | Pass | M3 atomic install and live authenticated supervisor/MCP fixture. |
| REQ-013 | Pass | M4 disable ordering, Docker live disable, and desktop parity. |
| REQ-014 | Pass | M4 integrity/revocation/grant revalidation and readiness-gated enable. |
| REQ-015 | Technical pass; human review pending | Explicit update route/UI action; no silent update path or provider-policy mutation. |
| REQ-016 | Pass | M5 side-by-side candidate and atomic generation/pointer switch tests. |
| REQ-017 | Pass | M5 non-revoked LKG checkpoint, quota, explicit rollback, and safety rollback tests. |
| REQ-018 | Pass | Opaque Spec 02 snapshot/migrate/validate/restore and crash-boundary tests. |
| REQ-019 | Pass for repository package flow | Signed monotonic revocation refresh, live-process token/registration removal, quarantine, and concurrency tests. Official release delivery remains Release Bridge-owned. |
| REQ-020 | Pass | Last-valid cache, stale/offline/invalid/older authority tests. |
| REQ-021 | Pass | Ordered revoke/stop/unregister assertions across M4-M6. |
| REQ-022 | Pass | Immutable package/reference cleanup, live app uninstall, and Windows installed-runtime removal. |
| REQ-023 | Pass | Resume retention suite plus before/after Windows owner-data aggregate hashes. |
| REQ-024 | Pass | Fresh install/grant identities and retained-data rediscovery tests. |
| REQ-025 | Pass | Storage-policy contracts, distinct roots, disk manifests, and support-bundle boundaries. |
| REQ-026 | Pass | Token/path/credential forbidden-field tests and current-tree secret scan. |
| REQ-027 | Pass | Strict untrusted parsing and lifecycle dependency/scope checks prove no model selection or inference. |
| REQ-028 | Pass | Authenticated catalog/status/inspect and lifecycle route integration tests with stable errors. |
| REQ-029 | Technical pass; human review pending | Accessible labels/status/confirmation/recovery component tests; retained keyboard/screen-reader review is still release evidence. |
| REQ-030 | Pass | Correlated allowlisted audit, diagnostic, uninstall summary, and support-bundle redaction tests. |
| REQ-031 | Pass for repository package artifacts | Deterministic signed package/source/revocation fixtures, SBOM, and provenance. Official Windows product signing is Release Bridge-owned. |
| REQ-032 | Pass | Repository-controlled signed Docker fixture/feed and deterministic failure corpus. |
| REQ-033 | Development pass; Release Bridge handoff | Native Windows x64 alone was built, installed, live-tested, and uninstalled; official product signature is applied by Release Bridge. |
| REQ-034 | Pass | Shared Docker/Windows conformance, desktop parity, and normalized owner-data transition suites. |
| REQ-035 | Pass | Linux and Windows main/web/MCP/desktop/Resume Builder regression gates. |
| REQ-036 | Pass | M1 cross-spec contracts, Spec 02 data adapter, and accepted Spec 05 supervisor adapter tests. |
| REQ-037 | Pass | Typed contract/service/API/UI failure and safe recovery assertions. |
| REQ-038 | Pass | Normal, tampered, revoked, incompatible, partial, interrupted, concurrent, offline, migration, rollback, uninstall, and reinstall corpus. |
| REQ-039 | Technical matrix complete; human evidence pending | This report plus M1 machine-readable mappings, Docker/native reports, disk hashes, and command results. |
| REQ-040 | Pass | Final scope/diff review found no excluded future feature or additional target claim. |

## G0-G6 gates

| Gate | Result | Evidence / remaining release input |
|---|---|---|
| G0 Decision authority | Pass | Accepted Spec 04/plan/ADRs and explicit project-owner authorization. |
| G1 Contract conformance | Pass | M1 schemas/matrices plus full Linux and Windows contract suites. |
| G2 Package trust | Pass | Signed public fixture corpus, immutable execution, adversarial rejection, and zero current-tree secret findings. |
| G3 Lifecycle recovery | Pass | M2-M5 failure, restart, idempotency, concurrency, and diagnostic corpus. |
| G4 Owner-data integrity | Pass | Opaque adapter, migration restore, retention tests, and independent Windows before/after hashes. |
| G5 Supervisor boundary | Pass | Accepted Spec 05 adapter, real child-process readiness/token/registration ordering, Docker/Windows parity. |
| G6 Release acceptance | Conditional | Docker and native Windows reports plus revocation drill pass. Official Windows signing is delegated to Release Bridge; retained human trust-copy, keyboard/screen-reader/contrast/responsive review is not recorded here. |

## Verification results

- Linux main: `npm run test` -> 79 files/558 tests passed; `npm run build` passed.
- Native Windows focused M7: 4 files/30 tests passed; main TypeScript build passed.
- Native Windows full main: 67 files/529 tests passed with one worker. The default parallel run had two five-second timing failures; both exact files passed 20/20 in isolation before the complete single-worker pass.
- Native Windows web: 21 files/206 tests passed; desktop preflight, MCP build, and Rust 54 passed/1 intentional ignore.
- MCP release: 2 files/6 tests and build passed.
- Resume Builder: Linux and Windows 4 files/11 tests and build passed.
- Docker: Compose dev start/restart healthy; in-container `/health` returned 200; immutable child/artifact inspection passed.
- Documentation validation after registering this record: docs check passed with 242 candidates and generated projections are current. The 164-test documentation harness now reports 161 passed/1 platform skip/2 failed because its composed release report correctly marks the older M8 evidence stale after source changes; regeneration is intentionally deferred to an immutable release candidate.
- `git diff --check` passed. Current-tree secret scan reported zero findings.

## Remaining release-stage inputs

1. Have Release Bridge produce the official signed Windows artifact from an immutable approved revision and attach its identity/hash evidence.
2. Retain human review evidence for trust/capability/retention/recovery copy and keyboard/screen-reader/contrast/responsive behavior.
3. Bind those results to a clean immutable candidate before publication. The current dirty working tree is development evidence and must not be represented as a publishable release revision.
