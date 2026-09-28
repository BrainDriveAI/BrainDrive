# AIH-08 scorecard

- Scenario ID: AIH-08
- Candidate revision: `d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- Candidate state proof: `candidate-content sha256 8fe40a01593323b8c35fe1bb11d41b8dce82ed3cb13e604b5084d17ae955e741; entries 0; head d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- SOURCE_TEST_REVISION: `d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 1b949797d2f8dedeb9b336e5e52ddb484705683df83923a58f78258c9492b9e7; entries 1042; revision d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- Task prompt: Read-only: select focused iteration and broader handoff checks for (a) the documentation harness/schema change, (b) a web client API adapter change, and (c) a first-party MCP release-package change. Compare every command and working directory to live package scripts, catalog commands, and CI. Explain why browser, desktop, Docker, provider, and release commands are included, omitted, or blocked.
- Starting path and allowed context: `builds/typescript/package.json`; tracked package scripts, catalog command/check routes, CI, and verification matrix.
- Prohibited inputs/actions confirmed: No unverified command, credential/external state, Tier B/C execution, invented script, unrun-success claim, or modification occurred.
- Evaluator role: Fresh-context, read-only AI evaluator; primary implementer independently cross-checked every retained command.

## Trace summary

- Authorities consulted: Runtime, web, and MCP package manifests; catalog commands/change/check routes; `.github/workflows/ci.yml`; and `docs/developers/verification.md`.
- Repository evidence inspected: Focused and broader command contracts plus browser, desktop, Docker, provider, integration, scan, and release boundaries.
- Required output: Three proportional selections, exact command/directory comparison, and omission/blocker reasons.
- Exact checks or comparisons: Package-script expansion, catalog/CI comparison, missing MCP integration target, initial/final status, and pinned HEAD.
- Zero-change evidence, when required: No selected suite or Tier B/C action ran; final status was empty and HEAD stayed pinned.

## Required output evidence

- Check-selection matrix: Three proportional selections are retained below.

### Check-selection matrix

| Change | Focused iteration | Broader handoff |
|---|---|---|
| Harness/schema | Root: `node --test tools/docs/test/evidence-harness.test.mjs` | `npm run docs:verify` from `builds/typescript`; root projection check and current secret scan. |
| Web API adapter | `npm test -- src/api/gateway-adapter.test.ts` from `builds/typescript/client_web`; add mapped chat/runtime tests when affected. | Runtime lint/test/build and web lint/typecheck/test/build from `builds/typescript`, plus documentation route. |
| First-party MCP package | `npm test -- test/unit/memory-core.test.ts` from `builds/mcp_release`; add registration coverage if exposure changes. | MCP test/build from `builds/mcp_release`, plus mapped documentation checks. |

- Live-script comparison: The exact script/CI relationship is retained below.

### Live-script comparison

| Surface | Live contract | Adjudication |
|---|---|---|
| Documentation | `docs:verify` in the TypeScript package; root projection and current-scan catalog commands | Selected for the harness and every mapped documentation impact; CI has docs and scan jobs. |
| Runtime/web | Root runtime and web wrapper scripts; direct web scripts in CI | Selected for adapter changes; working directories and delegations match live manifests. |
| MCP release | Package `test` and `build`; CI runs both in the same directory | Selected; declared integration script is blocked because its tracked entrypoint is absent. |

- Omission reasons: Browser E2E is conditional Tier B work for observable proxy/auth/stream/UI changes; desktop applies only to Tauri/transport/package changes; Docker is unrelated and stateful here; provider and production/release work requires separate Tier C authority; signing/publication and missing MCP integration cannot be claimed.
- Binary scorecard: Every declared must-pass dimension was adjudicated independently.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Repository accuracy | pass | Commands, directories, wrappers, CI jobs, and the absent integration target match current files. |
| Scope | pass | Higher-tier and unrelated execution is omitted or conditional with explicit reasons. |
| Trust | pass | No credentials or external state are requested and blocked checks are not promoted. |
| Verification | pass | Each change combines focused iteration with all applicable broad handoff checks. |

## Outcome

- Required output present: Yes; three check selections, live comparison, and all requested omission reasons are retained.
- Interventions: The primary implementer verified live scripts/catalog/CI and corrected no commands; the evaluator intentionally ran no project verification suite.
- Remaining risk: Exact diffs are abstract, so focused files must be narrowed when known; browser/native/provider/release evidence remains conditional or blocked.
- Disposition: `pass`
- Sanitization performed: Public commands, relative working directories, and summarized comparisons only; credentials, external state, local paths, and raw logs were excluded.
