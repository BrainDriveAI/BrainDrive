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

## Platform-continuation note

- Milestone 2 later completed its repository-controlled continuation by narrowing V1 J-05 to native Windows and native macOS and deferring both required reports to Milestone 7.
- This record remains the historical dependency-block attempt. It is not promoted automatically and does not contain Milestone 3 implementation or verification evidence.
- Rerun original Prompt 3 to implement and adjudicate Milestone 3 before changing this terminal result.

Prior attempt result: BLOCKED

## Attempt 2 — original Prompt 3 rerun

### Candidate revision and dependency

- Branch: `agent/developer-documentation-system`.
- Base revision: `79fd0e3de2cd137b38b624552478d2ab13f775f1`; candidate state is the uncommitted Milestone 3 workspace on that revision.
- Milestone 2 was revalidated as complete before edits and ends `MILESTONE 2 COMPLETE — NEXT LEGAL PROMPT: 3`. Its WSL native/Docker evidence and diagnostic-only failed WSL Tauri attempt remain intact; native Windows/macOS J-05 reports remain deferred and required before Milestone 7.
- The original prompt pack/Prompt 3, specification, test plan, implementation plan, root/scoped instructions, Milestones 0–3, live source/config/tests, and milestone-check skill were read before authoring. No product behavior, owner data, credential, production system, external publication, commit, push, pull request, or repository setting was changed.

### Tests-first implementation and migration

- Added `tools/docs/test/technical-boundaries.test.mjs` first. Its initial run failed all six assertions because the Milestone 3 pages, catalog entries, traces, migration, and router did not yet exist.
- Added a cascade correction assertion before finalizing this record. It failed as intended because this record still ended `BLOCKED`; the corrected contract requires this rerun to complete while Milestone 4 remains an untouched historical blocker until Prompt 4 runs.
- Migrated the complete former `builds/typescript/client_web/src/api/CONTRACT.md` body intact to `docs/developers/history/gateway-contract-original-client.md`. The old path is now a pointer to current gateway guidance and history; catalog route, lifecycle, source mapping, and document classification were updated.

### Files changed

- Detailed architecture: `docs/developers/architecture/README.md`, `request-flows.md`, `modes-data-and-trust.md`, and `memory-and-secrets.md`.
- Integration corpus: `docs/developers/integrations/README.md`, `gateway.md`, `providers.md`, `mcp-and-tools.md`, and `deployment.md`.
- Security routing: `docs/developers/security.md`.
- Migration: `builds/typescript/client_web/src/api/CONTRACT.md` and `docs/developers/history/gateway-contract-original-client.md`.
- Source-adjacent MCP guidance: `builds/mcp_release/README.md`.
- Navigation/authority: `docs/developers/README.md` and `docs/developers/catalog.json`.
- Validation/evidence: `tools/docs/test/technical-boundaries.test.mjs`, `tools/docs/test/evidence-harness.test.mjs`, and this record.
- No runtime, gateway, engine, auth, provider, memory, secrets, MCP implementation, installer, Docker, or Tauri behavior file was changed.

### Architecture traces and trust findings

- Trace A follows web `POST /api/message` through API-base resolution, gateway transport/auth, pre-provider user-message persistence, prompt/context assembly, SSE opening, request-time provider resolution, `runAgentLoop`, approvals, tools/MCP, and assistant/tool persistence. It names non-participants and the current web client's immediate approval submission rather than inventing a human confirmation.
- Trace B follows public `/config` mode discovery. It names browser/Tauri transport participants; auth/engine/provider/tool/conversation non-participants; the deliberate transport/request-auth exemption; no persistence; and the client-only local fallback after retries.
- Trace C records the authenticated `/skills` chat-path bypass without describing it as an authorization bypass.
- The mode matrix keeps deployment location, install mode, auth mode, client transport, and packaging independent. It records the protected managed-auth header/state inconsistency instead of claiming it works.
- Managed account proxies are documented accurately: when `PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES` is unset they are exempt from this gateway's request-auth hook by default; optional transport-token and upstream cookie/session boundaries remain separate.
- The memory/secrets page distinguishes external vault/master-key state, memory Git history, remote backup, secret-bearing migration export/import, restore, diagnostics, starter-pack/existing-owner behavior, and destructive boundaries. It records that migration excludes `.git`, while remote restore preserves target Git and creates a new restore commit.

### Integration maturity and safe validation

- OPEN-02 remains open. Gateway HTTP/SSE, provider configuration, MCP/tool configuration, and first-party MCP services are described as shipped internal behavior with unresolved public compatibility; no supported/public stability promise was invented.
- BrainDrive Models, BYOK OpenRouter, and Ollama remain independent. Credits are not required for OpenRouter/Ollama; claim activation respects newer explicit provider intent; no BrainDrive-owned client key is introduced or documented.
- The MCP package is an application component, not an SDK. Its standalone no-auth/default-owner context, Compose port exposure, metadata-versus-enforcement distinctions, narrow unit coverage, and destructive volume cleanup are explicit.
- The package `test:integration` entrypoint is absent, so that dedicated command was not run or cited. Standard controlled native/Docker integration evidence remains separate.
- Tier B MCP development/Compose examples name prerequisites, target, side effects, authority, cleanup, and recovery. Volume-preserving shutdown is primary.

### Commands and results before final record verification

- Pre-edit `cd builds/typescript && npm run docs:verify`: exit 0; 79 passed, one skipped, zero failed; composed documentation check passed over 172 candidates with zero diagnostics.
- Initial `node --test tools/docs/test/technical-boundaries.test.mjs`: exit 1; six intended failures.
- Focused catalog/orientation/technical suite after implementation: exit 0; 20 passed, zero failed; composed check passed over 183 candidates with zero diagnostics.
- Cascade-focused `node --test tools/docs/test/evidence-harness.test.mjs` before record update: exit 1; 15 passed and the intended Milestone 3 terminal assertion failed.
- `cd builds/typescript && npm run lint && npm test && npm run build`: exit 0; lint passed, 240 tests in 34 files passed, build passed.
- `cd builds/typescript/client_web && npm run lint && npm run typecheck && npm test && npm run build`: exit 0; lint/typecheck passed, 178 tests in 17 files passed, build passed. Existing unresolved-font and large-chunk warnings remained non-fatal.
- `cd builds/mcp_release && npm test && npm run build`: exit 0; six tests in two files passed and TypeScript build passed.
- Final focused technical/security run before record update: exit 0; 12 passed, zero failed; composed check passed over 183 candidates with zero diagnostics; `git diff --check` passed.
- `node tools/docs/sync-generated.mjs --check`: exit 0 before record update; projections matched the catalog.

Final full documentation, projection, secret-scan, and diff results are appended below after this terminal correction is exercised.

### Independent reviews and adjudication

- Gateway/engine specialist: initial `NEEDS CORRECTION` for SSE/provider ordering, `/config` payload, managed-auth overstatement, auto-approval, no-op project guard, and backup-trigger wording. All findings corrected; final independent read-only disposition: `PASS`.
- Memory/secrets specialist: initial `NEEDS CORRECTION` for export/backup/secrets distinctions, direct tool ownership, Git/history, archive trust, force operations, and side-effectful `memory_export`. All findings corrected; final independent read-only disposition: `PASS`.
- Provider/MCP/integration specialist: initial `NEEDS CORRECTION` for ToolDefinition versus MCP metadata, ignored-config claims, HOST default, integration-script scope, Docker local storage, and unit-coverage breadth. All findings corrected; final independent read-only disposition: `PASS`.
- Security specialist: initial `NEEDS CORRECTION` for managed proxy auth boundaries, MCP exposure/command contracts, destructive ordering, migration Git history, and starter-pack existing-owner preservation. Regression tests were added first and all findings corrected; final independent read-only disposition: `PASS` with 12 focused tests and diff hygiene independently green.
- These are independent AI specialist reviews, not human, GitHub-platform, production, or public compatibility evidence.

### Global gates and open items

- G-01 through G-14 remain `OPEN — FINAL ADJUDICATION IN MILESTONE 7`; this technical milestone does not adjudicate global release readiness.
- OPEN-02 remains open because no maintainer public compatibility promise exists; the corpus uses internal/unresolved maturity.
- OPEN-03 retains deferred native Windows/macOS Tauri J-05 evidence and the WSL diagnostic failure; no platform evidence was overwritten or implied.
- OPEN-04 remains open because no authorized restricted-procedure location or public escalation wording was invented.
- OPEN-05 and OPEN-07 through OPEN-10 retain their existing final/later-milestone disposition.
- Milestones 4–7 remain historical dependency-block records. Completing this record does not promote them; original Prompt 4 must run next.

### Remaining risks and objective milestone check

- Protected `auth_mode=managed` requests have an evidenced source-level header/state mismatch and no focused working-path test. Documentation exposes the inconsistency; a product correction requires separate scope.
- The package MCP integration-test entrypoint and focused main-workspace MCP registry/config tests are absent. Unit/build and prior controlled orchestration evidence do not replace those gaps.
- Public interface compatibility, live-provider compatibility, human/GitHub rendering review, claimed Tauri platform reports, and final release gates remain unproved.
- Objective milestone-check disposition: `PROCEED` to original Prompt 4. Repository-controlled Phase 3 success criteria, required technical traces, migration, maturity boundaries, applicable product checks, and four independent specialist reviews pass without weakening later gates.

### Final verification

- `cd builds/typescript && npm run docs:verify`: exit 0; 85 passed, one Windows-only skip, zero failed; composed validation passed over 183 scoped candidates with zero diagnostics.
- `node tools/docs/sync-generated.mjs --check`: exit 0; documentation projections matched the catalog.
- `tools/security/scan-secrets.sh --self-test`: exit 0; current/history/custom canaries, redaction, checksum, version, shallow-history, and exception-scope guards passed.
- `tools/security/scan-secrets.sh --current`: exit 0; Gitleaks 8.30.1 scanned tracked and non-ignored worktree scope with zero findings.
- `git diff --check`: exit 0.
- The objective milestone-check found no repository-controlled Phase 3 blocker. Missing public maturity authority is represented as unresolved/internal, the missing MCP integration entrypoint remains an explicit gap, and deferred platform/human/GitHub/final-release evidence remains fail-closed for later milestones.

MILESTONE 3 COMPLETE — NEXT LEGAL PROMPT: 4
