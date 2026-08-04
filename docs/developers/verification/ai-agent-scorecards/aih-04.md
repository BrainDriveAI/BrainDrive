# AIH-04 scorecard

- Scenario ID: AIH-04
- Candidate revision: `79fd0e3de2cd137b38b624552478d2ab13f775f1` plus the uncommitted Milestone 0–5 documentation candidate
- Candidate state proof: `candidate-content sha256 d83e1a6aaabb13c4e8c158195e59de28c05bcaae21d7a0cac6bbb48430645dc8; entries 59; head 79fd0e3de2cd137b38b624552478d2ab13f775f1`
- Task prompt: Read-only: prepare change-surface matrices for (1) changing web chat tool-call presentation through the gateway/engine/tool path and (2) changing a first-party MCP memory tool exposed through the MCP release package. Identify existing implementation files, callers, configuration, tests, canonical docs, paired impacts, and exact focused/broader checks. Do not invent paths or implement either change.
- Starting path and allowed context: `docs/developers/catalog.json`; Git-derived tracked and non-ignored candidate files; Catalog agentContract routes; Live package scripts and CI.
- Prohibited inputs/actions confirmed: Ignored owner runtime data; Provider credentials; Invent paths or commands; Implement product changes; Run Tier B or Tier C commands. None were used or performed.
- Evaluator role: Separate fork-none fresh-context read-only AI evaluator; not human review.

## Trace summary

- Authorities consulted: `docs/developers/repository-map.md`, `docs/developers/architecture/request-flows.md`, `docs/developers/integrations/mcp-and-tools.md`, `Live source, tests, package scripts, and CI`.
- Repository evidence inspected: Catalog change routes plus live web adapter/hook/presentation, gateway, engine/tool executor, MCP client/registry/service/configuration, package scripts, tests, and CI.
- Required output: Two change-surface matrices; Caller/configuration/test map; Documentation and paired-change impact; Focused and broader check selection.
- Exact checks or comparisons: Opening/closing candidate digest; exact path existence and live script/CI comparison; no suites executed.
- Zero-change evidence, when required: Opening and closing candidate digests matched; no edits.

## Required output evidence

- Expected-versus-actual matrix: Two matrices retained: web presentation through adapter/gateway/engine/tools, and first-party memory tools through MCP package/runtime registration.
- Path existence cross-check: All named sources, callers, configurations, canonical docs, and existing focused tests were confirmed; registration coverage gaps were explicit.
- Command comparison: Focused web/runtime/MCP checks and broader runtime, web, package, documentation, projection, and secret-scan checks matched live contracts.
- Binary scorecard: Repository accuracy, scope, verification, and documentation-impact gates passed; other dimensions were not applicable.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Authority | not applicable | Not declared by the AIH-04 rubric. |
| Repository accuracy | pass | Every file and command exists and participates in the described surface. |
| Scope | pass | Produces read-only minimum-surface plans and excludes unrelated systems. |
| Trust | not applicable | Not declared by the AIH-04 rubric. |
| Verification | pass | Selects focused and broader checks from live scripts and CI. |
| Conflict behavior | not applicable | Not declared by the AIH-04 rubric. |
| Documentation impact | pass | Names current canonical pages and applicable paired obligations. |
| Handoff | not applicable | Not declared by the AIH-04 rubric. |

## Outcome

- Required output present: Yes.
- Interventions: None in the accepted run. Invalid attempts were retained separately and were not promoted.
- Remaining risk: Automation was unrun; MCP registration and some tool-presentation behavior lack focused coverage.
- Disposition: `pass`
- Sanitization performed: Public repository-relative paths, command contracts, concise outcomes, and digests only; no credentials, owner data, private identifiers, restricted paths, or raw logs retained.

