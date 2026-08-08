# Resume Builder Milestone 8 Release Verification

Recorded: 2026-08-08

Candidate branch: `feature/resume-builder-app`

Implementation base: `6cc8f0f9a0703f6841df7b7145265c1793d478da`

Product version: `26.7.23`

Selected native target: Windows x64

## Recommendation

**HOLD — not ready for release approval.** Available source, browser, and Docker evidence is green, but the selected native Windows and required human evidence are absent. Release gates fail closed; owner approval of the specifications does not substitute for execution evidence.

The M1–M8 implementation is still an uncommitted working-tree candidate based on the revision above, so no immutable source-candidate revision exists yet. This report verifies the current workspace and does not authorize publication.

The machine-readable authority is [`contracts/fixtures/acceptance-evidence.json`](contracts/fixtures/acceptance-evidence.json). It enumerates REQ-001 through REQ-034 and INV-01 through INV-15 with automated test IDs, exact commands/results, environments, artifacts, and human evidence. Current adjudication is 18 requirements passed, 16 blocked, 14 invariants passed, and INV-13 blocked.

## Narrow Acceptance Corrections

1. Mounted the separately buildable Resume Builder fixture package read-only in Docker dev and made fixture UI loading lazy.
2. Added Docker/package/support-bundle boundary regression tests.
3. Removed rendered Compose configuration from support bundles, redacted host/storage/secret roots, and recorded the shell script as executable.
4. Replaced the obsolete requirement manifest and added an executable M8 evidence-matrix conformance test.

No production/staging configuration, provider choice, owner credential, marketplace, managed-hosting, import, job-discovery, cover-letter, application-tracking, browser-automation, additional-format, additional-OS, or unrelated platform behavior was added.

## Release Gates

| Gate | Result | Evidence / gap |
|---|---|---|
| RB-G1 Contract authority | Pass | Accepted Specs 1–5, accepted verification plan, M1 ADRs/contracts |
| RB-G2 Contract conformance | Pass | Main contract/security suites and valid/invalid fixtures |
| RB-G3 Package trust | Pass on source/Docker; release blocked | Signed/tampered/revoked/incompatible/widened-grant tests pass; selected native artifact absent |
| RB-G4 Data integrity | Pass | Fact authority, lineage, CAS, idempotency, migration, backup, retention, and unknown-field tests |
| RB-G5 Inference safety | Pass | Six-purpose broker/validator/adversarial harness; no tools, credentials, or fallback |
| RB-G6 MCP Apps boundary | Pass | Complete envelope/resource, sandbox, bridge, replay, origin, size, and fixed-tool regressions |
| RB-G7 Export correctness | Pass for deterministic/browser path; release blocked | Sanitization, reproducibility, ATS parse-back, browser export and cancellation pass; native chooser evidence absent |
| RB-G8 Runtime parity | Blocked | Docker live passes; native Windows package/live parity and shutdown/orphan evidence absent |
| RB-G9 Regression | Pass on available environment | Main, MCP, web, docs, desktop source/Rust, provider, memory, auth, and fixed-tool checks pass |
| RB-G10 Scope | Pass | Final API/package/config/diff review found no excluded feature or additional target claim |

## Available Live Evidence

- Docker dev gateway healthy with Resume Builder `3.0.0` active.
- Authenticated synthetic lifecycle probe passed install, update, LKG rollback, Career/direct launch, disable, enable, uninstall, and reinstall; process count was zero after disable and uninstall; retained owner data reopened.
- Unauthenticated app API request returned `401`.
- Active reconciled Docker state contained exactly one supervised fixture process.
- Support bundle `support-bundle-dev-20260808_005944.tar.gz` scanned with zero raw host paths, raw app/memory/secret-root paths, bearer tokens, or `sk-` credential strings.
- Isolated Playwright completed the Career entry, owner approvals, general and tailored definitions, browser PDF export, history, and direct reopen with synthetic data.
- Deterministic renderer checks passed sanitization, stable bytes, logical ordering, and exact ATS parse-back.

## Blocking Evidence

- `npm run desktop:build:windows` compiled the Rust release binary but correctly rejected the only installer as stale: expected `26.7.23`, found `BrainDrive_26.7.12_x64-setup.exe`.
- No native Windows signed artifact identity, installation, lifecycle, chooser/export, crash/restart, shutdown, or orphan evidence exists.
- No clean immutable source-candidate revision exists; the cumulative M1–M8 implementation remains uncommitted.
- No retained human-reviewed screenshots/video or owner review of trust/capability/retention/recovery copy exists.
- No human keyboard/screen-reader/contrast/responsive review exists.
- No human ATS document/private-sector writing-quality review exists.
- The complete generation-to-export journey ran in an isolated synthetic browser runtime, not as a live Docker provider-backed or native Windows journey. Live provider calls were not authorized and were not claimed.

## Verification Summary

- Main exact chain: pass — 66 Vitest files/396 tests; 21 web files/202 tests; builds, typechecks, desktop preflight; Rust 54 passed/1 intentional helper ignored.
- MCP release: pass — 2 files/6 tests and build.
- Resume Builder package: pass — 4 files/10 tests and build.
- Playwright: pass — mobile 12 passed/8 skipped; desktop Chrome 5 passed/5 skipped.
- Focused AI/adversarial/parse-back/provider harness: pass — 9 files/31 tests.
- Documentation: pass — 164 tests (163 passed/1 platform skip), zero diagnostics, generated projections current.
- Main and web ESLint, Rust formatting, Compose validation/start, support-bundle scan, and `git diff HEAD --check`: pass.
- Selected Windows package build/live smoke: blocked as described above.

## Recovery and Handoff

The last-known-good lifecycle path remains available, default uninstall retains declared owner data, and Docker dev is left healthy in its pre-verification running state. Release can be reconsidered only after a clean immutable candidate produces a signed Windows x64 `26.7.23` installer, native parity/live evidence passes, and the required human evidence is recorded against that same candidate.
