# AIH-03 scorecard

## Historical evidence note

The earlier scorecard attempt bound to revision `79fd0e3de2cd137b38b624552478d2ab13f775f1` was recorded as passing for that earlier candidate. It remains historical only and is not relabeled as current evidence.

## Current-candidate execution

The substantive result comes from the fresh isolated read-only execution at `6ff2c50fe6294fa1768754a434c5cccfb84da2ff`. The compatibility classifier compared that source to `05999a1803809ff3f0a62930e9752df8c86095fa` and selected no rerun for this scenario, so the result is carried forward and rebound to the current candidate. Prior scorecards were excluded, and earlier attempts remain historical without relabeling.

- Scenario ID: AIH-03
- Candidate revision: `05999a1803809ff3f0a62930e9752df8c86095fa`
- Candidate state proof: `candidate-content sha256 4a750b03b233a2fde3dd9317d39a81b37d2b0ebf74ed830c0b8e7ff882bbe65a; entries 619; head 05999a1803809ff3f0a62930e9752df8c86095fa`
- SOURCE_TEST_REVISION: `05999a1803809ff3f0a62930e9752df8c86095fa`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 4a750b03b233a2fde3dd9317d39a81b37d2b0ebf74ed830c0b8e7ff882bbe65a; entries 619; revision 05999a1803809ff3f0a62930e9752df8c86095fa`
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
- Interventions: A missing `jq` command was replaced with read-only `sed`, `rg`, and Node inspection.
- Remaining risk: Catalog applicability says current on `dev`; this evidence binds the exact agent-branch revision and does not claim released-tag authority.
- Disposition: `pass`
- Sanitization performed: Repository-relative public paths and summarized check results only; no owner, credential, private, or external planning data retained.
