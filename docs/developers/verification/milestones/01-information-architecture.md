# Milestone 1 — Information architecture and repository orientation

This is a sanitized, revision-bound execution record. It is not product or technical authority.

## Candidate revision

- Branch: `dev`
- Base revision: `ba37f0893fbd`
- Candidate state: uncommitted working tree containing Milestones 0 and 1. Commit, push, pull request, publication, and repository-settings changes were outside this prompt.

## Dependencies

- Milestone 0 was revalidated before edits: 49 documentation tests passed, the composed check passed with 150 scoped candidates and zero diagnostics, projections matched, and its terminal state remained valid.
- The specification, verification plan, implementation plan, root instructions, scoped documentation instructions, Milestone 0 record, and milestone-check skill were read completely.
- Repository source, callers, tests, configuration, package scripts, and registered source-adjacent READMEs were used as authority. Ignored owner data and private planning material were not opened.

## Files changed

- Front doors and instructions: `README.md`, `AGENTS.md`, `docs/developers/README.md`.
- Canonical orientation: `docs/developers/terminology.md`, `docs/developers/repository-map.md`, `docs/developers/architecture/README.md`.
- Machine-readable authority and projection: `docs/developers/catalog.json`, `tools/docs/schemas/catalog.schema.json`, `tools/docs/sync-generated.mjs`.
- Source-adjacent routes: `builds/typescript/README.md`, `builds/typescript/client_web/README.md`, `builds/mcp_release/README.md`, `installer/bootstrap/README.md`, `installer/docker/README.md`, `installer/docker/scripts/README.md`.
- Lifecycle corrections: `builds/typescript/Getting-Started-OpenRouter.md`, `builds/typescript/New-User-Setup.md`, `builds/typescript/client_web/src/api/CONTRACT.md`.
- Validation and fixtures: `tools/docs/check.mjs`, `tools/docs/lib/catalog.mjs`, `tools/docs/lib/rules/evidence.mjs`, `tools/docs/lib/rules/structure.mjs`, `tools/docs/test/catalog.test.mjs`, `tools/docs/test/evidence-harness.test.mjs`, `tools/docs/test/orientation.test.mjs`, `tools/docs/test/fixtures/catalog/valid-minimal.json`, `tools/docs/test/fixtures/orientation/missing-plain-source-metadata.md`.
- Evidence: `docs/developers/verification/milestones/01-information-architecture.md`.

## Commands and results

- Tests-first red run: `npm run docs:test` exited 1 with 48 passing and three expected failures. The failures identified the absent orientation validator/export, absent Milestone 1 terminal contract, and incomplete composed repository state before implementation.
- Final focused documentation tests before record finalization: 56 of 56 passed.
- Composed documentation check before record finalization: PASS with 156 scoped candidates and zero diagnostics.
- Projection check: `node tools/docs/sync-generated.mjs --check` passed.
- Diff hygiene: `git diff --check` passed.
- Current safe secret scan: `tools/security/scan-secrets.sh --current` used the declared current scanner/config, inspected tracked and non-ignored worktree scope, and reported zero findings.
- J-01: PASS. All 26 persona, journey, and component route records resolved; all nine representative deep entries exposed a parent route; orientation source and test paths existed.
- J-02: PASS. No non-current topic or legacy alias appeared in a current route; both legacy pages displayed a Legacy warning and canonical route; the mixed gateway contract displayed Unresolved mixed-content status.
- AIH-01: PASS. Root and scoped instruction authorities were discovered, and seven starter-pack `AGENT.md` files were classified as product artifacts rather than coding authority.
- AIH-02: PASS. All 10 component routes resolved and the repository map contained the expected tracked source boundaries without invented MCP test coverage.
- AIH-03: PASS. The two unresolved topics remained visible but were not promoted into current routes; legacy setup pages routed to current authority.
- Actual GitHub rendering, search ordering, click-trace URLs, and screenshots were not captured because the exact candidate revision is uncommitted and external publication was outside scope. This evidence remains deferred to Milestone 7.

## Reviews and adjudication

- Repository architecture review: initial NEEDS CORRECTION for invented MCP registration coverage, an overbroad Tauri bridge description, and overstated auth middleware ownership. Corrected by naming the test gap, routing the core Tauri boundary through `runtime-api-base.ts` and Rust, narrowing the optional browser bridge, and separating request authentication from signup/account/session ownership. Final independent AI re-review: PASS.
- GitHub source usability review: initial NEEDS CORRECTION for silent legacy/mixed direct entries and generic test routes. Corrected with visible lifecycle banners, canonical/parent/source/test links, real-page regression coverage, representative checks, and an explicit MCP coverage gap. Final independent AI re-review: PASS for structural precursors; actual GitHub platform evidence remains deferred.
- Accessibility/readability review: initial NEEDS CORRECTION for invisible lifecycle status, an incomplete Mermaid text alternative, and generic link text. Corrected with plain-source warnings, an adjacent complete relationship alternative, and descriptive link text. Final independent AI re-review: PASS.
- AI orientation review: PASS for instruction discovery, artifact classification, source-backed component mapping, current/legacy selection, and direct-entry routing without private or planning context.
- All four reviews are independent AI specialist evidence, not human-review or GitHub-platform evidence.

## Milestone check

- Objective result: PROCEED to Milestone 2.
- Phase 2 structural exit criteria are met locally: root and deep-entry navigation are present, canonical metadata and lifecycle distinctions are visible in plain source, the repository/architecture maps are source-backed, normal-user and planning authority did not drift, provider-independent scenarios pass, and deterministic checks are green.
- This result advances the implementation sequence only. It does not close any global gate or substitute for later platform, detailed architecture, complete agent-suite, or human evidence.

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

- OPEN-01 through OPEN-08 remain open and are not guessed closed by this milestone.
- Named GitHub ownership/enforcement, public interface maturity, platform evidence environments, restricted-procedure location, evidence retention, gateway-port reconciliation, release-helper invocation, and repository settings remain for their assigned milestones or final adjudication.
- Actual GitHub evidence remains deferred because no pushed exact candidate revision was available and this prompt did not authorize publication.

## Remaining risks

- GitHub rendering and search quality can differ from local structural checks and require later evidence on the exact published revision.
- Detailed setup, architecture flows, integration contracts, contribution/security/release journeys, and the full AI harness remain later-milestone work.
- MCP registration/config currently lacks a focused declared main-workspace test; the documentation states this gap instead of inventing coverage.
- The working tree intentionally combines the uncommitted Milestone 0 foundation with Milestone 1 and has not been committed or published.

MILESTONE 1 COMPLETE — NEXT LEGAL PROMPT: 2
