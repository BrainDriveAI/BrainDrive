# Milestone 5 — AI agent system

This is a sanitized, revision-bound execution record. It is not product, repository-instruction, harness, or technical authority.

Prior attempt result: BLOCKED

## Candidate revision

- Branch: `agent/developer-documentation-system`
- Base revision: `79fd0e3de2cd137b38b624552478d2ab13f775f1`
- Scenario candidate proof: `candidate-content sha256 d83e1a6aaabb13c4e8c158195e59de28c05bcaae21d7a0cac6bbb48430645dc8; entries 59; head 79fd0e3de2cd137b38b624552478d2ab13f775f1`
- Final affected AIH-05 rerun proof: `candidate-content sha256 54835e0d302cd46cf3ed776048ea00ff3d48bc9a0bfad605de0f8ed537339a65; entries 59; head 79fd0e3de2cd137b38b624552478d2ab13f775f1`
- Candidate state: uncommitted working tree containing preserved Milestones 0–4 work, the Milestone 5 implementation, and evidence outputs. Commit, push, publication, provider use, external administration, and ignored-data access were outside this prompt.
- After the frozen AIH runs, evidence packaging, scorecard catalog registration, the conditional Milestone 5-to-6 cascade assertion, and a mechanical correction from a nonexistent provider-UI caller to the tracked `AppShell` caller changed. AIH-05 was rerun against the final affected candidate; the other nine runs were carried forward because their prompts, rubrics, allowed contexts, mapped routes, and check contracts were unaffected. Full documentation verification remains required after packaging.

## Dependencies

- Milestone 4 ends `MILESTONE 4 COMPLETE — NEXT LEGAL PROMPT: 5`; Prompt 5 was therefore legal to run.
- Root and scoped instructions, original planning inputs, Milestones 00–04, the AIH manifest/schema/procedure, catalog, live scripts, CI, and the milestone-check skill were read or revalidated before implementation.
- Pre-edit `npm run docs:verify` passed with 99 tests, one Windows-only skip, and zero documentation diagnostics.
- Local Node is `v20.20.1`, while the catalog and CI contract require Node 22. Local results are retained honestly and do not claim Node 22 CI execution.

## Files changed

- Reconciled concise agent routes in `AGENTS.md` and additive harness routing in `docs/AGENTS.md`; compatibility mirrors remain symlinks to the root authority.
- Added `docs/developers/verification/ai-agent-harness.md`, ten scorecards under `docs/developers/verification/ai-agent-scorecards/`, and the expanded scorecard template.
- Added the machine-readable `agentContract`, scorecard registrations, source/test/check routes, provider negative guarantees, paired memory disposition, restricted exclusions, and catalog commands in `docs/developers/catalog.json`.
- Added strict harness/catalog schemas, candidate-content binding in `tools/docs/candidate-digest.mjs`, evidence/authority/security validation, focused fixtures, and tests including `agent-contract.test.mjs` and `candidate-digest.test.mjs`.
- Updated the conditional milestone cascade test so this completed rerun does not promote untouched Milestone 6. Milestones 6 and 7 remain historical blocker attempts until their prompts run.
- No runtime, provider, Tauri, installer, auth, memory, or product behavior was modified for Milestone 5.

## Commands and results

- Tests-first agent-contract run: exit 1 with six intended contract failures after the candidate-enumeration exclusion passed.
- Tests-first route-completeness run: exit 1 on missing web adapter/executor members and missing scorecards.
- Tests-first cascade run: exit 1 because this record still ended with its historical blocker result.
- Candidate digest/security focused run: exit 0; eight tests passed, including content-change, untracked-addition, deletion, stable-rerun, ignored-family, and provider-safety cases.
- Post-scorecard focused run, `node --test tools/docs/test/agent-contract.test.mjs tools/docs/test/evidence-harness.test.mjs`: 26 tests passed; only the intentionally red Milestone 5 terminal assertion remained before this record was updated.
- `npm run docs:test`: exit 0; 112 tests, 111 passed, one expected Windows-only skip, zero failed.
- `npm run docs:check`: exit 0; 207 scoped candidates, zero diagnostics.
- `npm run docs:verify`: exit 0; the composed documentation test and validation contract passed with the same 112-test/207-candidate results.
- `node tools/docs/sync-generated.mjs --check`: exit 0; documentation projections match the catalog.
- `tools/security/scan-secrets.sh --current` with an isolated temporary Gitleaks cache: exit 0; Gitleaks 8.30.1 scanned tracked and non-ignored worktree content and found zero findings.
- Agent compatibility check: exit 0; `AGENTS.md` remains mode `100644`, `CLAUDE.md` and `GEMINI.md` remain mode `120000`, and both resolve to `AGENTS.md`.
- `git diff --check`: exit 0 with no whitespace errors.
- Final `node tools/docs/candidate-digest.mjs`: exit 0 with `candidate-content sha256 54835e0d302cd46cf3ed776048ea00ff3d48bc9a0bfad605de0f8ed537339a65; entries 59; head 79fd0e3de2cd137b38b624552478d2ab13f775f1`.

## Reviews and adjudication

- Ten accepted scenario executions used ten separate fork-none evaluator contexts. AIH-01 through AIH-10 each passed every declared binary gate; no aggregate score compensated for a failed dimension.
- Invalid attempts remained separate: an unsafe broad traversal, pre-fix tracked-context failures, candidate drift, a prior-evidence test read, bounded timeouts, and thread-limit failures were never relabeled as passing evidence.
- Authority specialist review found missing scorecard enforcement, weak candidate binding, incomplete scope semantics, and restricted-exclusion drift. The composed validator now opens every declared scorecard, compares the exact prompt/required fields/rubric, enforces exact instruction scope/kind/precedence and symlink semantics, and checks the complete restricted families.
- Repository-architecture specialist review found missing web adapter/executor, MCP client/configuration, provider, memory, and test routes. The catalog routes and data-driven validator assertions now enumerate those live surfaces and disclose the absent starter-pack updater and MCP registration coverage.
- Verification-selection specialist review found an unchecked MCP command, over-broad package verification, an absent integration entrypoint, and incomplete AIH-08 evidence. MCP package verification is now a registered Node 22 command, package-only and runtime-integrated routes are distinct, the absent target remains blocked, and AIH-08 retains the full three-surface matrix and omissions.
- Security/provider specialist review found path-set-only binding, incomplete ignored families, and missing client provider safety routing. Candidate proof now hashes HEAD plus candidate content while excluding self-referential evidence outputs, ignored families match Git scope, and provider UI/negative guarantees require web verification where applicable.
- Advisory findings retained as risk: no focused MCP registration test, no live provider proof, several candidate canonical pages remain uncommitted, local Node is not 22, and extra IPv6/private-shape hardening remains future defense in depth.
- Required milestone-check objective result: PASS. Repository-controlled Phase 4 AI-agent criteria are satisfied, AIH evidence is 10/10, predecessor Milestone 4 is complete, the full documentation gate passes, and global release gates remain deliberately open for Milestone 7. Recommendation: proceed to original Prompt 6.
- Coverage percentage is not configured for the documentation validator. Tests-first negative fixtures, route assertions, scorecard content validation, candidate-digest mutation cases, and the full documentation suite provide the applicable proof.

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

- OPEN-01, OPEN-02, OPEN-04, OPEN-05, OPEN-08, OPEN-09, and OPEN-10 retain their catalog states; Milestone 5 does not invent ownership, compatibility, retention, platform, PowerShell, or browser-fixture decisions.
- OPEN-03 remains deferred-required-before-Milestone-7 for claimed native Windows/macOS J-05 evidence. WSL/Linux remains diagnostic-only for desktop support.
- OPEN-06 and OPEN-07 retain their earlier resolved-source/static dispositions.
- Milestone 6 remains blocked in its untouched historical record and must be rerun; this completion does not promote it.
- Human review, GitHub-platform proof, whole-trace integration, immutable-candidate proof, full-history security adjudication, and final release gates remain outside Milestone 5.

## Remaining risks

- The nine unaffected accepted scenarios bind the frozen implementation candidate; AIH-05 binds the final corrected provider-route candidate. The final digest and full verification confirm no later AIH prompt, rubric, route, procedure, or check-contract drift.
- Local verification runs on Node `v20.20.1`, not the declared Node 22 baseline; CI must supply Node 22 evidence later.
- Scorecards and several canonical pages are currently uncommitted candidate evidence and are not yet GitHub-visible.
- Missing MCP registration coverage and the absent integration target remain explicit gaps; they are not represented as passing.
- AI evidence is non-authoritative and does not substitute for Prompt 7 human, platform, security, GitHub, or release evidence.

MILESTONE 5 COMPLETE — NEXT LEGAL PROMPT: 6
