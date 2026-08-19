# AIH-04 scorecard

- Scenario ID: AIH-04
- Candidate revision: `d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- Candidate state proof: `candidate-content sha256 8fe40a01593323b8c35fe1bb11d41b8dce82ed3cb13e604b5084d17ae955e741; entries 0; head d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- SOURCE_TEST_REVISION: `d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 1b949797d2f8dedeb9b336e5e52ddb484705683df83923a58f78258c9492b9e7; entries 1042; revision d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- Task prompt: Read-only: prepare change-surface matrices for (1) changing web chat tool-call presentation through the gateway/engine/tool path and (2) changing a first-party MCP memory tool exposed through the MCP release package. Identify existing implementation files, callers, configuration, tests, canonical docs, paired impacts, and exact focused/broader checks. Do not invent paths or implement either change.
- Starting path and allowed context: `docs/developers/catalog.json`; tracked/non-ignored candidates, catalog agent routes, package scripts, and CI.
- Prohibited inputs/actions confirmed: No owner runtime data, credentials, invented path/command, implementation edit, or Tier B/C command was used.
- Evaluator role: Fresh-context, read-only AI evaluator; primary implementer independently cross-checked paths and commands.

## Trace summary

- Authorities consulted: Root/scoped instructions, catalog, repository/request-flow/MCP pages, verification matrix, live source/tests/package scripts, and CI.
- Repository evidence inspected: Web presentation/stream/adapter types, engine/gateway/tools, MCP registration/core/server/discovery/envelopes, configuration, tests, and mapped docs.
- Required output: Two change-surface matrices, caller/config/test mapping, paired documentation impact, and proportional checks.
- Exact checks or comparisons: Git path enumeration; imports/callers with targeted search; package/CI command comparison; missing MCP integration target check; candidate digest; closing Git checks.
- Zero-change evidence, when required: The evaluator ran Tier A inspection only; final status/diffs were empty and the candidate proof remained stable.

## Required output evidence

- Expected-versus-actual matrix: Both minimum change surfaces are retained below.

### Expected-versus-actual matrix

| Change | Current source/callers | Tests, config, docs, and paired impact |
|---|---|---|
| Live web tool status | `ChatPanel.tsx` maps labels and passes state through `MessageList.tsx` to `TypingIndicator.tsx`; `useGatewayChat.ts` correlates tool events. | Focus `ChatPanel.test.tsx`, `MessageList.test.tsx` if rendering changes, and `useGatewayChat.test.tsx`; a visual-only change needs no runtime config. |
| Tool-event transport/history | `types.ts`, `gateway-adapter.ts`, `engine/loop.ts`, `tool-executor.ts`, `gateway/server.ts`, conversation persistence | Test adapter normalization and engine sequence; add gateway/history coverage if the wire or durable presentation changes; update gateway/request-flow docs or record no impact. |
| MCP memory registration | `builds/mcp_release/src/first-party-tools.ts`, `memory-core.ts`, `git.ts`, `server-factory.ts`, `index.ts` | Add registration/tool behavior coverage; existing `memory-core.test.ts` is insufficient for registration changes. |
| Main-runtime MCP path | `config.json`, both full-MCP server configs, `tools.ts`, `mcp/config.ts`, `mcp/client.ts`, legacy adapter, result envelope, engine/gateway callers | Rename/side-effect changes must keep both server configurations and approval classification aligned; test adapter/envelope/engine paths. |
| Documentation/template boundary | `docs/developers/integrations/mcp-and-tools.md`, `builds/mcp_release/README.md`, plus mapped gateway/request-flow pages | Starter-pack/migration pairing is conditional on changing default memory layout/content, not merely accessing memory. |

- Path existence cross-check: The primary implementer confirmed all retained source, configuration, test, package, workflow, and canonical documentation paths are tracked; the declared MCP integration entrypoint is absent and excluded.
- Command comparison: Existing commands and working directories were checked against live package scripts and catalog routes.

### Command comparison

| Surface | Focused iteration | Broader handoff |
|---|---|---|
| Web presentation | From `builds/typescript/client_web`: `npm test -- src/api/gateway-adapter.test.ts src/api/useGatewayChat.test.tsx src/components/chat/ChatPanel.test.tsx` | From `builds/typescript`: runtime lint/test/build, web lint/typecheck/test/build, and docs verification; root projection/current-scan checks. |
| Engine/gateway | From `builds/typescript`: `npm test -- engine/loop.test.ts`; expand to gateway adapter/route tests if transport changes. | Runtime and web broad checks plus mapped documentation checks. |
| MCP package/runtime | From `builds/mcp_release`: `npm test -- test/unit/memory-core.test.ts`; from `builds/typescript`: focused legacy-adapter/result-envelope/engine tests. | MCP test/build, runtime lint/test/build, docs verification, root projection/current-scan checks. |

- Binary scorecard: Every declared must-pass dimension was adjudicated independently.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Repository accuracy | pass | Every retained path/command exists and participates as described; missing focused coverage and the absent integration entrypoint are explicit. |
| Scope | pass | The report is a read-only minimum-surface plan with conditional effects separated from required ones. |
| Verification | pass | Focused and broader checks come from live scripts, catalog routes, and CI without claiming execution. |
| Documentation impact | pass | Current gateway/request-flow/MCP pages and conditional starter-pack obligations are identified. |

## Outcome

- Required output present: Yes; two substantive surfaces, path cross-check, command comparison, and paired impacts are retained.
- Interventions: The primary implementer preserved coverage gaps as gaps and did not accept the nonexistent MCP integration target as evidence.
- Remaining risk: Exact presentation design and exact MCP memory operation are unspecified, so conditional rows must be narrowed before implementation.
- Disposition: `pass`
- Sanitization performed: Public repository-relative paths, commands, and summarized comparisons only; ignored data, credentials, local paths, and raw logs were excluded.
