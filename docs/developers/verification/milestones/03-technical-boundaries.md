# Milestone 3 — Technical boundaries

This is a sanitized, revision-bound execution record. It is not product or technical authority.

## Candidate revision

- Branch: `dev`
- Base revision: `ba37f0893fbd`
- Candidate state: uncommitted working tree containing Milestones 0 through 2 and this dependency-block record. Commit, push, pull request, publication, external issue creation, and repository-settings changes were outside this prompt.

## Dependencies

- The required first command, `cd builds/typescript && npm run docs:verify`, passed with 72 of 72 tests and a composed check over 165 scoped candidates with zero diagnostics.
- The same verification explicitly confirms that `docs/developers/verification/milestones/02-developer-journeys.md` is structurally valid and must end blocked because a required claimed journey failed.
- Milestone 2 ends `BLOCKED`, not the terminal result required to begin Milestone 3.
- The blocking Milestone 2 evidence records two failed Tauri desktop journeys on the controlled WSL/Linux host: the embedded runtime became ready, but the frontend did not switch from the Vite proxy to the dynamic desktop gateway. The required usable desktop baseline was not reached.
- The specification, test plan, implementation plan, root instructions, scoped documentation instructions, Milestones 0–2 records, and the milestone-check skill were read completely before this record was written.

## Files changed

- Added this non-authoritative dependency-block record.
- Registered this record in `docs/developers/catalog.json`.
- Added a focused regression assertion in `tools/docs/test/evidence-harness.test.mjs` that requires Milestone 3 to remain blocked while Milestone 2 is blocked.
- No architecture, integration, gateway-contract history, MCP package, lifecycle, security-router, runtime, provider, installer, deployment, Tauri, auth, memory, or secrets content was authored or changed under Milestone 3.

## Commands and results

- `cd builds/typescript && npm run docs:verify`: exit 0; 72 tests passed; documentation validation passed with 165 scoped candidates and zero diagnostics. This is a passing automation result, not a waiver of the failed Milestone 2 journey.
- Tests-first focused run of `node --test tools/docs/test/evidence-harness.test.mjs`: exit 1; 13 tests passed and the new Milestone 3 dependency assertion failed because this record did not yet exist.
- First post-edit combined invocation from `builds/typescript`, `node --test tools/docs/test/evidence-harness.test.mjs && npm run docs:verify`: exit 1 before either suite completed because the root-relative focused-test path was resolved from the wrong working directory.

## Attempt 2 — corrected blocker-record verification

- Corrected root invocation, `node --test tools/docs/test/evidence-harness.test.mjs && npm --prefix builds/typescript run docs:verify`: exit 0; 14 focused tests passed, then all 73 documentation tests passed and the composed check passed over 166 scoped candidates with zero diagnostics.
- `node tools/docs/sync-generated.mjs --check`: exit 0; documentation projections matched the catalog.
- `tools/security/scan-secrets.sh --self-test` with a task-specific cache: exit 0; all scanner canary, redaction, checksum, version, shallow-history, and exception-scope guards passed; the cache was removed.
- `tools/security/scan-secrets.sh --current` with the same task-specific cache: exit 0; Gitleaks 8.30.1 inspected tracked and non-ignored worktree scope and reported zero findings; the cache was removed.
- `git diff --check`: exit 0.

## Reviews and adjudication

- Required gateway/engine, memory/secrets, provider/MCP/integration, and security specialist reviews were not started because the Milestone 2 prerequisite forbids entering Milestone 3 authoring and there is no Milestone 3 technical corpus to review.
- The required milestone-check objective result is `BLOCKED`: Phase 3 cannot proceed while its predecessor milestone has a failed required Tauri journey and a blocked terminal state.
- Prior Milestone 2 specialist passes remain evidence for Milestone 2 corrections only. They do not override the failed end-to-end journey and are not reused as Milestone 3 technical review.

## Global gates

- G-01: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-02: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-03: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-04: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-05: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-06: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-07: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-08: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-09: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-10: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-11: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-12: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-13: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-14: OPEN — FINAL ADJUDICATION IN MILESTONE 7

## Open items

- OPEN-03 remains blocked on the required Tauri journey. A supported graphical platform must demonstrate that the desktop frontend uses the dynamic embedded gateway and reaches the documented provider-independent baseline.
- Windows and macOS Tauri evidence remain absent. A focused automated test for the core dynamic desktop handoff also remains absent.
- OPEN-09 remains the Milestone 2 PowerShell lifecycle-reporting limitation, and OPEN-10 remains the missing reproducible isolated browser-E2E authentication fixture.
- OPEN-02 interface-maturity authority and OPEN-04 restricted-procedure routing were not investigated or adjudicated because Milestone 3 did not legally begin.

## Remaining risks

- Architecture, integration maturity, data-lifecycle, provider, MCP/tool, deployment, security-router, and gateway-contract migration deliverables remain unimplemented for Milestone 3.
- Advancing despite the blocked predecessor would allow green static checks to override a failed required journey, contrary to the non-compensating proof contract.
- The working tree remains intentionally uncommitted and includes earlier milestone changes. No external state was changed.

BLOCKED
