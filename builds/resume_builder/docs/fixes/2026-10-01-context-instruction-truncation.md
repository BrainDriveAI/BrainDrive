# 2026-10-01: Preserve instructions and document results within the chat budget

Historical change note for product fix 2c, based on `2756b32` on `feature/internet-search-capability`. Current host behavior is documented in [Gateway integration](../../../../../docs/developers/integrations/gateway.md). This note does not establish candidate qualification or replace the accepted product specifications.

## Requirement coverage

Accepted authority was read from `/Users/davidwaring/BrainDrive-Library/accepted/docs`:

- `platform/host-chat/host-chat-spec.md`, AC-9.2: “Then BrainDrive uses the latest saved document as current context / And does not rely on stale pre-edit assumptions.”
- `apps/resume-builder/resume-builder-spec.md`, AC-8.1: “Given an owner edits the Resume Profile directly, the host supplies the current Profile as the owner’s resume context when they return to chat or choose Create Resume. Create Resume uses that current Profile rather than a stale copy.”
- `platform/app-platform/braindrive-app-host-spec.md`, BD-HOST-CW-4 (the candidate Conversational Workspace requirement, not an APP acceptance criterion): “The host MUST load only signed, digest-bound app instructions from the active package”. The same requirement defines deterministic instruction precedence and removal on exit/invalidation.
- `platform/app-platform/paa-host-spec.md`, PAA-APP-H-016: “For an active app session, the host MUST enforce the Shared Contract §11 precedence order: PAA/host security policy, owner global policy/overlays, active app instructions, session owner direction, then ordinary content as data.”
- `apps/resume-builder/evaluation/resume-builder-evaluation-plan.md`, §2 AC-8.1: “Deterministic Profile/source parity: edit → next model turn cites edit; edit → render reflects edit — E-6”. The plan declares “Model-context exception: None”.

The current-Profile and latest-document acceptance criteria cover the lost-context defect; the instruction requirements support preserving the active instruction layer. None of these acceptance criteria literally prescribes byte-for-byte prompt delivery, character caps, a token estimator, or an overflow algorithm. The requested budget policy is the implementation direction for this fix, not an invented AC.

Repository context selection: `AGENTS.md`, `docs/AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json` (`web-to-tool`, `installed-apps`, and `verification` routes), `docs/developers/architecture/request-flows.md`, `docs/developers/integrations/gateway.md`, `docs/developers/integrations/installed-apps.md`, `docs/developers/verification.md`, and the gateway/engine source and tests.

## Defect and generic fix

The gateway capped each system message at 24,000 characters and each tool result at 4,000 characters before estimating prompt usage. User and assistant messages also had fixed caps. Consequently a prompt comfortably below the token budget could lose app rules or current document content. The final overflow fallback could additionally cut the active system instructions.

The host now estimates the original messages plus tool definitions. It removes no content merely because an individual message is long. Under actual budget pressure, the existing older-conversation eviction and summary logic runs first. All system messages are protected from eviction and truncation. Last-resort shortening applies only to non-system content, preserves assistant/tool block structure, retains explicit truncation markers, records counts in the context audit and prompt-audit assembly, and uses the existing owner-visible context warning. Unresolved overflow is reported while keeping instructions intact; this can still result in provider rejection.

The 128,000-token window and 8,000-token response headroom remain unchanged (120,000-token prompt budget). No Resume Builder tool, prompt, schema, provider, or host special case is added. This fixes lost guidance; it does not prove why a model selected a particular invalid operation ID or guarantee that all future tool calls follow instructions.

## Regressions and verification

`builds/typescript/gateway/context-window.test.ts` verifies:

- A system prompt over 50,000 characters and large user/assistant messages arrive intact at the engine's recording provider adapter within budget.
- A document tool result over 10,000 characters survives context preparation intact within budget.
- Actual overflow reduces older conversation while preserving multiple system instruction layers and the latest question.
- Last-resort clipping is counted and warned, and retains the assistant/tool block.
- Instructions exceeding the budget remain intact with an explicit overflow warning.

All five new regressions failed against the original implementation before the fix. Verification commands from `builds/typescript`: `npm run lint`, `npm run build`, `npm test -- gateway engine app-platform/mcp-host/app-chat-session.test.ts --maxWorkers=2`, `npm test -- --maxWorkers=2`, and `npm run docs:verify` (includes `docs:test` and `docs:check`). From `builds/resume_builder`: `npm test` and `npm run build`. From the repository root: `node tools/docs/sync-generated.mjs --check` and `git diff --check`.

Results on macOS with Node 24.21.0:

| Check | Result |
|---|---|
| Runtime lint and build | Passed |
| Focused gateway/engine/app-chat tests | 209 passed, including all 8 context-window tests |
| Full runtime tests, `--maxWorkers=2` | 1,443 passed; 1 failed across 157 test files |
| Resume Builder tests and build | 219 tests passed; build passed |
| Documentation tests | 166 passed; 1 skipped; no failures |
| `docs:check`, projection check, whitespace check | Passed; documentation validator reported zero diagnostics |

The sole full-suite failure is `app-platform/mcp-host/data-capability-bridge.test.ts:196`, “keeps a deadline response pending until the real recovery adapter settles cancelled”: expected settled/cancelled, received unsettled/pending with `not_found_within_scope`. The same isolated failure reproduces on an archived, unchanged `2756b32` checkout. That test does not use context-window preparation; this fix leaves its recovery behavior unchanged.

The initial sandboxed full-suite run could not bind fixture loopback listeners (`listen EPERM`); the reported full-suite result is the rerun with local process/network access. This worktree initially lacked dependencies and npm downloads failed DNS resolution, so verification reused existing dependency links only after confirming that both package lockfiles and their dependency-source lockfiles had matching SHA-256 identities. No lockfile or package version was changed.

These are provider-independent source checks. No C13 live stack, real provider call, Docker release, or Candidate 14 evaluation is claimed.
