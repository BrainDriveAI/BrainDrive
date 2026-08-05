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

Prior attempt result: BLOCKED

## Attempt 3 — original Prompt 4 rerun

### Candidate revision and dependency revalidation

- Branch: `agent/developer-documentation-system`.
- Base and current committed revision: `79fd0e3de2cd137b38b624552478d2ab13f775f1`; the candidate is the uncommitted repository-controlled documentation worktree on that revision.
- Milestone 3 was revalidated and ends `MILESTONE 3 COMPLETE — NEXT LEGAL PROMPT: 4`. This permits the original Prompt 4 rerun; it does not rewrite this record's earlier blocked attempt.
- The pre-edit `npm run docs:verify` baseline passed with 85 tests, one Windows-only skip, zero failures, and 183 scoped candidates with zero diagnostics.
- The repository is a full-history clone (`git rev-parse --is-shallow-repository` returned `false`). No branch, commit, push, pull request, issue, tag, release, credential use, repository setting, branch protection, or external GitHub state was created or changed.

### Files changed for Milestone 4

- Collaboration surfaces: `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/documentation.yml`, and `.github/pull_request_template.md`.
- Current developer authority and routes: `docs/developers/README.md`, `docs/developers/governance.md`, `docs/developers/releases.md`, `installer/docker/scripts/README.md`, and `docs/developers/catalog.json`.
- Validators and schemas: `tools/docs/check.mjs`, `tools/docs/lib/rules/github.mjs`, `tools/docs/lib/rules/freshness.mjs`, `tools/docs/lib/rules/versioning.mjs`, and `tools/docs/schemas/catalog.schema.json`.
- Tests and fixtures: `tools/docs/test/github.test.mjs`, `tools/docs/test/freshness-versioning.test.mjs`, `tools/docs/test/governance-release.test.mjs`, `tools/docs/test/evidence-harness.test.mjs`, the valid catalog/GitHub/freshness fixtures updated for the new contracts, and new incomplete governance, migration, and release-domain fixtures.
- Evidence: this Milestone 4 record. Existing Milestone 3 and technical-boundary work in the same intentionally dirty worktree was preserved and not attributed to Prompt 4.
- No `.github/CODEOWNERS` was added because no authoritative current repository evidence identifies real GitHub users or teams. Product behavior, release packaging, and restricted release procedures were not changed.

### Tests-first workflow specimens and enforcement

- The first focused red run, `node --test tools/docs/test/github.test.mjs tools/docs/test/freshness-versioning.test.mjs tools/docs/test/governance-release.test.mjs`, produced 12 passes and 8 intended failures. Missing request classification, separate automated/manual evidence, migration/configuration/provider/security/release/risk fields, migration dispositions, version-domain contracts, and canonical governance/release routes were detected before authoring.
- Positive issue specimen: the repository documentation form contains the required request type and public-safe route fields, retains community-support and Private Vulnerability Reporting routes, and requires existing-issue plus sanitized-evidence acknowledgments. Repository contract validation returns zero diagnostics.
- Negative issue specimen: `tools/docs/test/fixtures/github/incomplete-governance/contract.json` omits the request classification and implication/evidence fields; it produces nine DA-12 diagnostics without echoing sensitive fixture content. A structural regression also rejects a checkbox stranded under `validations` rather than `preflight.attributes.options`.
- Positive PR specimen: a populated body with documentation impact, separate automated/manual evidence, migration/configuration/provider/security/release implications, and remaining risk produces zero diagnostics. A substantive exact `No documentation impact` decision with a scoped reason is also accepted.
- Negative PR/docs-impact specimens reject blank, comment-only, one-character, missing-implication, missing-risk, and missing no-impact-reason bodies. A no-impact reason attached to an unrelated impact declaration cannot bypass the governed source-to-document mapping.
- The dependency-free issue-form structural validator preserves the clean-checkout Documentation CI contract. The PR-body validator requires substantive contents for all declared fields, and freshness receives a no-impact reason only when the impact declaration explicitly selects `No documentation impact`.

### Governance, ownership, migration, and version evidence

- `CONTRIBUTING.md` now classifies reproducible bugs, documentation defects, support requests, early proposals, accepted work, and suspected vulnerabilities; it defines the `dev` workflow, applicable instructions, source/caller/config/test/persistence inspection, minimal diffs, proportional checks, same-PR documentation, exact evidence, and remaining-risk reporting.
- `docs/developers/governance.md` makes the catalog the sole machine-readable documentation registry, declares public role responsibilities and required reviews, and defines same-PR/no-impact, projection, duplication, correction, branch/tag, deprecation, history, and migration rules. Repository files do not claim GitHub enforcement.
- The catalog contains 101 Git-derived non-fixture Markdown documents for 101 discovered candidates. Zero pages are absent from inventory, and freshness validation reports zero missing or conflicting classification dispositions. Retain, reclassify, and relocate policies cover every current classification exactly once; retirement remains an explicit governance outcome but no current file was silently assigned to it.
- Legacy provider-first and setup entry files remain visible stable pointers. The former gateway contract remains a pointer to current authority with its useful original body preserved under `docs/developers/history/`. `docs/tailscale-remote-access.md` remains a normal-user/operator guide, not developer authority.
- Version domains remain distinct: the representative `26.7.23` tag contains app, web, and Tauri versions `26.7.23`; current MCP package version is `1.0.0`. The tag resolves to `ff43e8d11508e87167265aa6c4a647059f0279f5` and is not an ancestor of the candidate, so it is recorded only as representative comparison evidence, not current release lineage.
- Deprecation records now state lifecycle status, replacement, migration guidance, compatibility implications, and removal state. Branch files describe their branch, tag files describe their tag, and later `dev` truth may not silently stand in for tagged guidance.

### Release evidence and boundary

- `git ls-files -s installer/docker/scripts/preflight-production-build.sh installer/docker/scripts/release-production.sh` reports mode `100644` for both helpers. Direct `./...` execution is not the repository contract.
- Safe demonstrated probes, `bash ./installer/docker/scripts/preflight-production-build.sh --help` and `bash ./installer/docker/scripts/release-production.sh --help`, both printed usage and exited 0 before dependency installation, Git mutation, Docker login/build/push, version rewrites, signing, or publication.
- `docs/developers/releases.md` separates app/web/Tauri, MCP, and installer domains; defines public tag/artifact/digest/signature trust statements; uses copy-runnable quoted tag-comparison commands; and keeps production preflight, release, signing, publication, credentials, private infrastructure, and recovery procedures inside a separately authorized Tier C release-maintainer boundary.
- Focused release tests enforce both Git modes, exact explicit-Bash help commands, Tier A/no-credential/no-write semantics, and rejection of direct invocation. OPEN-07 is therefore `resolved-static-nondirect`; production preflight and release execution remain unverified and restricted.

### Reviews and adjudication

- GitHub-workflow review initially found an invalid documentation-form indentation, substring-only form checking, incomplete PR-field validation, and a no-impact freshness bypass. All four findings were reproduced, corrected, and covered by focused regressions.
- Documentation-governance review independently confirmed those defects and verified catalog authority, role honesty, complete 101-of-101 inventory, migration disposition, Tailscale classification, stable pointers/history, and public/restricted separation after correction.
- Security review additionally rejected a proposed transitive YAML-parser dependency because clean Documentation CI does not install it, and flagged non-runnable angle-bracket tag placeholders. The implementation returned to dependency-free Node tooling and changed the comparison to a quoted task-specific tag variable. Security re-review passed with no remaining correction.
- Release review required executable tests for mode `100644` and the exact Tier A help contract. Those tests were added; release re-review passed. Nonblocking residuals are explicit: helper-native usage banners use `./...`, Tauri version equality is manually reviewed rather than automated, and the representative tag is non-ancestor comparison evidence only.
- These read-only AI specialist reviews are defect-finding evidence, not human GitHub-reader, area-owner, security-aware, release-maintainer, platform-settings, or release-execution evidence.
- Milestone 4 has no mapped milestone-check invocation. The installed milestone-check skill supplied independent verification discipline only; it is not recorded as an approval gate.

### Final commands and results

- `node --test tools/docs/test/evidence-harness.test.mjs tools/docs/test/github.test.mjs tools/docs/test/freshness-versioning.test.mjs tools/docs/test/governance-release.test.mjs`: exit 0; 43 focused tests passed.
- `npm run docs:test` from `builds/typescript`: exit 0; 99 passed, the Windows-only structural-link test skipped on WSL, and zero failed.
- `npm run docs:check` from `builds/typescript`: exit 0; validation passed over 189 scoped candidates with zero diagnostics.
- `npm run docs:verify` from `builds/typescript`: exit 0; the same 99 passes, one platform skip, and zero failures were followed by the same 189-candidate, zero-diagnostic composed check.
- `node tools/docs/sync-generated.mjs --check`: exit 0; documentation projections match the catalog.
- `tools/security/scan-secrets.sh --self-test` with a task-specific cache: exit 0; canary, redaction, checksum, version, shallow-history, and exception-scope guards passed.
- `tools/security/scan-secrets.sh --current` with a task-specific cache: exit 0; Gitleaks 8.30.1 inspected tracked and non-ignored worktree scope and reported zero findings.
- `tools/security/scan-secrets.sh --history` in this full clone with a task-specific cache: exit 3; 288 reachable refs produced one sanitized historical finding in a historical environment-file path, disposition `unreviewed`, reviewer `required`, status `open`. The matched value was neither printed nor inspected. This fails the full-history security gate closed for Milestone 7; it does not make the current repository-controlled Milestone 4 documentation contracts false.
- `git diff --check`: exit 0.

### Global gate carry-forward

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

### Open items and remaining risks

- OPEN-01 remains open: named GitHub owners/teams and actual review enforcement are unconfirmed; public role ownership does not invent handles.
- OPEN-04 remains open: the authorized private release-procedure location and approved public escalation wording are unconfirmed.
- OPEN-05 remains open: Actions/evidence retention duration and restricted evidence-store location are unconfirmed.
- OPEN-07 is resolved only for static explicit-Bash help invocation. No production preflight, release, publish, signing, tag movement, registry access, or credentialed operation was run or claimed.
- OPEN-08 remains open: no local file proves CODEOWNERS enforcement, required checks, or branch protection in GitHub settings.
- OPEN-03 remains `DEFERRED — REQUIRED BEFORE MILESTONE 7` for native Windows and macOS J-05 evidence. The prior WSL failure remains diagnostic evidence; Milestone 4 does not broaden or close platform claims.
- The sanitized historical scanner finding remains unreviewed and open for authorized security adjudication before final readiness. Current worktree scanning is clean; this record does not suppress the history failure or expose its matched value.
- Milestone 5 remains its untouched historical dependency-block attempt until original Prompt 5 is rerun. Completing Milestone 4 does not promote Milestones 5–7 or satisfy AIH, human-review, GitHub-platform, immutable-candidate, or release-gauntlet requirements.
- The worktree remains intentionally uncommitted and contains preserved earlier milestone changes. External GitHub rendering/settings, human role review, and restricted release execution remain outside this evidence.

MILESTONE 4 COMPLETE — NEXT LEGAL PROMPT: 5
