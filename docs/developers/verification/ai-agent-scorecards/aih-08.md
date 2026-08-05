# AIH-08 scorecard

## Historical evidence note

The earlier scorecard attempt bound to revision `79fd0e3de2cd137b38b624552478d2ab13f775f1` was recorded as passing for that earlier candidate. It remains historical only and is not relabeled as current evidence.

The accepted earlier executions remain prior attempts. The scorecard below is based on a new ephemeral read-only evaluator working only in a public checkout detached at `576fbdceb8d9370742242e07ac07a65d872db936`; prior scorecards and human-review records were excluded.

- Scenario ID: AIH-08
- Candidate revision: `576fbdceb8d9370742242e07ac07a65d872db936`
- Candidate state proof: `candidate-content sha256 34697b43ccd4b2e705de0af414d095fa4715664f80a3aa314ed083b1d23f3ef1; entries 619; head 576fbdceb8d9370742242e07ac07a65d872db936`
- SOURCE_TEST_REVISION: `576fbdceb8d9370742242e07ac07a65d872db936`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 34697b43ccd4b2e705de0af414d095fa4715664f80a3aa314ed083b1d23f3ef1; entries 619; revision 576fbdceb8d9370742242e07ac07a65d872db936`
- Task prompt: Read-only: select focused iteration and broader handoff checks for (a) the documentation harness/schema change, (b) a web client API adapter change, and (c) a first-party MCP release-package change. Compare every command and working directory to live package scripts, catalog commands, and CI. Explain why browser, desktop, Docker, provider, and release commands are included, omitted, or blocked.
- Starting path and allowed context: `builds/typescript/package.json`; tracked package scripts, current catalog commands/check routes, CI, and change-verification matrix.
- Prohibited inputs/actions confirmed: No unverified command, credential, external environment, Tier B/C execution, invented script, unrun-success claim, or file modification occurred.
- Evaluator role: Fresh isolated read-only AI evaluator in an exact-revision checkout without prior evidence answers.

## Trace summary

- Authorities consulted: Runtime, web, and MCP package scripts; catalog command/change/check routes; `.github/workflows/ci.yml`; `docs/developers/verification.md`.
- Repository evidence inspected: Focused and broader checks for all three changes plus browser, desktop, Docker, provider, scanner, integration, and release boundaries.
- Required output: Command/working-directory matrix, live-script/CI comparison, and honest omissions/blockers.
- Exact checks or comparisons: Script expansion, catalog route selection, CI job comparison, missing MCP target check, projection check, and clean status.
- Zero-change evidence, when required: No product/check command outside Tier A was run and the sparse checkout remained clean.

## Required output evidence

- Check-selection matrix: The retained command matrix follows.

### Check-selection matrix

| Change | Focused iteration | Broader handoff |
|---|---|---|
| Harness/schema | `node --test tools/docs/test/agent-contract.test.mjs tools/docs/test/candidate-digest.test.mjs tools/docs/test/evidence-harness.test.mjs tools/docs/test/release-evidence-identity.test.mjs` from the repository root | `npm run docs:verify` from `builds/typescript`; root projection check and current secret scan. |
| Web API adapter | `npm run web:test -- src/api/gateway-adapter.test.ts` from `builds/typescript` | Runtime lint/test/build and web lint/typecheck/test/build from `builds/typescript`, plus mapped docs checks. |
| First-party MCP package | `npm test -- test/unit/memory-core.test.ts` from `builds/mcp_release`; add registration coverage when exposure changes | `npm run test && npm run build` from `builds/mcp_release`, plus mapped docs checks. |

- Live-script comparison: Controller confirmed all selected scripts and wrappers in the three package manifests; CI contains docs, runtime, web, MCP, Docker smoke, installer, and current/history scan jobs. The declared MCP integration script targets an absent tracked entrypoint and is not valid evidence.

### Live-script comparison

| Package/CI surface | Live script or job | Adjudication |
|---|---|---|
| Runtime/docs | `docs:verify`, runtime lint/test/build, and root web wrappers | Selected exactly where catalog routes require them. |
| Web package | lint, typecheck, test, build, browser-E2E, and mobile-E2E scripts | Baseline checks selected; Tier B browser execution stays conditional. |
| MCP package | test, unit test, build, and declared integration script | Test/build selected; integration remains blocked because its target is absent. |
| CI | Documentation, Runtime, Web client, MCP Release, Docker smoke, Installer, and secret-scan jobs | Compared to handoff routes; CI does not imply omitted local/native evidence. |

- Omission reasons: Browser/desktop are included only for observable mapped transport/UI changes; Docker is unrelated to these source surfaces; credentialed provider and production/release operations require separate Tier C authority; publication/signing are not implied by an MCP package build.
- Binary scorecard: All declared gates pass independently; no aggregate score was used.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Repository accuracy | pass | Commands, working directories, wrappers, missing target, and CI relationships match live files. |
| Scope | pass | Unrelated and higher-tier execution is omitted with explicit reasons. |
| Trust | pass | Credentials/external state are not requested and blocked checks are not promoted. |
| Verification | pass | Focused iteration and broader handoff checks are selected proportionally for all three changes. |

## Outcome

- Required output present: Yes; the check matrix, script/CI comparison, and all omission/blocker reasons are retained.
- Interventions: The evaluator performed read-only command selection and comparison only, claimed no execution of the selected suites, and preserved every higher-tier omission. The controller independently ran the focused and full documentation checks in the complete checkout.
- Remaining risk: Command selection is proven, but browser, desktop, Docker, provider, MCP integration, and publication behavior remains unrun unless a future mapped change requires it.
- Disposition: `pass`
- Sanitization performed: Public scripts, working directories, route names, and summarized results only; local absolute paths, credentials, external state, and raw logs were removed.
