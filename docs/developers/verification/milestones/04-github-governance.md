# Milestone 4 — GitHub governance

This is a sanitized, revision-bound execution record. It is not product, governance, release, or technical authority.

## Candidate revision

- Branch: `dev`
- Base revision: `ba37f0893fbd`
- Candidate state: uncommitted working tree containing Milestones 0 through 3 and this dependency-block record. Commit, push, pull request, issue creation, publication, release, repository-settings, and branch-protection changes were outside this prompt.

## Dependencies

- Fresh revalidation, `npm --prefix builds/typescript run docs:verify`, passed with 73 of 73 tests and a composed check over 166 scoped candidates with zero diagnostics.
- Milestones 0 and 1 have valid completion terminal results. Milestones 2 and 3 both end `BLOCKED`.
- Milestone 3 does not end `MILESTONE 3 COMPLETE — NEXT LEGAL PROMPT: 4`, so the explicit Milestone 4 predecessor contract is unmet.
- Milestone 3 is blocked by Milestone 2, whose required Tauri journey failed twice after embedded-runtime readiness because the frontend did not use the dynamic desktop gateway. The provider-independent usable desktop baseline was not reached.
- The specification, test plan, implementation plan, root and scoped instructions, and Milestones 0–3 records were read completely in the current milestone sequence and revalidated before this record was written.

## Files changed

- Added this non-authoritative dependency-block record.
- Registered this record in `docs/developers/catalog.json`.
- Added a focused regression assertion in `tools/docs/test/evidence-harness.test.mjs` requiring Milestone 4 to remain blocked while Milestone 3 is blocked.
- No contribution policy, issue form, routing configuration, pull-request template, CI workflow, Dependabot configuration, ownership, governance, release, migration, history, version, deprecation, installer, runtime, or product behavior was changed under Milestone 4.

## Commands and results

- `npm --prefix builds/typescript run docs:verify`: exit 0; 73 tests passed; documentation validation passed with 166 scoped candidates and zero diagnostics. This passing static result does not waive the predecessor terminal contract.
- Tests-first focused run, `node --test tools/docs/test/evidence-harness.test.mjs`: exit 1; 14 tests passed and the new Milestone 4 dependency assertion failed because this record did not yet exist.
- `git rev-parse --is-shallow-repository`: exit 0; reported `false`.
- `git ls-files -s installer/docker/scripts/preflight-production-build.sh installer/docker/scripts/release-production.sh`: exit 0; both helpers remain tracked mode `100644`. Neither helper was executed, and no release invocation is represented as verified.

## Attempt 2 — blocker-record verification

- Corrected focused run, `node --test tools/docs/test/evidence-harness.test.mjs`: exit 0; all 15 focused tests passed.
- `npm --prefix builds/typescript run docs:test`: exit 0; all 74 documentation tests passed.
- `npm --prefix builds/typescript run docs:check`: exit 0; documentation validation passed over 167 scoped candidates with zero diagnostics.
- `npm --prefix builds/typescript run docs:verify`: exit 0; all 74 tests passed and the composed check again passed over 167 scoped candidates with zero diagnostics.
- `node tools/docs/sync-generated.mjs --check`: exit 0; documentation projections matched the catalog.
- `tools/security/scan-secrets.sh --self-test` with a task-specific cache: exit 0; scanner canary, redaction, checksum, version, shallow-history, and exception-scope guards passed.
- `tools/security/scan-secrets.sh --current` with the same task-specific cache: exit 0; Gitleaks 8.30.1 inspected tracked and non-ignored worktree scope and reported zero findings.
- `tools/security/scan-secrets.sh --history`: exit 3; the full-history scan inspected 279 reachable refs and reported one sanitized historical finding with disposition unreviewed and status open. The matched value was not printed or inspected. The task-specific cache was removed by the command trap.
- `git diff --check`: exit 0 when run separately after the history-scan failure stopped the combined command.

## Reviews and adjudication

- GitHub-workflow, documentation-governance, security, and release specialist reviews were not started because the Milestone 3 prerequisite forbids Milestone 4 authoring and there is no Milestone 4 governance or release corpus to review.
- AI review from prior milestones is not reused as human GitHub-reader, area-owner, security-aware, release-maintainer, platform, or repository-settings evidence.
- Milestone 4 has no mapped milestone-check invocation. Its objective dependency result is `BLOCKED` because the required Milestone 3 completion line is absent.

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

- OPEN-03 remains blocked on the required Tauri desktop journey and prevents completion of Milestones 2 and 3.
- OPEN-01 and OPEN-08 remain external: no authoritative current evidence confirms named GitHub owners or teams, CODEOWNERS enforcement, required checks, or branch-protection behavior.
- OPEN-04 remains unresolved: no authorized private procedure location or public escalation wording was supplied.
- OPEN-05 remains unresolved: Actions and evidence retention duration was not established.
- OPEN-07 remains unresolved: both release helpers are mode `100644`, and no authorized safe non-direct invocation was demonstrated.
- OPEN-09 and OPEN-10 remain the PowerShell lifecycle-reporting limitation and missing reproducible isolated browser-E2E authentication fixture recorded by Milestone 2.
- The sanitized full-history scanner finding remains unreviewed/open and requires authorized security review; no raw match was opened or retained in this record.

## Remaining risks

- Contribution, governance, release, ownership, freshness, deprecation, migration, branch/tag, version-domain, and same-PR deliverables remain unimplemented for Milestone 4.
- No positive or negative issue/PR specimen, migration disposition, representative tag comparison, public/restricted release review, or specialist adjudication exists for Milestone 4.
- The current worktree scan is clean, but the full-history scan is not clean; this record does not adjudicate or suppress the historical finding.
- Advancing would silently treat a blocked predecessor as complete and would allow static validation to override a failed required end-to-end journey.
- The working tree remains intentionally uncommitted and includes earlier milestone changes. No external state was changed.

BLOCKED
