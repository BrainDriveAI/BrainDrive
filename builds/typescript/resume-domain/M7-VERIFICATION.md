# Spec 02 Milestone 7 Verification Record

Status: **NOT RELEASE-READY**

This is a non-authoritative verification record for the current dirty working tree based on
`e6d526742b957f545ddc471a1bedc94c9137fb78`. Linux, Docker dev, browser, contract, domain,
migration, lifecycle, redaction, regression, native-Windows source, and native-Windows package
build evidence passed. The resulting local installer was not installed or exercised as a live
packaged application and owner/security human review has not been recorded. This record is shipped
with the source commit; the release process must still create and review its formal immutable
candidate proof. These are release blockers, not waived risks.

## Candidate and environment

- App ID: `ai.braindrive.resume-builder`
- Host version: `26.7.23`
- Data/catalog/migration schema: version `1`
- Logical runtime targets exercised by the M7 harness: `docker_linux_x64` and
  `desktop_windows_x64`
- Live local environment: WSL2 Linux x64, Node `20.20.1`, npm `10.8.2`, Rust/Cargo `1.95`
- Live Docker environment: Docker `29.2.0`, Compose `5.0.2`, Linux/amd64; app image
  `sha256:edfe0bebe8029854b11f51c334301e639d48b718c266e6277881ae2ada3ef229`
- Native Windows environment: Windows PowerShell `5.1.26100.8875`, Node `22.22.3`, npm `10.9.8`,
  Rust/Cargo `1.95.0`, and Git for Windows `2.53.0.windows.1`
- The native run used an isolated 860-file copy of the tracked/nonignored candidate. Before
  verification-record-only edits, source and copy both had aggregate inventory SHA-256
  `d194a2b841b56cfa854b18580704ce814521d918c1abaca86fff4c2fa1a5aa53`.
- Browser package fixture digest observed in E2E:
  `sha256:782f788cccb0a05519c2814652bf20ebaae1a103d4257fc3c00b7132b10f77c3`
- Native Windows evidence in `docs/developers/verification/platform-reports/windows-j05.json`
  applies to source revision `7576ac504e42fce346bf79b3559fafbcdd342d98`, not this candidate.
  It is stale and was not carried forward.

The M7 target harness passed on Linux, inside the Docker app container, and under native Windows.
The NSIS package also built natively. No claim is made that the uninstalled package completed a
live installed-app journey.

## Evidence catalog

Each matrix entry references one or more IDs below. The ID supplies the automated test,
command/result, layer, environment, artifact, and schema identity. `H1` is the human-evidence
disposition shared by every row.

| ID | Evidence and exact result | Layer / environment / identity |
| --- | --- | --- |
| C1 | `npm run test -- resume-data`: 6 files, 60 tests passed | Contracts and M2–M7 domain suites; WSL2 Linux; app/data schema v1 |
| C2 | `app-platform/contracts/spec-02-conformance.test.ts`: included in the full suite and passing | JSON Schema/validator conformance; manifest v1; accepted Spec 02 authority |
| S2 | `resume-data-store.test.ts`: included in C1 and passing | Real temporary filesystems and separate Node processes; catalog/data schema v1 |
| S3 | `resume-data-m3.test.ts`: included in C1 and passing | Fact/source/context domain services; schema v1 |
| S4 | `resume-data-m4.test.ts`: included in C1 and passing | Resume/job/variant/artifact/export graph; schema v1 |
| S5 | `resume-data-m5.test.ts` plus MCP-host route/bridge suites: included in T1 and passing | Named capability host boundary; package/install/token identities |
| S6 | `resume-data-m6.test.ts` plus memory migration/backup suites: included in T1 and passing | Migration, retention, transfer, uninstall/reinstall; schema 0-to-1 and v1 |
| X1 | `resume-data-m7.test.ts`: passed locally and inside the live Docker app container | Normalized end-to-end transitions for `docker_linux_x64` and source-level `desktop_windows_x64`; app/data schema v1 |
| T1 | `npm run test && npm run build`: 73 files, 467 tests passed; TypeScript build passed | Full TypeScript runtime regression; WSL2 Linux; host `26.7.23` |
| W1 | `npm run web:typecheck && npm run web:test && npm run web:build`: typecheck passed; 21 files/203 tests passed; build passed | Web integration; WSL2 Linux; existing unresolved-font and large-chunk warnings only |
| E1 | `npm run test:e2e`: mobile 12 passed/8 skipped; desktop Chrome 5 passed/5 skipped | Disposable provider-independent local gateway/web; Resume owner journey passed |
| P1 | Resume package `npm run test && npm run build`: 4 files/11 tests passed; package build passed | `builds/resume_builder`; sandbox resource/host bridge contract |
| D1 | `npm run desktop:preflight` and `npm run desktop:test`: both passed | WSL2 source/preflight only; includes T1, MCP build, web tests, and Cargo tests |
| M1 | MCP release `npm run test && npm run build`: 2 files/6 tests passed; build passed | MCP release package; WSL2 Linux |
| R1 | `cargo fmt --manifest-path builds/typescript/src-tauri/Cargo.toml -- --check`: passed | Rust formatting; WSL2 Linux |
| L1 | `npm run lint && npm run web:lint`: both substantive ESLint checks passed | Runtime and web source |
| D2 | `docker compose -f compose.dev.yml config` and `./scripts/start.sh dev`: passed; app healthy and web/gateway returned HTTP 200 | Live bind-mounted Docker dev; Linux/amd64; app image above |
| D3 | `docker compose -f compose.dev.yml exec -T -w /app/typescript app npm run test -- resume-data-m7`: 1 file/1 test passed | Live Docker app container; current bind-mounted source; schema v1 |
| G1 | `npm run docs:verify` and `node tools/docs/sync-generated.mjs --check`: 163 passed/1 skipped; validation passed with 235 candidates/0 diagnostics; projections matched | Developer documentation governance |
| Q1 | `tools/security/scan-secrets.sh --current`: gitleaks `8.30.1`, tracked/nonignored working tree, 0 findings | Content-safe security scan |
| N1 | Native `npm run test -- resume-data`: 6 files/60 tests passed; Resume package 4 files/11 tests and build passed; `desktop:preflight` passed; `desktop:test` passed (runtime 67 files/453 tests, web 21 files/203 tests, Rust 54 passed/1 ignored) | Native Windows source, package-contract, web, and Rust acceptance; app/data schema v1 |
| N2 | Native `npm run desktop:build:windows`: passed and produced `BrainDrive_26.7.23_x64-setup.exe` and `BrainDrive-latest-windows-x64-setup.exe`, 28,237,235 bytes each, identical SHA-256 `0f3ed736daf6a3eae60e3d2b777786c3fc85c811f850a84f00b0756bf7a2e9f5` | Native Windows x64 release package; local artifact intentionally unsigned (`NotSigned`) |
| N3 | Install and live-run the generated Windows package | **NOT RUN**: installation changes host state and was outside the requested build test; no packaged lifecycle/chooser/crash/restart evidence is claimed |
| H1 | Owner/security review of the immutable candidate and sanitized evidence | **PENDING**: no reviewer record exists |

The prompt pack described web lint as a placeholder. Accepted ADR-RB-006 and the live package
scripts make both lint commands substantive, so the actual substantive pass is recorded.

## Requirement-to-evidence matrix

`Automated pass / review pending` means the requirement passed the applicable Linux, Docker,
browser, and native-Windows source/build checks, while immutable-candidate human review remains
open. Requirements that specifically need an installed packaged app also cite `N3`.

| Requirement | Automated/live evidence | Human evidence | Disposition |
| --- | --- | --- | --- |
| REQ-001 | C1, C2, S2, S5, N1 | H1 | Automated pass / review pending |
| REQ-002 | C1, C2, S2, N1 | H1 | Automated pass / review pending |
| REQ-003 | C1, C2, S5, X1, N1 | H1 | Automated pass / review pending |
| REQ-004 | C1, C2, S3, X1, N1 | H1 | Automated pass / review pending |
| REQ-005 | C1, S3, S4, X1, N1 | H1 | Automated pass / review pending |
| REQ-006 | C2, S3, E1, P1, N1 | H1 | Automated pass / review pending |
| REQ-007 | C1, S3, S4, N1 | H1 | Automated pass / review pending |
| REQ-008 | C1, S3, N1 | H1 | Automated pass / review pending |
| REQ-009 | C1, S4, X1, E1, N1 | H1 | Automated pass / review pending |
| REQ-010 | C1, S4, X1, N1 | H1 | Automated pass / review pending |
| REQ-011 | C1, S4, X1, E1, N1 | H1 | Automated pass / review pending |
| REQ-012 | C1, S4, X1, E1, N1 | H1 | Automated pass / review pending |
| REQ-013 | C1, S4, X1, E1, N1 | H1 | Automated pass / review pending |
| REQ-014 | C1, S4, E1, N1 | H1 | Automated pass / review pending |
| REQ-015 | C1, S4, N1 | H1 | Automated pass / review pending |
| REQ-016 | C1, C2, S2, S5, N1 | H1 | Automated pass / review pending |
| REQ-017 | C1, C2, S2, S4, S5, N1 | H1 | Automated pass / review pending |
| REQ-018 | C1, C2, S2, S3, S4, N1 | H1 | Automated pass / review pending |
| REQ-019 | C1, S2, X1, N1 | H1 | Automated pass / review pending |
| REQ-020 | C1, C2, S2, N1 | H1 | Automated pass / review pending |
| REQ-021 | C1, C2, S6, N1 | H1 | Automated pass / review pending |
| REQ-022 | C1, C2, S6, D1, N1 | H1 | Automated pass / review pending |
| REQ-023 | C1, C2, S4, S6, N1 | H1 | Automated pass / review pending |
| REQ-024 | C1, C2, S3, S6, T1, N1 | H1 | Automated pass / review pending |
| REQ-025 | C1, C2, S6, X1, N1 | H1 | Automated pass / review pending |
| REQ-026 | C1, C2, S5, S6, X1, N1 | H1 | Automated pass / review pending |
| REQ-027 | C2, X1, D2, D3, N1, N2, N3 | H1 | Build/data pass / installed live pending |
| REQ-028 | C1, C2, S3, S4, S5, N1 | H1 | Automated pass / review pending |
| REQ-029 | C1, S4, X1, E1, N1 | H1 | Automated pass / review pending |
| REQ-030 | C1, C2, S3, N1 | H1 | Automated pass / review pending |
| REQ-031 | C1, C2, S3, S4, S5, X1, N1 | H1 | Automated pass / review pending |
| REQ-032 | C1, C2, S5, E1, N1 | H1 | Automated pass / review pending |
| REQ-033 | C1, C2, S2, S3, S4, S5, S6, N1 | H1 | Automated pass / review pending |
| REQ-034 | C1, C2, S5, E1, N1 | H1 | Automated pass / review pending |
| REQ-035 | C1, C2, S5, N1 | H1 | Automated pass / review pending |
| REQ-036 | C1, C2, S3, S5, X1, E1, N1 | H1 | Automated pass / review pending |
| REQ-037 | C1, C2, S5, E1, N1 | H1 | Automated pass / review pending |
| REQ-038 | C1, C2, S2, S3, S4, S5, S6, Q1, N1 | H1 | Automated pass / review pending |
| REQ-039 | C1, C2, S3, S5, N1 | H1 | Automated pass / review pending |
| REQ-040 | T1, W1, P1, D1, M1, R1, E1, D2, N1, N2 | H1 | Automated pass / review pending |

## Invariant-to-evidence matrix

| Invariant | Automated/live evidence | Human evidence | Disposition |
| --- | --- | --- | --- |
| INV-01 host-authenticated confirmation only | C2, S3, S5, X1, E1, P1, N1 | H1 | Automated pass / review pending |
| INV-02 zero unsupported approved facts | S4, X1, E1, N1 | H1 | Automated pass / review pending |
| INV-03 immutable fact correction/history | S3, S4, N1 | H1 | Automated pass / review pending |
| INV-04 immutable definitions/jobs/variants/artifacts | S4, X1, N1 | H1 | Automated pass / review pending |
| INV-05 verified catalog/schema/digest/references | S2, S4, S6, X1, N1 | H1 | Automated pass / review pending |
| INV-06 canonical operation identity/idempotency | C2, S2, S4, S5, N1 | H1 | Automated pass / review pending |
| INV-07 CAS conflict without state change | C2, S2, S3, S4, N1 | H1 | Automated pass / review pending |
| INV-08 atomic catalog visibility | S2, X1, N1 | H1 | Automated pass / review pending |
| INV-09 truthful cancellation boundary | C2, S2, N1 | H1 | Automated pass / review pending |
| INV-10 non-enumerating denial | C2, S5, N1 | H1 | Automated pass / review pending |
| INV-11 named opaque capabilities/no generic paths | C2, S5, X1, E1, N1 | H1 | Automated pass / review pending |
| INV-12 untrusted content has no authority | C2, S3, S4, S5, X1, N1 | H1 | Automated pass / review pending |
| INV-13 maximum supporting sensitivity | C2, S3, S4, N1 | H1 | Automated pass / review pending |
| INV-14 deterministic atomic migration/downgrade block | C2, S6, N1 | H1 | Automated pass / review pending |
| INV-15 uninstall retention/new grant | S5, S6, X1, E1, N1 | H1 | Automated pass / review pending |
| INV-16 existing flows remain successful | T1, W1, P1, D1, M1, E1, D2, N1, N2 | H1 | Automated pass / review pending |
| INV-17 redacted logs/support bundles | C2, S2, S3, S4, S5, S6, X1, Q1, N1 | H1 | Automated pass / review pending |
| INV-18 Docker/selected-desktop logical parity | X1, D2, D3, N1, N2, N3 | H1 | Source/build parity pass / installed live pending |

## Ground-truth scenarios and security evidence

- M2 uses real temporary filesystems and a separate Node process. It covers first state,
  cross-process serialization, live/stale/expired leases, installation-bound operations,
  canonical equivalent/mismatched retries, CAS, pre/post-switch cancellation, corrupt catalog
  and revision digests, partial pointers, filesystem errors, invisible orphans, Git failure, and
  restart reconciliation.
- M2 store fault points: `afterTransactionStaged`, `beforeRecordPromote`,
  `afterRecordsPromoted`, `beforeCatalogCommit`, and `afterCatalogCommit`.
- M3 covers suggested/imported/rejected/confirmed/corrected facts, group partial review,
  source/sensitivity preservation, duplicates/conflicts, sparse/stale allowed context,
  adversarial text, path-free failure, and unchanged owner profile/Career files.
- M4 covers factual/presentation separation, 32 deterministic zero-unsupported seeds,
  12 deterministic graph-resolvability/concurrency seeds, immutable parent/job/fact lineage,
  superseded support, broken/cyclic graph rejection, rollback selection, artifact compatibility,
  safe export receipts, and inbound retirement guards.
- M5 covers all eleven named operations and missing/expired/revoked/wrong-audience/replayed/
  widened/substituted/forged authority denial, non-enumeration, operation scope binding,
  content-free audit validation, and owner-safe errors.
- M6 migration fault points: `after_snapshot`, `after_records`, `after_staged_catalog`,
  `after_marker`, and `after_catalog_switch`. It also covers unknown-field preservation,
  incompatible downgrade, history/export, backup/restore/import, whole-memory exclusion,
  update/rollback compatibility, corrupt retained state, uninstall retention, and fresh grants.
- X1 runs context projection, proposal, exact host-owner confirmation, approved general resume,
  hostile-shaped job data, targeted child, PDF preview/export receipt, integrity scan,
  uninstall/revocation, reinstall/fresh installation, and retained confirmed data. Its normalized
  response boundary rejects memory roots, raw job content fields, and app-supplied confirmation.
- E1 proves the sandbox resource sends the exact proposed `fact_revision_id`; this was the only
  acceptance defect found during the initial Linux/Docker verification. The red regression failed
  before the one-field fix and passed afterward. The full owner journey then passed through export,
  history, and direct reopen.
- The first native-Windows Spec 02 run exposed `EPERM` when the store called `fsync` through
  read-only handles after promoting/copying immutable files: 37 tests failed and 23 passed. A
  focused confirmation test reproduced the defect. Opening only those two copied-file handles as
  writable (`r+`) made the focused test green, then the complete native corpus passed 60/60. The
  same complete corpus, full runtime suite/build, and Docker M7 harness passed again afterward.
- The secret scan found zero findings. Existing content-free event and support-bundle tests pass.
  Generic memory tests still emit temporary filesystem paths in test-only generic-memory logs;
  Resume capability/domain responses and audited events remain path/content-free.

## M7 changes and decisions

- Added `resume-domain/resume-data-m7.test.ts`, an integrated real-filesystem parity harness.
- Added this verification record.
- Added one resource regression asserting exact fact-revision confirmation binding.
- Corrected the sandbox resource confirmation payload to include the exact proposed
  `fact_revision_id` required by the accepted M1/M3 contract.
- Corrected two store durability handles from read-only to writable before `fsync`, which preserves
  the existing atomic protocol while making it valid on native Windows.
- No schema, migration number, retention policy, permission name, provider behavior, renderer
  policy, public contract, or M8/future feature was introduced.

## Command notes, limits, and deviations

- Commands were run in this repository (`BrainDrive-Test-01`), not the different absolute
  checkout path printed in the prompt. This is the user-supplied active workspace and dirty M1–M6
  candidate.
- The first Docker exec attempt used the container default working directory and failed with
  `ENOENT` for `/app/package.json`. Re-running with the repository-defined `/app/typescript`
  working directory passed. This was an invocation correction, not a product failure.
- The TypeScript root has no `test:e2e` script. The accepted command exists in `client_web` and
  was run there successfully.
- No lint/format limitation remained: runtime/web ESLint and Rust format checks completed and
  passed. The web build retained only the previously recorded font-resolution and chunk warnings.
- Native dependency installation summaries reported 2 high-severity advisories for the runtime,
  4 for web, 1 for MCP, and 0 for the Resume package. They were not triaged in this build-only run,
  and no lockfile-mutating `npm audit fix` was attempted.
- Native `desktop:test` prepares runtime copies under the Tauri tree before invoking Vitest; its
  runtime phase discovered staged copies and therefore reported 67 files/453 tests rather than the
  canonical source suite's 73/467. It passed, but is not treated as a substitute for the separately
  passing native 60-test Spec 02 corpus or the canonical Linux 467-test regression.
- The existing Docker dev stack was healthy and reused; source is bind-mounted. It was not
  destroyed or rebuilt, and it remains running.
- No live provider/model call, production signing key, production publishing, or owner data was
  used. E2E is deliberately provider-independent and fixtures are synthetic.
- macOS and packaged Linux are configured but are not selected/claimed by the accepted ADR.
- The existing Windows checkout was heavily dirty and unrelated to this candidate, so it was left
  untouched. Native checks ran from an isolated copy whose pre-test inventory matched this source.
- After recording the installer names, sizes, hashes, and signature status, the task-owned isolated
  Windows copy and generated unsigned installers were removed. They are reproducible and were not
  retained or published as release artifacts.
- Native Windows source/data/package tests and the NSIS build passed. Installing the generated
  unsigned local package, then exercising live lifecycle, chooser/export, crash/restart,
  update/rollback, migration, uninstall/reinstall, and shutdown/orphan behavior was not authorized
  by the requested build test and was not run. `N3` remains open for release acceptance.
- Owner/security human review was not performed by the implementation agent. `H1` remains open.
- This record is committed with the implementation rather than as a later evidence-only revision.
  The formal release process must still produce and validate its immutable candidate proof.

## Release recommendation

**Do not release or mark M7 complete.** The Linux/Docker/native-Windows source corpus and native
Windows NSIS build are green, including a Windows-only durability defect found and fixed during
verification. Release acceptance still needs the formal immutable candidate proof,
installed-package live Windows acceptance (`N3`), and owner/security approval (`H1`). No product redesign or
excluded-scope work is indicated by the current evidence.

## Working-tree summary

The pre-commit staged candidate reports `66 files changed, 6913 insertions(+), 224 deletions(-)`.
This record is intended to be committed with that complete M1–M7 implementation scope.
