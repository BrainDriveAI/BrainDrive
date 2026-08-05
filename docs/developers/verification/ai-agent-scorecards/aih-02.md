# AIH-02 scorecard

## Historical evidence note

The earlier scorecard attempt bound to revision `79fd0e3de2cd137b38b624552478d2ab13f775f1` was recorded as passing for that earlier candidate. It remains historical only and is not relabeled as current evidence.

## Current-candidate execution

The substantive result comes from the fresh read-only execution at `62e438cd296d5dd95c1bd74baff08ba51cc5a11d`. The repository compatibility classifier compared that source to `82697a4b8788118e54c4396ce1cde9565789e3f8` and selected no rerun for this scenario; the result is therefore carried forward and bound to the current candidate. Prior scorecards were excluded from the evaluator checkout, and earlier attempts remain historical above without relabeling.

- Scenario ID: AIH-02
- Candidate revision: `82697a4b8788118e54c4396ce1cde9565789e3f8`
- Candidate state proof: `candidate-content sha256 603bda1986a5326b024926fad28cf78918cef69aecaf370789e0087f3620b7ac; entries 619; head 82697a4b8788118e54c4396ce1cde9565789e3f8`
- SOURCE_TEST_REVISION: `82697a4b8788118e54c4396ce1cde9565789e3f8`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 603bda1986a5326b024926fad28cf78918cef69aecaf370789e0087f3620b7ac; entries 619; revision 82697a4b8788118e54c4396ce1cde9565789e3f8`
- Task prompt: Starting at docs/developers/README.md, map the web client, gateway, auth/config, engine, providers, tools/MCP, memory/secrets, Docker/installer, Tauri desktop, tests/CI, and release surfaces. Cite tracked source or current canonical documentation for every component and do not infer one universal request path.
- Starting path and allowed context: `docs/developers/README.md`; Git-derived tracked and non-ignored files linked from the developer front door and catalog.
- Prohibited inputs/actions confirmed: No archived/external planning or ignored runtime state was used; no component, interface, support claim, or file change was invented.
- Evaluator role: Fresh isolated read-only AI evaluator using only the public checkout and scenario context.

## Trace summary

- Authorities consulted: `docs/developers/README.md`, `docs/developers/catalog.json`, `docs/developers/repository-map.md`, canonical component pages, source, tests, package scripts, and CI.
- Repository evidence inspected: All eleven requested component families plus distinct chat, public configuration, skills, auth, settings, memory, and release routes.
- Required output: A source-backed component map and explicit request/trust boundary distinctions.
- Exact checks or comparisons: Tracked-file verification, scoped source reads, package-script inspection, `docs:verify`, projection check, and closing Git status.
- Zero-change evidence, when required: The evaluator reported a clean worktree before and after inspection.

## Required output evidence

- Component map: The complete component-to-source map is retained in the table below.

### Component map

| Component | Current source/canonical authority | Boundary retained |
|---|---|---|
| Web client | `builds/typescript/client_web/src/api/`, `builds/typescript/client_web/README.md` | Browser proxy and Tauri transport selection are distinct. |
| Gateway | `builds/typescript/gateway/server.ts`, `docs/developers/integrations/gateway.md` | Gateway routes omit the browser `/api` proxy prefix. |
| Auth/config | `builds/typescript/auth/`, `builds/typescript/config.ts`, `docs/developers/architecture/modes-data-and-trust.md` | Transport authorization does not replace request authorization. |
| Engine | `builds/typescript/engine/loop.ts`, `builds/typescript/engine/tool-executor.ts` | Permission filtering occurs before listing and again before execution. |
| Providers | `builds/typescript/adapters/openai-compatible.json`, `docs/developers/integrations/providers.md` | BrainDrive Models, BYOK OpenRouter, and Ollama remain independent. |
| Tools/MCP | `builds/typescript/tools.ts`, `builds/typescript/mcp/`, `builds/mcp_release/` | In-process and MCP discovery paths differ; standalone exposure retains its trust caveat. |
| Memory/secrets | `builds/typescript/memory/`, `builds/typescript/secrets/`, `docs/developers/architecture/memory-and-secrets.md` | Memory and secrets are separate authorities despite migration interactions. |
| Docker/installer | `installer/docker/`, `docs/developers/integrations/deployment.md` | Dev, local, and production modes have different process and side-effect shapes. |
| Tauri desktop | `builds/typescript/src-tauri/`, `docs/developers/setup/tauri-desktop.md` | Windows is the V1 native claim; other configured targets are unclaimed. |
| Tests/CI | `docs/developers/verification.md`, `.github/workflows/ci.yml` | CI suites do not imply browser-E2E or native desktop proof. |
| Release | `docs/developers/releases.md`, `installer/docker/scripts/release-production.sh` | App, MCP package, and installer version/evidence domains remain distinct. |

- Source cross-check: Controller verification confirmed every retained path is tracked, live package scripts exist, and the Node 22 documentation boundary tests pass.
- Boundary notes: Chat, public configuration discovery, skills, auth/session, provider/settings, memory, and release operations are separate route families; no universal request path is asserted.
- Binary scorecard: All declared gates pass independently; no aggregate score was used.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Authority | pass | Current catalog routes and executable source/tests were used. |
| Repository accuracy | pass | Every requested component maps to tracked source or canonical documentation. |
| Trust | pass | Auth, secrets, deployment, providers, MCP exposure, and release boundaries remain distinct. |

## Outcome

- Required output present: Yes; the substantive component map and source/boundary cross-check are retained.
- Interventions: None in the accepted run.
- Remaining risk: Static and Tier A checks do not prove live providers, native desktop handoff, Docker lifecycle behavior, or release publication.
- Disposition: `pass`
- Sanitization performed: Repository-relative public paths and concise test totals only; absolute evaluator paths, owner data, credentials, private systems, and raw logs were removed.
