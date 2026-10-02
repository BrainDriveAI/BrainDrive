# 2026-10-01: Keep trusted app instructions whole within the configured chat budget

Historical change note for product fix 2c, narrowed after review of `4e35bef`. Base behavior is `origin/feature/internet-search-capability` (`2756b32`). Current host behavior is documented in [Gateway integration](../../../../../docs/developers/integrations/gateway.md). This note does not establish candidate qualification or replace the accepted product specifications.

## Requirement coverage

Accepted authority was read from `/Users/davidwaring/BrainDrive-Library/accepted/docs`:

- `platform/host-chat/host-chat-spec.md`, AC-9.2: “Then BrainDrive uses the latest saved document as current context / And does not rely on stale pre-edit assumptions.”
- `apps/resume-builder/resume-builder-spec.md`, AC-8.1: “Given an owner edits the Resume Profile directly, the host supplies the current Profile as the owner’s resume context when they return to chat or choose Create Resume. Create Resume uses that current Profile rather than a stale copy.”
- `platform/app-platform/braindrive-app-host-spec.md`, BD-HOST-CW-4 (the candidate Conversational Workspace requirement, not an APP acceptance criterion): “The host MUST load only signed, digest-bound app instructions from the active package”. The same requirement defines deterministic instruction precedence and removal on exit/invalidation.
- `platform/app-platform/paa-host-spec.md`, PAA-APP-H-016: “For an active app session, the host MUST enforce the Shared Contract §11 precedence order: PAA/host security policy, owner global policy/overlays, active app instructions, session owner direction, then ordinary content as data.”
- `apps/resume-builder/evaluation/resume-builder-evaluation-plan.md`, §2 AC-8.1: “Deterministic Profile/source parity: edit → next model turn cites edit; edit → render reflects edit — E-6”. The plan declares “Model-context exception: None”.

The current-Profile and latest-document acceptance criteria cover the lost-context defect; the instruction requirements support preserving the active instruction layer. None of these acceptance criteria literally prescribes byte-for-byte prompt delivery, character caps, a token estimator, or an overflow algorithm. The requested budget policy is the implementation direction for this fix, not an invented AC.

Repository context selection: `AGENTS.md`, `docs/AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json` (`web-to-tool`, `installed-apps`, and `verification` routes), `docs/developers/architecture/request-flows.md`, `docs/developers/integrations/gateway.md`, `docs/developers/integrations/installed-apps.md`, `docs/developers/verification.md`, and the gateway/engine source and tests.

## Narrowed design and reason

The base gateway clips system content to 24,000 characters before estimating context usage. This can remove installed app instructions even when the prompt fits the configured budget. The original `4e35bef` fix removed every role cap and protected every system-role message. Review showed that this exposed the base chars/4 token underestimate, admitted large ordinary messages without resolving the selected model's limit, changed which conversation units survived through their now-unbounded sizes, and protected generated summaries enough to cause avoidable overflow.

This revision restores base behavior for everything except trusted system instructions and the accounting/warning needed to preserve them safely:

- User, assistant, and tool content retain the base caps of 8,000, 12,000, and 4,000 characters, including the original middle-cut marker and head/tail split.
- The trusted prefix defaults to the gateway's single composed host/app system message. Internal callers supplying separate trusted system layers explicitly set `systemInstructionCount`. Merely having role `system` does not protect later messages. The gateway never passes conversation summaries as trusted layers.
- Trusted instructions bypass the fixed 24,000-character cap within the configured message budget. Their content estimate uses the strict UTF-8 byte count (one token per byte), with the existing message overhead added. No selected-model tokenizer is available in the codebase. The prior mixed estimate admitted adversarial ASCII such as `"qz ".repeat(80000)` at 80,016 estimated prompt tokens; the byte bound counts 240,000 instruction bytes before overhead and routes it through the existing warning/fallback. Ordinary conversation, generated summaries, and tool definitions retain the base estimate.
- If trusted instructions alone exceed the available message budget, they use the base 24,000-character cap. The base overflow fallback can further shorten them. Any instruction shortening produces an explicit owner-visible context warning, with the original conservative estimate; there is no silent middle-cut.
- The base reverse selection loop, including its backfilling of older small units, is unchanged. So are assistant/tool replay units, oldest-selected-unit removal, summary construction/reduction, aggressive caps (2,000, 1,200, 700, 400; twice those caps for the trusted instruction prefix), and final removal from after the prefix. Generated summaries can be shortened or removed by that fallback; they are not protected as instructions.
- The broader truncation-count audit additions from `4e35bef` are reverted. Existing context warning headers, context audit, and prompt-audit warning capture carry the instruction warning.

The configured default remains 128,000 tokens with 8,000 tokens of response headroom (120,000-token prompt budget). This is an estimate against configured settings, not a tokenizer-backed proof of provider acceptance. No model-limit lookup, provider change, app-specific instruction, tool-result policy, or engine-loop behavior is added. The fix preserves guidance within budget; it does not guarantee the model follows every instruction or solve the broader latest-document retrieval problem.

Canonical documentation impact is confined to `docs/developers/integrations/gateway.md`: prompt preparation changes here. App packaging, app workflow contracts, engine execution, provider configuration, client APIs, and request/persistence flow remain unchanged, so adjacent routed pages require no behavior update.

## Separate follow-up issues

These pre-existing issues are recorded separately from the instruction-cap fix and are not implemented here:

- **CTX-01 — Resolve model-specific context and response budgets.** Context preparation uses configured/global defaults rather than the selected model's actual context window. Smaller-window models, including owner-configured Ollama models, can still reject a prompt. A separate change should resolve the effective model limit, define behavior when metadata is unavailable, subtract enforced response headroom, and test smaller-window providers. The conservative system estimate here does not resolve that boundary.
- **CTX-02 — Rebudget between provider calls and bound fresh retrieval.** The engine appends fresh tool results without running context management before the next provider call. File reads are unbounded and web reads permit 262,144 bytes per result. Replay caps do not bound fresh results in the same turn. A separate change should prepare context before every provider call and define bounded retrieval/re-retrieval while preserving tool-call/result pairing.
- **CTX-03 — Preserve tool-call/result pairing in last-resort trimming.** Replay selection groups assistant/tool units, but final fallback removal operates on individual messages after the trusted prefix. A separate change should define and verify pairing guarantees at this last-resort boundary; this fix leaves that algorithm unchanged.
- **CTX-04 — Define summary fidelity.** Existing summaries use bounded snippets and can be shortened or removed during fallback. A separate change should define continuity and source-fidelity requirements, including how to recover omitted details. This fix does not change summary construction or fidelity.

Generated conversation summaries also retain the pre-existing system wire role and base chars/4 estimate. This revision only restores their ordinary budget treatment; it does not change instruction/data authority representation or the estimator for other bounded content.

## Regressions and verification

`builds/typescript/gateway/context-window.test.ts` verifies:

- A system prompt over 50,000 characters reaches the engine's recording provider adapter byte-for-byte within budget.
- Base user/assistant/tool caps are exactly 8,000/12,000/4,000 characters, with byte-for-byte base truncation structure, even for 399,000 digits or a 450,000-character tool result.
- Base newest-first selection and older-small-unit backfilling remain unchanged, retaining the bounded recent tool block.
- Explicitly identified separate host/app system layers remain whole within budget.
- Adversarial ASCII (`"qz ".repeat(80000)`), numeric, and multilingual system prompts estimate above the default budget and trigger the base safe fallback plus visible instruction-shortening warning.
- Small-budget instruction overflow uses the base aggressive fallback.
- Generated summaries receive the base last-resort shortening, and replayed system-role summaries remain evictable ordinary context.

Before implementation, the revised suite had eight failures against `4e35bef`. The eviction, generated-summary-shortening, and replayed-summary regressions also pass against the unchanged base implementation. Verification uses `npm test -- gateway engine app-platform/mcp-host/app-chat-session.test.ts --maxWorkers=2`, `npm run lint`, `npm run build`, `npm test -- --maxWorkers=2`, and `npm run docs:verify` (includes the requested `docs:check`) from `builds/typescript`, plus `node tools/docs/sync-generated.mjs --check` and `git diff --check` from the root.

Results for the preceding narrowed revision at `22088c6`:

| Check | Result |
|---|---|
| Runtime lint and build | Passed |
| Focused gateway/engine/app-chat tests | 213 passed across 16 files, including all 12 context-window tests |
| Full runtime tests, `--maxWorkers=2`, with local fixture access | 1,448 passed across 157 files; no failures |
| Documentation tests | 166 passed; 1 skipped; no failures |
| `docs:check` | Passed; 269 scoped candidates, zero diagnostics |
| Catalog projection and whitespace checks | Passed |
| Current secret scan | Passed; Gitleaks 8.30.1, zero findings |

The initial sandboxed full run reported 1,392 passed and 56 failed, plus three unhandled errors. Fixture loopback binds were blocked with `listen EPERM`; a direct loopback bind check reproduced that restriction. The complete rerun with local process/network access passed. The known base failure also recurred in the initial sandboxed run at `app-platform/mcp-host/data-capability-bridge.test.ts:196`, “keeps a deadline response pending until the real recovery adapter settles cancelled”: expected settled/cancelled, received unsettled/pending with `not_found_within_scope`. It did not recur in the successful local rerun. The earlier revision recorded reproduction on an unchanged `2756b32` checkout; this test does not use context-window preparation. No lockfile or dependency version was changed.

These checks use synthetic, provider-independent fixtures. They do not establish live provider acceptance, Docker release evidence, or app candidate qualification.

## Byte-bound review correction

The tokenizer-independent adversarial ASCII regression failed before implementation: expected at least 240,000 tokens under the byte bound, received 80,016. After changing only `estimateInstructionTokens`, it passes with the existing 24,000-character fallback and visible instruction-shortening warning. The 50k-character provider regression remains intact within the 120k budget. The small-budget fallback now reaches the unchanged 2,400-character instruction step; the generated-summary fixture uses 3,000 instruction characters to continue exercising the unchanged first 2,000-character summary trimming step under byte accounting. No other role cap, eviction, summary, or warning algorithm changed.

Verification for this correction (source parent `22088c6`, with only the four-file patch):

| Check | Result |
|---|---|
| Focused gateway/engine/app-chat tests, `--maxWorkers=2` | 214 passed across 16 files, including all 13 context-window tests |
| Runtime lint and build | Passed |
| Full runtime tests, `--maxWorkers=2`, with local fixture access | First run: 1,448 passed, 1 failed; final run: 1,447 passed, 2 failed across 157 files |
| `docs:verify` | 166 passed, 1 skipped; `docs:check` passed with 269 scoped candidates and zero diagnostics |
| Catalog projection, current secret scan, and whitespace | Passed; Gitleaks 8.30.1, zero findings |

No green full-suite result was obtained for this correction. Both local runs hit the previously recorded recovery-timing failure at `app-platform/mcp-host/data-capability-bridge.test.ts:196` (pending/unsettled instead of cancelled/settled). Its three tests passed in isolation. The final run also hit `app-platform/lifecycle/sidecar-supervisor.test.ts:507`, “kills output floods with content-free diagnostics” (missing `output_limit_exceeded` diagnostic). A combined isolated run had 14 passes and three sidecar failures, including two readiness failures. The same output-flood failure reproduced on an unchanged tracked-file snapshot of `22088c6` with the same dependencies: 16 passed, one failed across those two files. Neither fixture uses context-window preparation; their code was not changed. These are separate pre-existing fixture failures, not changes to instruction budgeting.

The sandboxed full run had 1,393 passes, 56 failures, and three unhandled errors; a direct loopback bind reproduced `EPERM`. The two local runs used synthetic fixture/process access to remove that restriction. No live provider calls, dependency updates, or unrelated fixture fixes were made.
