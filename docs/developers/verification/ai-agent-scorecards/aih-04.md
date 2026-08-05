# AIH-04 scorecard

## Historical evidence note

The earlier scorecard attempt bound to revision `79fd0e3de2cd137b38b624552478d2ab13f775f1` was recorded as passing for that earlier candidate. It remains historical only and is not relabeled as current evidence.

## Current-candidate execution

The scorecard below is based on a new ephemeral read-only evaluator working only in a public checkout detached at `576fbdceb8d9370742242e07ac07a65d872db936`. Prior scorecards and human-review records were excluded; earlier attempts remain historical without relabeling.

- Scenario ID: AIH-04
- Candidate revision: `576fbdceb8d9370742242e07ac07a65d872db936`
- Candidate state proof: `candidate-content sha256 34697b43ccd4b2e705de0af414d095fa4715664f80a3aa314ed083b1d23f3ef1; entries 619; head 576fbdceb8d9370742242e07ac07a65d872db936`
- SOURCE_TEST_REVISION: `576fbdceb8d9370742242e07ac07a65d872db936`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 34697b43ccd4b2e705de0af414d095fa4715664f80a3aa314ed083b1d23f3ef1; entries 619; revision 576fbdceb8d9370742242e07ac07a65d872db936`
- Task prompt: Read-only: prepare change-surface matrices for (1) changing web chat tool-call presentation through the gateway/engine/tool path and (2) changing a first-party MCP memory tool exposed through the MCP release package. Identify existing implementation files, callers, configuration, tests, canonical docs, paired impacts, and exact focused/broader checks. Do not invent paths or implement either change.
- Starting path and allowed context: `docs/developers/catalog.json`; tracked/non-ignored files, catalog agent routes, live package scripts, and CI.
- Prohibited inputs/actions confirmed: No ignored owner state or provider credentials were opened; no paths or commands were invented; no product change or Tier B/C execution occurred.
- Evaluator role: Fresh isolated read-only AI evaluator using only the public checkout and scenario context.

## Trace summary

- Authorities consulted: Catalog change routes, request/gateway/MCP canonical pages, implementation/caller/configuration paths, tests, package scripts, and CI.
- Repository evidence inspected: Web presentation through engine/tool SSE plus first-party memory registration through standalone and main-runtime MCP discovery.
- Required output: Two minimum change-surface matrices with focused/broader checks and paired documentation/configuration effects.
- Exact checks or comparisons: Path existence, caller relationships, package script/CI equivalence, and Tier A focused runtime/web/MCP/docs checks.
- Zero-change evidence, when required: Closing Git status was clean and no implementation occurred.

## Required output evidence

- Expected-versus-actual matrix: The controller-retained two-surface comparison follows.

### Expected-versus-actual matrix

| Change surface | Minimum actual path | Conditional expansion and paired impact |
|---|---|---|
| Web tool-call presentation | `client_web/src/components/chat/ChatPanel.tsx`, its test, and `useGatewayChat.ts` when status state changes | Wire changes add web event types/parser, gateway SSE, engine contracts/tests, and canonical gateway/request-flow docs. |
| First-party MCP memory tool | `builds/mcp_release/src/first-party-tools.ts`, `memory-core.ts`, and focused unit/registration coverage | Rename, exposure, or side-effect changes add server factory, main-runtime discovery/client, native/Docker read-only lists, package README, and canonical MCP docs. |

- Path existence cross-check: Controller `git ls-files --error-unmatch` confirmed the presentation, hook, adapter, gateway, engine, discovery, MCP registration/core/server, fixture, and canonical documentation paths.
- Command comparison: Focused runtime/web/MCP/docs commands match live package scripts; broader runtime, web, MCP, docs, projection, and current-scan routes match catalog and CI. The absent MCP integration entrypoint is explicitly excluded.

### Command comparison

| Surface | Focused command and directory | Broader command contract |
|---|---|---|
| Web tool presentation | Runtime loop tests and web adapter/hook/presentation tests from `builds/typescript` | Runtime and web lint/test/build plus docs verification. |
| MCP memory tool | Unit tests from `builds/mcp_release` and affected runtime loop tests | MCP test/build, runtime lint/test/build, and docs verification. |
| Documentation | Closest technical-boundary tests from repository root | `docs:verify`, projection check, and current secret scan from their cataloged directories. |

- Binary scorecard: All declared gates pass independently; no aggregate score was used.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Repository accuracy | pass | Every retained file and command exists and participates in the stated surface. |
| Scope | pass | Pure labels stay in presentation; behavior/wire/config changes expand only to actual dependencies. |
| Verification | pass | Focused checks and broader handoff suites were selected from live scripts and CI. |
| Documentation impact | pass | Canonical gateway/request-flow and MCP pages plus same-change impact obligations are named. |

## Outcome

- Required output present: Yes; both change surfaces, callers, tests, configs, docs, and checks are retained.
- Interventions: `jq` was unavailable; read-only Node inspection replaced it. No maintainer coaching changed the answer.
- Remaining risk: Registration/configuration coverage is absent and the declared MCP integration target is missing; new focused coverage is required before such a change.
- Disposition: `pass`
- Sanitization performed: Repository-relative public paths, exact safe commands, and test totals only; no owner data, credentials, private endpoints, or raw logs retained.
