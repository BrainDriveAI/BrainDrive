# Milestone 6 — Validation integration

This is a sanitized, revision-bound execution record. It is not validator, CI, product, security, or release authority.

Prior attempt result: BLOCKED. That dependency-only attempt correctly stopped because Milestone 5 was incomplete. Milestone 5 has since been rerun independently and now supplies the required predecessor terminal result; this attempt performs original Prompt 6 rather than relabeling the prior attempt.

## Candidate revision

- Branch: `agent/developer-documentation-system`
- Base revision: `79fd0e3de2cd137b38b624552478d2ab13f775f1`
- Candidate state: uncommitted working tree containing the accepted Milestones 0–5 candidate plus this Milestone 6 validator, fixture, schema, CI, scanner, documentation, and record work.
- Local verification environment: WSL with Node `v20.20.1`. The repository and workflow contract requires Node 22; hosted Node 22 execution remains external evidence for Milestone 7.
- No commit, push, pull request, publication, repository-settings change, credential use, provider call, or Tier B/C execution occurred.

## Dependencies

- Milestones 0 through 5 have valid completion terminal results. Milestone 5 ends `MILESTONE 5 COMPLETE — NEXT LEGAL PROMPT: 6` and preserves its prior blocker as prose.
- The original prompt pack, specification, test plan, implementation plan, continuation prompt, root/scoped agent instructions, Milestone records 00–07, complete `tools/docs/` implementation and fixtures, catalog/corpus, package scripts, GitHub workflow/templates, security scanner, agent hierarchy, tracked input modes, and prior results were inspected before correction.
- Pre-edit `npm run docs:verify` passed with 111 tests passing and one Windows-only WSL skip; the composed check passed over 207 scoped candidates with zero diagnostics. This was baseline evidence only.
- The historical Milestone 7 dependency-block record remains untouched and still ends with its own blocked terminal result. Completing this predecessor does not auto-promote that later record.

## Files changed

- Validator/report: `tools/docs/check.mjs`, `tools/docs/ci-summary.mjs`, `tools/docs/lib/diagnostics.mjs`, `tools/docs/lib/markdown.mjs`, `tools/docs/lib/schema.mjs`, `tools/docs/lib/rules/authority.mjs`, `tools/docs/lib/rules/evidence.mjs`, and `tools/docs/lib/rules/structure.mjs`.
- Input/security boundary: `tools/docs/candidate-digest.mjs` and `tools/security/scan-secrets.sh` now reject regular files reached through an outside symlinked ancestor; terminal symlinks remain represented by link text without following their targets.
- Schemas/catalog: `tools/docs/schemas/catalog.schema.json`, new `tools/docs/schemas/verification-report.schema.json`, `docs/developers/catalog.json`, and `tools/docs/test/fixtures/catalog/valid-minimal.json`.
- Tests/fixtures: `tools/docs/test/authority.test.mjs`, `candidate-digest.test.mjs`, `catalog.test.mjs`, `evidence-harness.test.mjs`, `github.test.mjs`, `links.test.mjs`, and `tools/docs/test/fixtures/plain-source/{valid,website-only}.md`.
- CI/guidance: `.github/workflows/ci.yml` and `tools/docs/README.md`.
- Record: this file. Runtime, Tauri, installer, provider, auth, memory, web, and MCP product behavior were not changed.

### DA-01 through DA-18 result matrix

| Rule | Primary tests | Positive/negative fixture or mutation | Result | Safe diagnostic specimen |
|---|---|---|---|---|
| DA-01 | `catalog.test.mjs` composed matrix | Current catalog / remove required audience | PASS | `required audience route is missing` |
| DA-02 | `orientation.test.mjs`, composed matrix | Current route graph / point a journey at an undeclared path | PASS | `route ... points to an undeclared path` |
| DA-03 | `orientation.test.mjs`, composed matrix | Current orientation corpus / remove required search vocabulary | PASS | `required search term is missing` |
| DA-04 | `links.test.mjs`, composed matrix | Valid links/anchors / broken inline and reference-style targets; fenced headings excluded | PASS | `path does not exist` or `link anchor does not exist` with sanitized target |
| DA-05 | `catalog.test.mjs` | Minimal unique catalog / duplicate topic and authority fixtures | PASS | `topic is declared more than once` |
| DA-06 | `catalog.test.mjs`, `orientation.test.mjs` | Complete catalog / missing metadata and undeclared-property mutations | PASS | `canonical topic ... is missing metadata` |
| DA-07 | `authority.test.mjs`, composed matrix | Declared projection/mirrors / divergent mirror and undeclared-copy fixtures | PASS | `compatibility mirror differs from canonical authority` |
| DA-08 | `authority.test.mjs`, composed matrix | Product-agent classification / remove required existing-owner obligation | PASS | `requires the memory-template-existing-owner paired-change obligation` |
| DA-09 | `catalog.test.mjs`, `freshness-versioning.test.mjs` | Allowed current states / legacy current-route and incomplete deprecation mutations | PASS | `non-current topic status ... appears in a current route` |
| DA-10 | `commands.test.mjs`, composed matrix | Exact package scripts and bound paths / change `docs:check` contract | PASS | `package script docs:check must equal` |
| DA-11 | `commands.test.mjs`, composed matrix | Complete command descriptors / missing cleanup, target, authority, and recovery | PASS | `command descriptor is missing cleanup` |
| DA-12 | `github.test.mjs`, composed matrix | Valid issue/PR/CI contracts / incomplete governance and missing report cleanup | PASS | `Documentation job is missing explicit temporary report cleanup` |
| DA-13 | `github.test.mjs`, `freshness-versioning.test.mjs`, composed matrix | Substantive impact/no-impact decisions / remove migration dispositions | PASS | `document requires exactly one migration disposition` |
| DA-14 | `freshness-versioning.test.mjs`, composed matrix | Complete version domains / remove branch/tag contract and use later-dev link fixture | PASS | `lacks an explicit branch/tag contract` |
| DA-15 | `security-scope.test.mjs`, `github.test.mjs`, composed matrix | Safe provider language / unmistakably synthetic secret-shaped fixture and summary-redaction test | PASS | `sensitive or provider-unsafe content pattern detected; matched value is redacted` |
| DA-16 | `security-scope.test.mjs`, `candidate-digest.test.mjs`, `links.test.mjs`, scanner self-test, composed matrix | Git-derived contained inputs / forbidden family, outside symlink target, and ancestor-symlink mutations | PASS | `validation input was not read: path traverses a symlink` |
| DA-17 | `links.test.mjs`, composed matrix | Plain-source positive fixture / embedded construct, generic reference link, empty Markdown/HTML alt, multiple Mermaid, missing-H1, and fenced-example cases | PASS | `plain-source diagram requires an adjacent text alternative` |
| DA-18 | `evidence-harness.test.mjs`, `catalog.test.mjs`, composed matrix | Valid reports/templates/scorecards / malformed evidence, contradictory gates, duplicate capability IDs, invalid harness JSON | PASS | `scorecard must contain exactly one disposition and it must be pass` |

The table-driven composed test copies only Git-enumerated candidates to recoverable temporary repositories, introduces one isolated intended defect for each DA capability, and proves both the capability status and intended diagnostic. It supplements, rather than replaces, the focused positive and negative fixtures.

## Commands and results

- Tests-first focused validator run: exit 1 with five intended failures for missing schema keywords, missing report schema/matrix, absent DA-17 composition, leaked summary content, and absent plain-source export. The minimum implementations then made all focused cases pass.
- Cascade tests-first run, `node --test tools/docs/test/evidence-harness.test.mjs`: exit 1 because this record still ended with the prior blocked result. The corrected contract requires this prompt's own completion while leaving untouched Milestone 7 blocked.
- Specialist-driven failing probes confirmed report inconsistency acceptance, catalog unknown-field acceptance, contradictory AI scorecards, missing reference-style link/image handling, fenced-code false positives, cross-diagram alternative borrowing, absent DA-08 obligation enforcement, ancestor-symlink input escape, and unsafe ordinary report writes. Focused regression tests now cover each correction.
- Focused corrected run, `node --test tools/docs/test/candidate-digest.test.mjs tools/docs/test/authority.test.mjs tools/docs/test/catalog.test.mjs tools/docs/test/links.test.mjs`: exit 0; 35 passed and one Windows-only test skipped.
- Focused scorecard run, `node --test --test-name-pattern='AI scorecards' tools/docs/test/evidence-harness.test.mjs`: exit 0; both selected scorecard tests passed.
- All-rule composed run, `node --test --test-name-pattern='reaches every DA capability' tools/docs/test/catalog.test.mjs`: exit 0; all 18 isolated rule mutations reached their intended composed capability.
- Runtime baseline from `builds/typescript`, `npm run lint && npm test && npm run build`: exit 0; lint passed, 34 test files and 240 tests passed, and TypeScript build passed.
- Web baseline from `builds/typescript/client_web`, `npm run lint && npm run typecheck && npm test && npm run build`: exit 0; lint/typecheck passed, 17 test files and 178 tests passed, and Vite built successfully with existing font-resolution and chunk-size warnings.
- MCP baseline from `builds/mcp_release`, `npm test && npm run build`: exit 0; two test files and six tests passed, and TypeScript build passed.
- Secret scanner with a task-specific cache, `tools/security/scan-secrets.sh --self-test`: exit 0; detection, deletion-history, custom-rule, redaction, checksum, version, shallow-clone, exception-scope, and new ancestor-containment guards passed.
- Secret scanner, `tools/security/scan-secrets.sh --current`: exit 0; Gitleaks 8.30.1 inspected tracked and non-ignored worktree scope with zero findings.
- Secret scanner, `tools/security/scan-secrets.sh --history`: exit 3; all 288 locally reachable refs were inspected and the same single sanitized historical finding remains unreviewed/open. No matched value was printed or inspected. The task-specific cache was removed.
- Final `npm run docs:test` from `builds/typescript`: exit 0; 130 tests passed and one Windows-only compatibility test was skipped on WSL.
- Final `npm run docs:check` from `builds/typescript`: exit 0; 210 scoped candidates and zero diagnostics.
- Final `npm run docs:verify` from `builds/typescript`: exit 0; the same 130 passing tests/one platform skip were followed by a passing 210-candidate composed check.
- `node tools/docs/sync-generated.mjs --check`: exit 0; documentation projections matched the catalog.
- Final `node tools/docs/check.mjs --report /tmp/braindrive-docs-verification-report.json`: exit 0; status `pass`, 210 scoped candidates, zero diagnostics, DA-01 through DA-18 all `pass`, and file mode `0600`. A corrected sensitive-pattern inspection found no tested credential/owner-path patterns; only that exact temporary file was removed.
- Final portable scanner self-test: exit 0 with `containment_guard=pass`; final `tools/security/scan-secrets.sh --current`: exit 0 with zero findings. Each used a task-specific cache that was removed.
- `git ls-files -s AGENTS.md CLAUDE.md GEMINI.md docs/AGENTS.md`: exit 0; root/scoped authorities remain mode `100644` and compatibility mirrors remain mode `120000`.
- `git diff --check`: exit 0.

## Reviews and adjudication

- Node-testing review initially returned needs-correction for the historical record state, missing all-rule composed parity, DA-08/DA-18 false negatives, incomplete schema strictness, Markdown parsing gaps, and report-output safety. Every item received a focused regression and implementation correction. Final independent re-review passed the shortcut-reference, fenced-title/fence-length, private report-root, all-rule parity, cascade, schema, and report contracts with no remaining Node finding.
- GitHub-Actions review passed the structural contract: Node 22, exact verification/report/summary commands, preserved triggers and six existing jobs, no path filter, PR-only event fields, fail-closed summary behavior, no Tier B/C work, and no false required-check claim. A final independent delta review also passed the ordered `always()` report, summary, and bounded cleanup steps and confirmed that later successful steps cannot mask an earlier failure.
- Security/input-scope review initially returned needs-correction for ancestor symlink handling in candidate digest/current scan, insufficient report controls, and a GNU-only canonicalization option. The final independent re-review passed Node-based portable realpath containment, terminal-symlink handling, Git enumeration, exclusive mode-`0600` report creation, recursive redaction, sanitized errors, scanner self-test coverage, and CI cleanup.
- GitHub-Markdown review initially returned needs-correction for reference/shortcut links and images, HTML alternatives, per-diagram and indented/tilde Mermaid attribution, code-example false positives, fenced-only H1s, fence lengths, and missing BOM cases. The final independent re-review passed all corrected DA-04/DA-17 probes and the 13 focused link/plain-source tests.
- Hosted GitHub rendering/search, hosted Actions execution, and repository settings were not observed. Local structural reviews cannot satisfy OPEN-05 or OPEN-08.

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

- OPEN-05 remains open for hosted GitHub rendering, anchors, repository search, and actual collaboration-surface evidence.
- OPEN-08 remains open for required-check, branch-protection, ownership-enforcement, and hosted Actions evidence. Repository structure does not prove settings.
- The sanitized full-history scanner finding remains unreviewed/open and requires authorized security adjudication before final readiness.
- Node 22 execution remains a hosted/local environment evidence need; this WSL run used Node `v20.20.1` and does not impersonate CI.
- G-01 through G-14, human review, immutable-candidate proof, GitHub-platform proof, full-history disposition, and whole-trace release evidence remain Milestone 7 work.

## Remaining risks

- The working tree remains intentionally uncommitted and combines earlier accepted milestone changes with this milestone. No GitHub-visible candidate or immutable commit exists yet.
- Local structural Markdown checks cannot prove GitHub renderer, accessibility-tree, anchor-generation, or search-index behavior.
- The one sanitized historical secret-scan finding is still open; this milestone records it without opening, copying, or waiving it.
- Product baselines passed, but this milestone made no product-behavior claim and did not run Tier B/C journeys.
- Milestone 7 must rerun its original prompt against a frozen candidate; its existing historical blocker record is not success evidence.

MILESTONE 6 COMPLETE — NEXT LEGAL PROMPT: 7
