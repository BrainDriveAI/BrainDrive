# Resume Builder Milestone 8 Release Verification

Recorded: 2026-08-08

Candidate branch: `feature/resume-builder-app`

Implementation base: `6cc8f0f9a0703f6841df7b7145265c1793d478da`

Product version: `26.7.23`

Selected native target: Windows x64

## Recommendation

**HOLD — not ready for release approval.** Source, browser, Docker, and native Windows automated evidence is green, but the Windows installer is unsigned, installed-package acceptance is incomplete, and required human evidence is absent. Release gates fail closed; owner approval of the specifications does not substitute for execution evidence.

The immutable source candidate is revision `a227ec29ad10579fb8a86510b444c42f767a1c32`. It differs from the native-tested runtime revision `0646088c479d60475a997bac0ce604b0428cc2cb` only by registering this release report in the documentation inventory; the platform evidence is therefore carried forward under the repository's policy-only evidence rule. Native Windows evidence was collected in a task-specific clean checkout; the existing installation and the user's original Windows checkout were not modified. This report does not authorize publication.

The machine-readable authority is [`contracts/fixtures/acceptance-evidence.json`](contracts/fixtures/acceptance-evidence.json). It enumerates REQ-001 through REQ-034 and INV-01 through INV-15 with automated test IDs, exact commands/results, environments, artifacts, and human evidence. Current adjudication is 18 requirements passed, 16 blocked, 14 invariants passed, and INV-13 blocked.

## Narrow Acceptance Corrections

1. Mounted the separately buildable Resume Builder fixture package read-only in Docker dev and made fixture UI loading lazy.
2. Added Docker/package/support-bundle boundary regression tests.
3. Removed rendered Compose configuration from support bundles, redacted host/storage/secret roots, and recorded the shell script as executable.
4. Replaced the obsolete requirement manifest and added an executable M8 evidence-matrix conformance test.
5. Made atomic file stores tolerate only the documented unsupported Windows directory-sync errors while retaining file sync and strict failure behavior elsewhere.
6. Launched npm-backed isolated E2E and desktop runtime processes through Node on Windows instead of relying on direct `.cmd` spawning.
7. Added Windows process-tree termination to isolated E2E cleanup so failed and completed runs do not leave gateway or MCP children.
8. Normalized provider-card click focus across browser engines and added regression coverage.

No production/staging configuration, provider choice, owner credential, marketplace, managed-hosting, import, job-discovery, cover-letter, application-tracking, browser-automation, additional-format, additional-OS, or unrelated platform behavior was added.

## Release Gates

| Gate | Result | Evidence / gap |
|---|---|---|
| RB-G1 Contract authority | Pass | Accepted Specs 1–5, accepted verification plan, M1 ADRs/contracts |
| RB-G2 Contract conformance | Pass | Main contract/security suites and valid/invalid fixtures |
| RB-G3 Package trust | Pass on source/Docker; release blocked | Signed/tampered/revoked/incompatible/widened-grant tests pass; Windows installer exists but Authenticode reports `NotSigned` |
| RB-G4 Data integrity | Pass | Fact authority, lineage, CAS, idempotency, migration, backup, retention, and unknown-field tests |
| RB-G5 Inference safety | Pass | Six-purpose broker/validator/adversarial harness; no tools, credentials, or fallback |
| RB-G6 MCP Apps boundary | Pass | Complete envelope/resource, sandbox, bridge, replay, origin, size, and fixed-tool regressions |
| RB-G7 Export correctness | Pass for deterministic/browser path; release blocked | Sanitization, reproducibility, ATS parse-back, Windows browser export and cancellation pass; installed native chooser evidence absent |
| RB-G8 Runtime parity | Blocked | Docker live, native Windows suites, release-binary health, and zero-survivor shutdown pass; signed installed-package lifecycle/conformance remains unproved |
| RB-G9 Regression | Pass on selected automated environments | Linux and native Windows main/web/desktop/E2E, MCP, docs, provider, memory, auth, and fixed-tool checks pass |
| RB-G10 Scope | Pass | Final API/package/config/diff review found no excluded feature or additional target claim |

## Available Live Evidence

- Docker dev gateway healthy with Resume Builder `3.0.0` active.
- Authenticated synthetic lifecycle probe passed install, update, LKG rollback, Career/direct launch, disable, enable, uninstall, and reinstall; process count was zero after disable and uninstall; retained owner data reopened.
- Unauthenticated app API request returned `401`.
- Active reconciled Docker state contained exactly one supervised fixture process.
- Support bundle `support-bundle-dev-20260808_005944.tar.gz` scanned with zero raw host paths, raw app/memory/secret-root paths, bearer tokens, or `sk-` credential strings.
- Isolated Playwright completed the Career entry, owner approvals, general and tailored definitions, browser PDF export, history, and direct reopen with synthetic data.
- Deterministic renderer checks passed sanitization, stable bytes, logical ordering, and exact ATS parse-back.
- Native Windows desktop preflight/test passed: main 54 files/368 tests, web 21 files/202 tests, MCP build, Rust 54 passed/1 intentional helper ignored, and native containment.
- Native Windows Playwright passed on mobile Chromium/WebKit (12 passed/8 expected skips) and desktop Chromium (5 passed/5 expected skips), including the Resume Builder owner journey.
- The exact release binary packaged by NSIS reached `/health` HTTP 200 from isolated `APPDATA`/`LOCALAPPDATA`, reported runtime ready, had five child processes before close, and left zero surviving child PIDs after close (run `c8927ad9b3764687b158dcd41362508f`).
- Native NSIS build produced `BrainDrive_26.7.23_x64-setup.exe` at runtime revision `0646088c` (carried to documentation-only candidate `a227ec29`): 28,219,415 bytes, SHA-256 `5AFB289D0AB1428EC5075433A5C29590D7D12D93873CA4B5FBE93E44FE66AA6A`.

## Blocking Evidence

- The Windows installer has Authenticode status `NotSigned`; no signer identity exists, so RB-G3 and release approval remain blocked.
- The Windows machine already has BrainDrive `26.7.14` installed under the same product identity in `%LOCALAPPDATA%\BrainDrive`. Executing the candidate installer would upgrade/replace that installation. Windows Sandbox was unavailable, so the destructive installed-package step was not inferred from the user's general test authorization.
- Signed installed-package first install/update/LKG/recovery/uninstall/reinstall, native chooser/export, and the full desktop lifecycle/capability conformance corpus remain unexecuted. Therefore `INV-13` remains blocked even though isolated native shutdown left zero child processes.
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
- Native Windows installer build: pass — correct `26.7.23` NSIS artifact and stable alias produced; release blocked because the artifact is unsigned.
- Native Windows release-binary smoke: pass — health/runtime readiness and zero surviving child processes.
- Native Windows installed-package acceptance: not run — unsigned artifact plus same-identity collision with the existing `26.7.14` installation.

## Recovery and Handoff

The last-known-good lifecycle path remains available, default uninstall retains declared owner data, and Docker dev is left healthy in its pre-verification running state. Release can be reconsidered after candidate `a227ec29ad10579fb8a86510b444c42f767a1c32` (or an explicitly superseding candidate) produces a signed Windows x64 installer, the signed installer is exercised in a disposable/safely approved Windows target through lifecycle and native chooser flows, and the required human evidence is recorded against that same candidate. The current native build/runtime results materially reduce Windows implementation risk but do not satisfy the accepted packaged-desktop release gate.
