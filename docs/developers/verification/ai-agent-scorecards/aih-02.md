# AIH-02 scorecard

- Scenario ID: AIH-02
- Candidate revision: `d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- Candidate state proof: `candidate-content sha256 8fe40a01593323b8c35fe1bb11d41b8dce82ed3cb13e604b5084d17ae955e741; entries 0; head d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- SOURCE_TEST_REVISION: `d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 1b949797d2f8dedeb9b336e5e52ddb484705683df83923a58f78258c9492b9e7; entries 1042; revision d89ba6d5d9cb8a34f5afd801e887701de323dfed`
- Task prompt: Starting at docs/developers/README.md, map the web client, gateway, auth/config, engine, providers, tools/MCP, memory/secrets, Docker/installer, Tauri desktop, tests/CI, and release surfaces. Cite tracked source or current canonical documentation for every component and do not infer one universal request path.
- Starting path and allowed context: `docs/developers/README.md`; Git-derived tracked and non-ignored files linked by the developer front door and catalog.
- Prohibited inputs/actions confirmed: No archived planning, ignored runtime state, invented component, universal-flow claim, or modification was used.
- Evaluator role: Fresh-context, read-only AI evaluator; primary implementer independently cross-checked paths and boundaries.

## Trace summary

- Authorities consulted: Root/scoped instructions, `docs/developers/README.md`, `catalog.json`, repository and architecture maps, integration pages, verification/release pages, live source, package scripts, tests, and CI.
- Repository evidence inspected: The source/config/test paths summarized in the component map, plus source-adjacent READMEs and `.github/workflows/ci.yml`.
- Required output: Component-to-source map, representative tests/trust boundaries, and variant-flow caveat.
- Exact checks or comparisons: Tracked-path verification; route/auth/SSE/provider/tool/memory/Compose/Tauri/script/CI/release comparisons; version comparison; focused docs tests; closing Git checks.
- Zero-change evidence, when required: HEAD stayed at the source revision and staged, unstaged, and non-ignored status remained empty.

## Required output evidence

- Component map: The substantive component-to-source mapping is retained below.

### Component map

| Surface | Current source and representative tests | Boundary |
|---|---|---|
| Web client | `client_web/src/api/gateway-adapter.ts`, `useGatewayChat.ts`, `runtime-api-base.ts`, and colocated tests | React/browser state; `/api` is a browser/deployment prefix and Tauri resolves loopback transport separately. |
| Gateway/auth/config | `gateway/server.ts`, `auth/middleware.ts`, `config.ts`, auth route/config tests | Public, authenticated local, desktop-token, and managed branches are distinct; gateway routes do not universally enter the engine. |
| Engine/providers | `engine/loop.ts`, `engine/tool-executor.ts`, `adapters/openai-compatible.json`, provider activation and resolver tests | Provider profiles and credentials remain independent; authorization is passed into tool execution. |
| Tools/MCP | `tools.ts`, `mcp/config.ts`, `mcp/client.ts`, `builds/mcp_release/src/first-party-tools.ts`, MCP envelope/core tests | Configured sources determine participation; first-party, custom, and legacy paths are not one support surface. |
| Memory/secrets | `memory/backup.ts`, `memory/migration.ts`, `secrets/vault.ts`, migration/backup/resolver tests | File-backed memory and encrypted secret storage are separate even when migration coordinates both. |
| Docker/installer | `installer/docker/compose.*.yml`, entrypoint/bootstrap/lifecycle scripts and integrity/smoke tests | Dev/local/prod topology and side effects differ; deployment is not a universal request path. |
| Tauri desktop | `src-tauri/src/main.rs`, `tauri.conf.json`, desktop staging and runtime-base tests | Native supervision and tokenized loopback transport wrap the web client; documented V1 claim is native Windows. |
| Tests/CI/release | Package scripts, `.github/workflows/ci.yml`, `docs/developers/verification.md`, `releases.md`, release helper tests | Verification is change-routed; app/web/Tauri and MCP version domains remain separate; publication is restricted. |

- Source cross-check: The primary implementer confirmed the cited representative paths are tracked, package scripts exist, the candidate digest is unchanged, and the evaluator's focused documentation tests reported 30 passing tests.
- Boundary notes: Chat, public configuration, skills, auth/session, provider settings, memory operations, desktop startup, Docker lifecycle, and release publication have different participants and trust boundaries; no universal request flow is asserted.
- Binary scorecard: Every declared must-pass dimension was adjudicated independently from current source and tests.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Authority | pass | Current catalog routes, canonical pages, source, tests, scripts, and CI were used rather than planning or prior evidence. |
| Repository accuracy | pass | All requested components map to existing representative paths and tests, with conditional gaps and absent MCP integration entrypoint called out. |
| Trust | pass | Auth, secrets, provider choice, memory, deployment, native transport, verification, and publication remain separate boundaries. |

## Outcome

- Required output present: Yes; all requested surfaces, tests, boundaries, and variant flows are retained.
- Interventions: The primary implementer checked path existence and preserved evaluator-identified coverage gaps as risks rather than silently resolving them.
- Remaining risk: Static mapping does not prove managed deployment, live providers, Docker startup, native Windows behavior, or publication; managed-auth and MCP registration coverage gaps remain.
- Disposition: `pass`
- Sanitization performed: Public repository-relative paths and summarized checks only; ignored/runtime/private data and raw logs were excluded.
