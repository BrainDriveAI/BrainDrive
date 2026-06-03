# Resolution Note: katie-budget-gpt55 20260603T145553011Z

## Scope And Architecture

- Phase: BrainDrive product remediation only.
- Architecture docs reviewed: Gateway, Engine, Models, Memory, Configuration, Tools, Client-Gateway Contract, Gateway-Engine Contract.
- Architecture decision: provider-specific token affordability recovery lives in the OpenAI-compatible model adapter/config, not Gateway or Agent Loop. Owner-facing error copy/layout lives in client UX and safe stream error text. Finance-specific numeric behavior lives in Memory-hosted starter instructions. Harness metadata/classification issues are documented but not patched in product code.
- Note location: requested orchestrator directory was not writable from this sandbox, so this note is written in the BrainDrive worktree.

## Issue 1: Provider Credit/Max-Token Failure Aborted The Workflow

- Status: Resolved in product code.
- Restatement: OpenRouter rejected the streamed model call because BrainDrive requested `max_tokens=8192` while the account could only afford `4258`.
- Evidence: prompt audit `outputs/artifacts/memory/diagnostics/prompt-audit/2026-06-03.jsonl` records HTTP 402 with `requested up to 8192 tokens, but can only afford 4258`; Playwright error says BrainDrive failed before producing a reply.
- Root cause: OpenAI-compatible adapter always sent the configured `max_output_tokens` and lacked a retry path for provider affordability errors.
- Resolution: lowered OpenRouter profile default max output tokens to `4096`; added provider+model env cap support; added one retry for 402 token-affordability responses, rounding the affordable cap down to a stable boundary; added prompt audit event `prompt_audit.provider_request_retry`.
- Files: `builds/typescript/adapters/openai-compatible.ts`, `builds/typescript/adapters/openai-compatible.json`, `builds/typescript/memory/prompt-audit-store.ts`, adapter tests.
- Acceptance criteria: next run should send OpenRouter requests capped at 4096 by default; if a similar 402 occurs, the adapter retries with a lower `max_tokens`.

## Issue 2: Budget Artifacts Were Never Created Or Updated

- Status: Not directly product-fixed beyond Issue 1; rerun required.
- Restatement: saved Budget/report artifacts stayed starter/blank because the workflow stopped before uploads or budget generation.
- Evidence: `budget.md` starter status, blank `reports/latest.md`, empty statement folder, and `memory-diff.json` with no diffs.
- Root cause: upstream provider failure aborted the flow before artifact writes.
- Resolution: no product workaround added. Once Issue 1 is verified by rerun, acceptance should require non-starter Budget, populated latest report, statement receipts, and memory diffs.
- Ownership: product failure consequence plus harness acceptance gating.

## Issue 3: Owner-Facing Error Exposes Provider Operations

- Status: Resolved in product code.
- Restatement: Katie saw API key, credits/quota, provider connectivity, Open Settings, Try Again, and Dismiss in the chat failure state.
- Evidence: `owner-visible-text.json` and final screenshot include `Provider/API key settings`, `Provider account credits/quota`, and `Provider connectivity and status`.
- Root cause: engine sanitized raw provider failures into admin/provider troubleshooting copy, and ChatPanel showed an Open Settings action for provider-looking messages.
- Resolution: provider errors now emit owner-safe recovery text; ChatPanel replaces `provider_error` text with safe copy even if older/raw messages reach the client; Open Settings is no longer shown for chat provider errors; empty-completion provider copy was also made owner-safe.
- Files: `builds/typescript/engine/errors.ts`, `builds/typescript/engine/loop.ts`, `builds/typescript/client_web/src/components/chat/ChatPanel.tsx`, tests.
- Acceptance criteria: owner-visible provider failures contain no `API key`, `credits`, `quota`, or provider troubleshooting language and offer retry/admin-safe escalation.

## Issue 4: Final Error UI Is Visually Partially Obscured

- Status: Resolved in client UX.
- Restatement: the inline error panel was hidden behind the composer at 1280x720.
- Evidence: `002-final-state.png` shows only the top of the error panel above the fixed composer.
- Root cause: desktop message scroll area did not reserve enough bottom space for inline terminal error content.
- Resolution: increased desktop bottom padding in `MessageList` and moved the jump-to-bottom affordance above the reserved composer area; error action row now wraps.
- Files: `builds/typescript/client_web/src/components/chat/MessageList.tsx`, `builds/typescript/client_web/src/components/chat/ErrorMessage.tsx`.
- Acceptance criteria: the final inline error and buttons can scroll fully above the composer at desktop and mobile widths.

## Issue 5: Scenario Metadata And Actual Submitted Prompt Diverged

- Status: Not product-owned; no product patch.
- Restatement: scenario metadata claimed seven uploaded statements and a first-pass Budget request, but the actual opening prompt omitted uploads and upload lifecycle was empty.
- Evidence: transcript metadata has `uploadCount: 7` and a richer `budgetFlow.openingPrompt`; `composer-submissions.json` shows only the shorter natural persona text; `upload-lifecycle.json` has no events.
- Root cause: harness scenario/setup path used persona interview text rather than the metadata budget prompt/upload preconditions.
- Ownership: harness/test logic. Product workaround would weaken architecture by encoding scenario-specific behavior in product.
- Follow-up: harness should fail setup when metadata, upload plan, composer submission, and upload lifecycle diverge.

## Issue 6: BrainDrive Inferred A Financial Number From Truncated Input

- Status: Resolved in Memory-hosted product instructions.
- Restatement: Katie typed `about $3,` and BrainDrive inferred `$3,600`.
- Evidence: transcript turns 11-12.
- Root cause: Finance/Budget managed instructions did not explicitly prohibit completing mid-number finance fragments.
- Resolution: added numeric-fragment clarification rules to Finance and Budget starter instructions, including the Katie `$1,800 per paycheck` / `about $3,` case and required clarification between `$3,600`, `$3,800`, or another amount before budget math.
- Files: `builds/typescript/memory/starter-pack/projects/templates/finance/AGENT.md`, `builds/typescript/memory/starter-pack/projects/templates/finance/budget/AGENT.md`, `builds/typescript/memory/init.test.ts`.
- Acceptance criteria: a truncated money utterance triggers clarification instead of inferred normalization.

## Issue 7: Harness Classification And Role Artifacts Are Inconsistent

- Status: Not product-owned; no product patch.
- Restatement: artifact classification reported `status: passed` while also recording workflow failure; owner-visible role extraction put user chat articles under `assistantMessages`.
- Evidence: `functional-artifact-classification.json`, `owner-visible-text.json`, `current-assistant-turn.json`.
- Root cause: harness summary conflates artifact completeness with workflow pass/fail and uses article-based rather than role-aware extraction.
- Ownership: harness/test artifact generation.
- Follow-up: separate artifact completeness from workflow status and use role-specific selectors or transcript role mapping.

## Verification

- `git diff --check`: passed.
- `npm test -- --run adapters/openai-compatible.test.ts adapters/index.test.ts engine/errors.test.ts memory/init.test.ts`: blocked, `vitest: not found`.
- `npm --prefix client_web run test -- src/components/chat/ChatPanel.test.tsx src/components/chat/MessageList.test.tsx`: blocked, `vitest: not found`.
- `tsc -p tsconfig.json --noEmit`: blocked by missing package declarations (`vitest`, `zod`, `fastify`, MCP SDK), but change-specific TypeScript errors were fixed.
- `tsc -p client_web/tsconfig.json --noEmit`: blocked by missing `vite/client` and `vitest/globals`.
- `npm ls vitest zod fastify --depth=0` and `npm --prefix client_web ls vitest vite --depth=0`: dependency tree reports empty.

## Files Changed

- `builds/typescript/adapters/openai-compatible.ts`
- `builds/typescript/adapters/openai-compatible.json`
- `builds/typescript/adapters/openai-compatible.test.ts`
- `builds/typescript/adapters/index.test.ts`
- `builds/typescript/memory/prompt-audit-store.ts`
- `builds/typescript/engine/errors.ts`
- `builds/typescript/engine/errors.test.ts`
- `builds/typescript/engine/loop.ts`
- `builds/typescript/engine/loop.test.ts`
- `builds/typescript/client_web/src/components/chat/ChatPanel.tsx`
- `builds/typescript/client_web/src/components/chat/ChatPanel.test.tsx`
- `builds/typescript/client_web/src/components/chat/ErrorMessage.tsx`
- `builds/typescript/client_web/src/components/chat/MessageList.tsx`
- `builds/typescript/memory/starter-pack/projects/templates/finance/AGENT.md`
- `builds/typescript/memory/starter-pack/projects/templates/finance/budget/AGENT.md`
- `builds/typescript/memory/init.test.ts`

## Recommended Next Verification

1. Restore/install dependencies for `builds/typescript` and `builds/typescript/client_web`.
2. Run focused tests:
   - `npm test -- --run adapters/openai-compatible.test.ts adapters/index.test.ts engine/errors.test.ts engine/loop.test.ts memory/init.test.ts`
   - `npm --prefix client_web run test -- src/components/chat/ChatPanel.test.tsx src/components/chat/MessageList.test.tsx`
3. Rerun the harness scenario after dependencies pass:
   - `./scripts/test-finance-persona-dev-source.sh`
