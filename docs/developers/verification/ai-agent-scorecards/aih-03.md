# AIH-03 scorecard

- Scenario ID: AIH-03
- Candidate revision: `d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- Candidate state proof: `candidate-content sha256 8fe40a01593323b8c35fe1bb11d41b8dce82ed3cb13e604b5084d17ae955e741; entries 0; head d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- SOURCE_TEST_REVISION: `d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 1b949797d2f8dedeb9b336e5e52ddb484705683df83923a58f78258c9492b9e7; entries 1042; revision d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- Task prompt: Using only Git-derived tracked and non-ignored candidate repository evidence, determine which paths currently govern native setup and the web-to-gateway contract. Label uncommitted candidate pages honestly. Classify builds/typescript/New-User-Setup.md, builds/typescript/client_web/src/api/CONTRACT.md, its preserved history, ROADMAP.md, and milestone records without promoting legacy, history, plans, or evidence into current technical authority.
- Starting path and allowed context: `docs/developers/catalog.json`; tracked/non-ignored candidates, catalog lifecycle metadata, current source, tests, and package scripts.
- Prohibited inputs/actions confirmed: No untracked planning, prior coaching, lifecycle promotion, or file modification occurred.
- Evaluator role: Fresh-context, read-only AI evaluator; primary implementer independently cross-checked lifecycle and source claims.

## Trace summary

- Authorities consulted: Root/scoped instructions, catalog lifecycle/routes, native setup, gateway/request-flow pages, current package scripts, client/gateway source, and focused docs tests.
- Repository evidence inspected: The five named legacy/history/planning/evidence classes, their replacements, current API adapter/hook/runtime-base source, gateway routes, and orientation/boundary tests.
- Required output: Status-aware selection, replacement/history routes, and executable-evidence precedence.
- Exact checks or comparisons: Git tracked/ignored/status checks, catalog extraction, source-revision blob comparison, targeted source/doc reads, and two focused documentation test files.
- Zero-change evidence, when required: All compared blobs matched the source revision; staged, unstaged, and untracked checks stayed empty.

## Required output evidence

- Source-selection trace: Native setup routes to `docs/developers/setup/native.md`; web-to-gateway guidance routes to `docs/developers/integrations/gateway.md` and `docs/developers/architecture/request-flows.md`; exact behavior remains in current source/tests.
- Lifecycle classifications: `builds/typescript/New-User-Setup.md` is legacy; `client_web/src/api/CONTRACT.md` is a historical pointer; `docs/developers/history/gateway-contract-original-client.md` is historical; `ROADMAP.md` is current planning, not technical authority; milestone/acceptance records are non-authoritative evidence. No uncommitted candidate pages existed.
- Current authority: `builds/typescript/package.json`, `scripts/dev-runtime.mjs`, Vite config, `gateway-adapter.ts`, `useGatewayChat.ts`, `runtime-api-base.ts`, `gateway/server.ts`, and their tests back the current canonical routes.
- Binary scorecard: Every declared must-pass dimension was adjudicated independently from lifecycle metadata and executable evidence.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Authority | pass | One current canonical route plus current source/tests was selected for each question. |
| Repository accuracy | pass | Every named path was classified using catalog lifecycle data and verified tracked at the pinned revision. |
| Scope | pass | Only public tracked/non-ignored evidence was used; external planning and repository writes were excluded. |

## Outcome

- Required output present: Yes; all named paths, replacements, history route, and precedence rules are explicit.
- Interventions: A search surfaced a pre-existing scorecard line; it was excluded, and the primary implementer rechecked classifications directly.
- Remaining risk: This establishes authority at the source revision but does not prove native startup or live browser/gateway behavior.
- Disposition: `pass`
- Sanitization performed: Public repository-relative paths and summarized test results only; local paths, private material, and raw output were excluded.
