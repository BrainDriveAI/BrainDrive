# Resume Builder fix 8: Profile-read context cap

This is an internal, non-authoritative implementation and verification note for packet p105. Change authority is the supplied 2026-10-02 decision D358: raise only Resume Builder Profile-read tool results to 24,000 characters for spec v0.9.12 AC-8.1. The reported fresh-owner combined test saw an approximately 11,000-character Profile result clipped to 4,000. That report is task-supplied diagnostic evidence, not a live test performed for this patch.

## Governing context

Repository context selection: `AGENTS.md`, `docs/AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json` (`web-to-tool`, `installed-apps`, and `verification` routes), `docs/developers/architecture/request-flows.md`, `docs/developers/integrations/gateway.md`, `docs/developers/integrations/installed-apps.md`, `docs/developers/verification.md`, `builds/typescript/app-platform/mcp-host/README.md`, `builds/typescript/app-inference/README.md`, and `builds/resume_builder/README.md`. Source and tests establish the identity and clipping behavior.

## Identity and scope

`app-platform/mcp-host/app-chat-model.ts` builds descriptor tools with host-created `auditMetadata`: source `installed_app_action`, app ID, and exact action ID. `gateway/server.ts` supplies the authorized request tool definitions to context preparation. `engine/loop.ts` pairs results with `tool_call_id`; `gateway/conversations.ts` persists the call name/input and reconstructs assistant/tool blocks for replay.

`gateway/context-window.ts` resolves result IDs within their preceding assistant tool-call block against the supplied definitions. Only metadata identifying `ai.braindrive.resume-builder` / `resume.profile.read` selects 24,000 characters. A matching display name, a different app's identically named action, another Resume Builder action, or Profile-like result text cannot select the exception. Unmatched results retain 4,000 characters.

The cap covers the complete serialized tool-result message, including its envelope. Above 24,000, the original middle-truncation marker and head/tail split apply. User, assistant, ordinary system, and other tool caps, trusted instruction handling from PR 328, token accounting, selection order, summaries, and aggressive budget fallback remain unchanged. Overall budget pressure can still trim or evict a Profile-read block. Fresh engine results remain subject to the existing engine behavior; this patch changes gateway context preparation only. No general per-tool declared result-size mechanism is introduced.

Canonical documentation impact is the gateway context-preparation paragraph. The Resume Builder README links this note, and the catalog classifies it as internal evidence. The app-chat bridge already supplies the required metadata, so its implementation and contract need no change. No prompt, inference, provider, document storage, renderer, or packaging behavior changes.

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
