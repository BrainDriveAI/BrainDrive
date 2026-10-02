# Resume Builder fix 8: Profile-read context cap

This is an internal, non-authoritative implementation and verification note for packet p105. Change authority is the supplied 2026-10-02 decision D358: raise only Resume Builder Profile-read tool results to 24,000 characters for spec v0.9.12 AC-8.1. The reported fresh-owner combined test saw an approximately 11,000-character Profile result clipped to 4,000. That report is task-supplied diagnostic evidence, not a live test performed for this patch.

## Governing context

Repository context selection: `AGENTS.md`, `docs/AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json` (`web-to-tool`, `installed-apps`, and `verification` routes), `docs/developers/architecture/request-flows.md`, `docs/developers/integrations/gateway.md`, `docs/developers/integrations/installed-apps.md`, `docs/developers/verification.md`, `builds/typescript/app-platform/mcp-host/README.md`, `builds/typescript/app-inference/README.md`, and `builds/resume_builder/README.md`. Source and tests establish the identity and clipping behavior.

## Identity and scope

`app-platform/mcp-host/app-chat-model.ts` builds descriptor tools with host-created `auditMetadata`: source `installed_app_action`, app ID, and exact action ID. The review follow-up records those three fields as execution provenance in `engine/tool-executor.ts`, passes them through the engine result event, and persists them separately from output in `gateway/conversations.ts`. Replay restores that host record on the tool message.

`gateway/context-window.ts` requires a matching preceding assistant call ID and recorded execution provenance identifying `ai.braindrive.resume-builder` / `resume.profile.read`. It never reclassifies history from the current registry or a tool name. Model input and tool output cannot set the record. Legacy calls lacking provenance retain 4,000 characters; their app identity cannot safely be recovered. Genuine reads recorded with provenance retain the 24,000 cap even when the current registry changes.

The cap covers the complete serialized tool-result message, including its envelope. Above 24,000, the original middle-truncation marker and head/tail split apply. User, assistant, ordinary system, and other tool caps, trusted instruction handling from PR 328, token accounting, selection order, summaries, and aggressive budget fallback remain unchanged. Overall budget pressure can still trim or evict a Profile-read block. Fresh engine results retain their existing content behavior; the cap change applies only to gateway replay. Execution provenance is host bookkeeping and is omitted from client SSE and model result content. No general per-tool declared result-size mechanism is introduced.

Canonical documentation impact is the gateway context-preparation paragraph. The Resume Builder README links this note, and the catalog classifies it as internal evidence. The app-chat bridge already supplies the required metadata, so its implementation and contract need no change. The engine request-flow documentation needs no change: execution, approvals, and SSE/persistence order are unchanged; the additive provenance is internal host bookkeeping, and the canonical gateway paragraph documents its cap effect. No prompt, inference, provider, document storage, renderer, or packaging behavior changes.

## Regressions and verification

The focused context suite initially failed exactly the two positive Profile cases: 11,000 and 30,000 characters both returned 4,000. After the change, all 21 tests passed. Coverage checks 11,000 characters intact, 30,000 clipped to exactly 24,000 with the existing marker, and unrelated/spoofed names, app/action/source mismatches, and unmatched IDs remaining at 4,000 with identical result text.

The installed-app proof also launches Resume Builder, edits a synthetic 11,000-character Profile through its document API, executes the registered Profile-read action, and verifies the complete result envelope survives context preparation with the bridge's real metadata.

Verification environment: Darwin arm64, Node `v20.20.2`, npm `10.8.2`; branch `fix/rb-profile-read-cap`, source parent `7940a4bf7f32e8e9bd9a49354abdc95a0281a7c0` with this seven-file patch. Locked dependencies were absent and installed with `npm ci --offline --ignore-scripts` in both workspaces. No dependency or lockfile changes were made.

| Working directory | Exact command | Result |
|---|---|---|
| `builds/typescript` | `npm test -- gateway/context-window.test.ts --maxWorkers=2` | 1 file / 21 tests passed after the change; before the change, 19 passed / 2 failed |
| `builds/typescript` | `npm test -- gateway app-platform/mcp-host/app-chat-session.test.ts app-platform/mcp-host/self-contained-app-proof.test.ts app-inference app-platform/mcp-host/live-fixture.integration.test.ts --maxWorkers=2` | 19 files / 251 tests passed with local fixture access |
| `builds/typescript` | `npm test -- --maxWorkers=2` | 157 files / 1,485 tests passed with local fixture access |
| `builds/typescript` | `npx tsc -p tsconfig.json --noEmit` | Passed |
| `builds/typescript` | `npm run lint` | Passed |
| `builds/typescript` | `npm run build` | Passed |
| `builds/resume_builder` | `npm test` | 12 files / 342 tests passed, including generated Profile and PDF invariants |
| `builds/resume_builder` | `npm run build` | Passed |
| `builds/typescript` | `npm run docs:verify` | 166 tests passed / 1 skipped / 0 failures; includes `npm run docs:check`: 275 scoped candidates / 0 diagnostics |
| Repository root | `node tools/docs/sync-generated.mjs --check` | Passed |
| Repository root | `git diff --check` | Passed |

The initial sandboxed focused run had 240 passes / 11 failures: all 10 live-fixture tests failed with `listen EPERM: operation not permitted 127.0.0.1`, and the added bridge test initially wrote before lazily initializing its Profile document (HTTP 409). The test now reads the document first, matching the existing fixture pattern. The rerun with synthetic loopback fixture access passed all 251 tests; the full runtime suite also passed. The bridge source-boundary proof remains unchanged and passes.

All checks use synthetic local fixtures. No live owner/provider conversation or push was performed. These results do not replace fresh-owner live validation. The existing overall context-budget fallback still applies, and 24,000 characters includes the result envelope.

## Review follow-up: trusted call provenance

The original name-to-current-definition match could expand an unrelated historical MCP result after entering Resume Builder app chat. The replacement binds the cap to the host execution record. Added durable regressions execute both `app_action_resume_profile_read` and `resume_profile_read` through the engine, reload their conversation from disk, and verify spoofed history stays at 4,000 beside a genuine current definition while a genuine earlier read clips at 24,000. They also prove forged input/output provenance and removal of the current definition do not change these decisions. The installed-app proof checks the real descriptor action's host-stamped provenance.

Follow-up verification on parent `7b2d8a9` (11 changed files; four added regression cases). Earlier results above apply to the original patch only.

| Working directory | Exact command | Result |
|---|---|---|
| `builds/typescript` | `npm test -- gateway app-platform/mcp-host/app-chat-session.test.ts app-platform/mcp-host/self-contained-app-proof.test.ts app-platform/mcp-host/live-fixture.integration.test.ts --maxWorkers=2` | 16 files / 238 tests passed |
| `builds/typescript` | `npm test -- --maxWorkers=2` | 157 files / 1,489 tests passed |
| `builds/typescript` | `npx tsc -p tsconfig.json --noEmit`; `npm run lint`; `npm run build` | All passed |
| `builds/typescript` | `npm run docs:verify` | 166 passed / 1 skipped / 0 failures; 275 scoped candidates / 0 diagnostics |
| `builds/resume_builder` | `npm test -- --maxWorkers=2 --pool=threads --reporter=verbose` | 12 files / 342 tests passed, including the complete generated Profile/PDF corpus |
| Repository root | `node tools/docs/sync-generated.mjs --check`; `git diff --check` | Both passed |

The initial focused sandbox run had 228 passes / 10 loopback `listen EPERM` failures; the authorized fixture-access rerun passed all 238. Earlier Resume Builder fork-mode attempts were interrupted without a terminal result; the complete thread-pool run passed in 220 seconds. No dependency or lockfile changes were made. Legacy provenance is deliberately not inferred or backfilled.
