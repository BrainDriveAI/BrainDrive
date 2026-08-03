# Milestone 0 — Repository truth and validation foundation

This is a sanitized, revision-bound, non-authoritative execution record. Current source, tests, policies, package scripts, CI, and [`catalog.json`](../../catalog.json) remain authoritative for their respective contracts.

## Candidate revision

- Base commit: `ba37f0893fbde331675d8d209fb1abf375e0ecce`
- Branch: `dev`
- Candidate state: uncommitted Milestone 0 workspace changes on the base commit
- Execution date: 2026-07-31
- Environment: Linux workspace; local `node` reported v20.20.1, CI is configured for Node 22, and the complete suite was also executed explicitly with Node 22

## Dependencies

- Prior milestone records: none
- Inputs: accepted specification, refined test plan, implementation plan, root `AGENTS.md`, and live repository evidence
- External state: no repository settings, credentials, production systems, releases, issues, pull requests, or publishing changed

## Attempt 1 — tests-first foundation

The eight planned tests and synthetic fixtures were created before their rule implementations. The initial run failed because all planned validator module paths were absent. After no-op skeletons were added, 21 negative assertions still failed for their intended missing rules while 11 positive assertions passed. Implementing the first rule set produced 32 passing assertions; the first PR-body gate increased the suite to 33 assertions.

## Files changed

- Added the dependency-free validator, schemas, eight tests, synthetic fixtures, scenario manifest, and generated-projection checker under `tools/docs/`.
- Added scoped documentation instructions, the minimal developer index, catalog, evidence templates, and this record under `docs/`.
- Added the documentation issue form and updated the pull-request template.
- Added exact documentation package scripts and the Node 22 `Documentation` CI job.
- Did not create `.github/CODEOWNERS`; confirmed handles or teams are not available.

## Repository inventory and authority decisions

| Evidence | Before | Milestone 0 candidate |
|---|---:|---:|
| Tracked/current non-fixture Markdown candidates | 66 | 73 |
| Catalog inventory entries | 0 | 73 |
| Documentation-specific tests | 0 | 8 files / 49 assertions |
| Documentation CI jobs | 0 | 1 |

| Surface | Decision |
|---|---|
| `AGENTS.md` | Canonical root coding-agent authority |
| `CLAUDE.md`, `GEMINI.md` | Symlink/exact-mirror compatibility aliases only |
| `docs/AGENTS.md` | Scoped supplement below `docs/` |
| `docs/developers/catalog.json` | Sole machine-readable topic, route, lifecycle, owner-role, mapping, alias, and command registry |
| Starter-pack `AGENT.md` and Markdown | Tracked product artifacts, not repository coding or developer-documentation authority |
| `README.md`, `docs/tailscale-remote-access.md`, installer/operator pages | Product/operator material retained and classified; not promoted into cross-cutting developer authority |
| TypeScript provider-first setup pages | Legacy entries pending later milestone migration |
| Gateway client contract and MCP package maturity | Unresolved; no supported/public promise inferred |
| Milestone records | Sanitized execution traces only |

## Commands and results

| Command | Actual result |
|---|---|
| `git branch --show-current` | Exit 0; `dev` |
| `git status --short` before edits | Exit 0; clean |
| `node --test tools/docs/test/*.test.mjs` before modules | Exit 1; all eight planned test files failed on absent module paths |
| `node --test tools/docs/test/*.test.mjs` with no-op skeletons | Exit 1; 11 passed and 21 intended negative assertions failed |
| `node --test tools/docs/test/*.test.mjs` after rule implementation | Exit 0; 32 passed, 0 failed |
| `node tools/docs/sync-generated.mjs --check` | Exit 0; declared projection matched the catalog |
| `cd builds/typescript && npm run docs:test` | Exit 0; 32 passed, 0 failed before the PR-body assertion was added |
| `cd builds/typescript && npm run docs:check` before this record existed | Exit 1; only the missing record path and its inbound link were reported |

Final complete command results are appended in a later attempt section after specialist review and objective milestone verification.

## Reviews and adjudication

- Documentation-validation engineer, first independent AI review: `NEEDS CORRECTION`; found unapplied schemas, omitted composed rules, weak PR decisions/freshness mapping, incomplete catalog integrity, an ineffective exclusion canary, and incomplete authority/governance coverage.
- GitHub workflow reviewer, first independent AI review: `NEEDS CORRECTION`; found a heading-only PR bypass, non-actionable summary output, and unenforced community routing.
- Security/scope reviewer, first independent AI review: `NEEDS CORRECTION`; found missing lexical/realpath containment, unsafe direct reads, diagnostic disclosure risk, an ineffective exclusion proof, and narrow evidence sanitization.
- AI reviews are not human evidence. Human GitHub rendering, named-owner enforcement, platform journeys, and final release review remain open.

## Attempt 2 — specialist correction tests

Correction tests were added before changing the implementations. Focused runs failed for the intended gaps: malformed schema inputs, an empty harness, unchanged/comment-only PR content, missing no-impact rationale, path escapes, symlink targets, a false ignored-path canary, and composed rule omissions. The corrections then:

- applied the dependency-free schemas and expanded catalog route, owner, status, source/test/command, governance, and search integrity;
- composed duplication and pull-request source-to-document freshness checks;
- required substantive PR impact and exact evidence, with an explicit no-impact reason;
- generated sanitized, actionable CI diagnostics;
- enforced lexical and resolved repository containment, regular-file inputs, symlink rejection, safe projection writes, and redacted link diagnostics;
- exercised a real temporary Git repository to prove ignored owner, credential, generated, vendor, and restricted paths are excluded;
- extended current-authority link/security checks and evidence sanitization.

The resulting suite passed 46 assertions, and the repository check passed with 150 scoped candidates and zero diagnostics.

## Attempt 3 — final specialist corrections

Final re-review found three additional false-negative paths. New regression tests were added first and failed as intended:

- catalog document/governance status, alias target, source-mapping target, duplicate identifier, and version-domain mutations were not rejected;
- a symlinked current authority was diagnosed by one rule but still read by the composed checker;
- a failing `docs:verify` test step could be followed by a passing repository report and a misleading PASS summary.

The final implementation validates those catalog relationships, guards every composed and nested repository input before reading, normalizes the repository root, and combines the `docs:verify` step outcome with the repository report. The suite now passes 49 assertions.

## Final specialist re-reviews

- Documentation-validation engineer: `PASS`; focused catalog mutations fail closed, false PASS CI evidence is prevented, 49/49 tests pass, projections match, and the repository check reports zero diagnostics.
- GitHub workflow reviewer: `PASS`; PR decisions, issue routing, preserved triggers/jobs, exact commands, Node 22, sanitized actionable reporting, and failed-step outcome propagation were independently verified.
- Security/scope reviewer: `PASS`; path containment, realpath checks, symlink rejection, read-after-validation, redaction, Git-derived exclusion proof, provider safety, and changed-path scope were independently verified.
- All three are independent AI evidence only. No human review or hosted GitHub workflow result is claimed.

## Final commands and results

| Command | Actual result |
|---|---|
| `cd builds/typescript && npm run docs:test` | Exit 0; 49 passed, 0 failed |
| `cd builds/typescript && npm run docs:check` | Exit 0; PASS, 150 scoped candidates, 0 diagnostics |
| `cd builds/typescript && npm run docs:verify` | Exit 0; 49 passed, then PASS with 0 diagnostics |
| Node 22 direct test and check through an isolated task cache | Exit 0; 49 passed; PASS with 150 scoped candidates and 0 diagnostics; cache removed |
| `node tools/docs/sync-generated.mjs --check` | Exit 0; declared projections match the catalog |
| `node tools/docs/check.mjs --report /tmp/braindrive-docs-verification-report-final.json` | Exit 0; sanitized report status `pass`, 555 Git candidates, 150 scoped candidates, 0 diagnostics |
| CI summary with verification outcome `success`, then `failure` | PASS for the successful step; FAIL for the failed step even though the repository report was passing |
| `tools/security/scan-secrets.sh --self-test` with isolated cache | Exit 0; current/history/custom canaries detected; redaction and all guards passed; cache removed |
| `tools/security/scan-secrets.sh --current` with isolated cache | Exit 0; Gitleaks 8.30.1; tracked/non-ignored worktree; 0 findings; cache removed |
| JSON parse of catalog, schemas, harness, and JSON fixtures | Exit 0 |
| YAML parse of CI and documentation issue form with repository-installed `js-yaml` | Exit 0; two files parsed |
| `ruby` YAML parser probe | Unavailable: `ruby: command not found`; repository-installed `js-yaml` provided the successful parse evidence |
| `git diff --check` | Exit 0 |
| `git ls-files --stage AGENTS.md CLAUDE.md GEMINI.md tools/docs docs/developers .github/CODEOWNERS .github/ISSUE_TEMPLATE` | Existing agent hierarchy and issue forms reported; new foundation files are intentionally untracked because staging was not authorized; no CODEOWNERS entry exists |
| mode and link inspection for `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` | Root authority is regular mode 100644; both aliases remain mode 120000 symlinks targeting `AGENTS.md` |

## Objective milestone check

- Result: `PROCEED` for Milestone 0.
- Basis: all milestone-scoped structure, validator, negative-fixture, command, CI-contract, projection, sanitization, secret-boundary, and independent-review checks pass on the candidate workspace.
- This result does not close any global gate and does not authorize later milestones, publication, repository-setting changes, or release actions.

## Candidate-input boundary

- Enumeration begins with `git ls-files --cached --others --exclude-standard -z`.
- Rule evaluation narrows that list to declared Markdown, agent, GitHub-governance, package-script, and `tools/docs/` paths.
- The manifest excludes ignored paths, `docs/Security/`, owner memory, backups, credential paths, generated output, and vendored dependencies without reading their contents.
- Synthetic negative fixtures are non-authorizing and diagnostics name only rule/path and redacted context.

## Global gates

| Gate | State |
|---|---|
| G-01 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-02 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-03 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-04 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-05 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-06 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-07 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-08 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-09 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-10 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-11 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-12 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-13 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |
| G-14 | OPEN — FINAL ADJUDICATION IN MILESTONE 7 |

## Open items

| Item | State |
|---|---|
| OPEN-01 | Open — named GitHub owners/teams and review enforcement unconfirmed |
| OPEN-02 | Open — interface maturity and compatibility promises unconfirmed |
| OPEN-03 | Open — native, Docker, and Tauri evidence environments unconfirmed |
| OPEN-04 | Open — restricted-procedure location and public escalation wording unconfirmed |
| OPEN-05 | Open — evidence retention duration and restricted store unconfirmed |
| OPEN-06 | Open — Playwright port 3000 versus runtime documentation port 8787 unresolved |
| OPEN-07 | Open — release-helper direct invocation versus tracked mode 100644 unresolved |
| OPEN-08 | Open — CODEOWNERS and required-check repository settings unconfirmed |

## Remaining risks

- A hosted GitHub Actions run was not created because commits, pushes, and pull requests were outside the authorized scope; Node 22 behavior was verified locally instead.
- Human GitHub rendering/search, named-owner enforcement, and required-check repository settings are not established by local validation.
- The new files remain untracked until an authorized staging/commit step. No commit or external mutation was performed.
- Milestone 0 validates the authority/catalog/governance foundation only; later corpus, platform-journey, human-review, and release gates remain open.

MILESTONE 0 COMPLETE — NEXT LEGAL PROMPT: 1
