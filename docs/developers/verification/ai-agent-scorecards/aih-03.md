# AIH-03 scorecard

## Historical evidence note

The earlier scorecard attempt bound to revision `79fd0e3de2cd137b38b624552478d2ab13f775f1` was recorded as passing for that earlier candidate. It remains historical only and is not relabeled as current evidence.

## Current-candidate execution

The first new evaluator consulted an installed planning skill outside the allowed repository-only context and was rejected. The scorecard below uses a second fresh ephemeral read-only evaluator with plugin and skill discovery disabled, working only in a public checkout detached at `576fbdceb8d9370742242e07ac07a65d872db936`. Prior scorecards and human-review records were excluded; earlier attempts remain historical without relabeling.

- Scenario ID: AIH-03
- Candidate revision: `576fbdceb8d9370742242e07ac07a65d872db936`
- Candidate state proof: `candidate-content sha256 34697b43ccd4b2e705de0af414d095fa4715664f80a3aa314ed083b1d23f3ef1; entries 619; head 576fbdceb8d9370742242e07ac07a65d872db936`
- SOURCE_TEST_REVISION: `576fbdceb8d9370742242e07ac07a65d872db936`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 34697b43ccd4b2e705de0af414d095fa4715664f80a3aa314ed083b1d23f3ef1; entries 619; revision 576fbdceb8d9370742242e07ac07a65d872db936`
- Task prompt: Using only Git-derived tracked and non-ignored candidate repository evidence, determine which paths currently govern native setup and the web-to-gateway contract. Label uncommitted candidate pages honestly. Classify builds/typescript/New-User-Setup.md, builds/typescript/client_web/src/api/CONTRACT.md, its preserved history, ROADMAP.md, and milestone records without promoting legacy, history, plans, or evidence into current technical authority.
- Starting path and allowed context: `docs/developers/catalog.json`; Git-derived tracked/non-ignored files, catalog lifecycle metadata, current source, tests, and package scripts.
- Prohibited inputs/actions confirmed: No untracked planning, prior conversation, or maintainer coaching was used; legacy/history/roadmap/evidence records were not promoted; no file changed.
- Evaluator role: Fresh isolated read-only AI evaluator using only the public checkout and scenario context.

## Trace summary

- Authorities consulted: Catalog lifecycle and bindings, `docs/developers/setup/native.md`, gateway/request-flow pages, live source, tests, and package scripts.
- Repository evidence inspected: All named legacy, historical, roadmap, and milestone records plus current native and web-to-gateway sources.
- Required output: Honest worktree classification and one current governing route for each question.
- Exact checks or comparisons: Git tracking/status/diffs, lifecycle metadata, live script/source comparison, docs check, and focused journey/boundary tests.
- Zero-change evidence, when required: All named pages were tracked and clean; no uncommitted Markdown or JSON candidate pages were present.

## Required output evidence

- Source-selection trace: Native setup routes to `docs/developers/setup/native.md`; web-to-gateway routes to `docs/developers/integrations/gateway.md` plus `docs/developers/architecture/request-flows.md`, with live source/tests defining exact behavior.
- Lifecycle classifications: `builds/typescript/New-User-Setup.md` is legacy; `builds/typescript/client_web/src/api/CONTRACT.md` is a historical pointer; `docs/developers/history/gateway-contract-original-client.md` is historical; `ROADMAP.md` is current product planning, not technical authority; milestone records are current non-authoritative evidence.
- Current authority: `builds/typescript/scripts/dev-runtime.mjs`, Vite configuration, gateway source, web adapters, auth middleware, engine/tool source, and their tests back the current canonical pages.
- Binary scorecard: All declared gates pass independently; no aggregate score was used.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Authority | pass | One current canonical route plus executable evidence was selected for each question. |
| Repository accuracy | pass | Every named path was classified according to current catalog lifecycle metadata. |
| Scope | pass | Only tracked/non-ignored checkout evidence was used and repository state was unchanged. |

## Outcome

- Required output present: Yes; source-selection trace, lifecycle classifications, and current authority are retained.
- Interventions: The rejected first run is preserved above as a failed context-boundary attempt. In the accepted rerun, unavailable `jq` and one incorrect catalog-field assumption were replaced by narrower read-only Node, `sed`, and `rg` inspection without changing the answer.
- Remaining risk: Catalog applicability says current on `dev`; this evidence binds the exact agent-branch revision and does not claim released-tag authority.
- Disposition: `pass`
- Sanitization performed: Repository-relative public paths and summarized check results only; no owner, credential, private, or external planning data retained.
