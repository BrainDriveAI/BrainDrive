# Change verification

<!-- catalog-contract:start change-verification -->
> **Document contract**
> - Purpose: Map BrainDrive change surfaces to focused checks, broader gates, controlled journeys, and honest evidence.
> - Audience: Recurring contributors, Maintainers, AI coding agents, Verification agents and human reviewers.
> - Status: Current on `dev`; Milestone 2.
> - Owner role: documentation-maintainers.
> - Expected outcome: A contributor runs proportional checks, records exact results, and does not substitute an unrelated green check.
> - Prerequisites: Repository access; Applicable AGENTS.md files; Tooling required by the selected check.
> - Parent: [docs/developers/README.md](./README.md).
> - Adjacent topics: [Repository map](./repository-map.md); [Safe debugging and failure evidence](./debugging.md); [Native TypeScript and web development](./setup/native.md); [Docker development with hot reload](./setup/docker-development.md); [Tauri desktop development](./setup/tauri-desktop.md).
> - Keywords: `verification matrix`, `focused checks`, `Tier A`, `Tier B`.
> - Sources: [`builds/typescript/package.json`](../../builds/typescript/package.json); [`builds/typescript/client_web/package.json`](../../builds/typescript/client_web/package.json); [`builds/typescript/client_web/scripts/run-isolated-e2e.mjs`](../../builds/typescript/client_web/scripts/run-isolated-e2e.mjs); [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
> - Tests: [`tools/docs/test/developer-journeys.test.mjs`](../../tools/docs/test/developer-journeys.test.mjs); [`tools/docs/test/browser-e2e-contract.test.mjs`](../../tools/docs/test/browser-e2e-contract.test.mjs); [`tools/docs/test/commands.test.mjs`](../../tools/docs/test/commands.test.mjs).
<!-- catalog-contract:end change-verification -->

Verification is change-to-check selection, not a single universal command. Run focused checks while iterating, then the broader applicable checks below. Read the output and report exact exits, counts, omissions, and environment blockers.

## Execution tiers

| Tier | Use | Examples |
|---|---|---|
| Tier A | Safe/static routine verification | Lint, typecheck, unit tests, builds, documentation validation, current secret scan |
| Tier B | Controlled local execution with declared state and cleanup | Native dev, Docker dev, Tauri dev, browser E2E after its environment contract is resolved |
| Tier C | Human-authorized or restricted integration/tabletop | Credentialed providers, managed/production environments, destructive recovery, publishing, signing |

A Tier A check never silently launches Tier B or Tier C behavior. A Tier B report names its starting state and cleanup. Tier C is not routine PR evidence.

## Change-to-check matrix

| Change surface | Focused iteration | Required broader checks before handoff | Controlled/manual evidence |
|---|---|---|---|
| Runtime or gateway | Closest Vitest file in `builds/typescript/` | From `builds/typescript/`: `npm run lint`, `npm run test`, `npm run build` | `npm run dev` when startup/config behavior or its documentation changed |
| Engine, tools, auth, memory, secrets, providers | Closest colocated unit/integration tests | Runtime lint, test, and build | Add provider validation only with Tier C authority; preserve memory/secrets boundaries |
| Web client | Closest colocated Vitest test | From `builds/typescript/`: `npm run web:lint`, `npm run web:typecheck`, `npm run web:test`, `npm run web:build` | Inspect affected desktop/mobile states; Playwright only when browser behavior requires it |
| Docker or installer | Shell/PowerShell fixture or targeted installer test | Applicable installer-integrity scripts and Docker image smoke in CI | `./installer/docker/scripts/start.sh dev` for dev-mode claims; record pre-existing state and cleanup |
| Tauri desktop | Closest Rust or web adapter test | From `builds/typescript/`: `npm run desktop:preflight`, `npm run desktop:test` | Native Windows and native macOS `npm run desktop:dev` J-05 reports; WSL/Linux diagnostics cannot satisfy either claim |
| MCP release package | Closest package unit test | From `builds/mcp_release/`: `npm run test`, `npm run build` | Integration test only when the documented environment is available |
| Documentation | Closest `tools/docs/test/*.test.mjs` test | From `builds/typescript/`: `npm run docs:verify`; from root: projection check and current secret scan | Run any setup journey whose claim changed |

Web changes also run typecheck/build even when a focused unit test passes. Provider changes include the negative check that no BrainDrive-owned provider key entered client configuration and no independent Ollama/BYOK choice became credit-dependent.

## Command contracts

| Command | Working directory | Prerequisites / mode | Credentials | Side effects | Expected / failure / cleanup | Tier |
|---|---|---|---|---|---|---|
| `npm run lint` / `npm run test` / `npm run build` | `builds/typescript/` | Installed runtime dependencies; repository mode | None | Build emits ignored `dist/`; tests may create task-owned fixtures | Exit 0; classify lint/test/build; remove only task fixtures | A |
| `npm run web:lint` / `web:typecheck` / `web:test` / `web:build` | `builds/typescript/` | Installed web dependencies | None | Web build emits ignored `client_web/dist/` | Exit 0; classify by command; no tracked cleanup | A |
| `npm run desktop:preflight` | `builds/typescript/` | Node, installed runtime/web/MCP dependencies | None | Emits runtime and MCP build output | Exit 0; classify build/typecheck; generated output may remain | A |
| `npm run desktop:test` | `builds/typescript/` | Preflight prerequisites plus Rust/platform build prerequisites | None | Creates the ignored Tauri development resource root when absent and compiles Cargo test artifacts | Runtime/web/Rust tests exit 0; preserve caches | A |
| `npm run docs:verify` | `builds/typescript/` | Node 22 and Git | None | Reads declared documentation inputs | Tests and check exit 0; correct named diagnostics | A |
| `tools/security/scan-secrets.sh --current` | Repository root | Bash, Git, scanner cache/download prerequisites | None | Creates and removes a temporary snapshot; may populate a verified task cache | Exit 0 with redacted summary; follow repository security guidance | A |
| `npm run dev` | `builds/typescript/` | [Native setup](./setup/native.md) | None for baseline | Starts local services and writes selected runtime state | Observe provider-free baseline; `Ctrl-C` and remove only task-owned state | B |
| `./installer/docker/scripts/start.sh dev` | Repository root | [Docker setup](./setup/docker-development.md); authority over configured bind/UID/GID | None for baseline | Stateful Compose start/reuse; container startup changes target ownership, runs package install, and exposes Vite/proxied API | Observe healthy app/web; restore prior service and verified ownership state; preserve pre-existing volumes/data | B |
| `npm run test:e2e` / `test:e2e:mobile` | `builds/typescript/client_web/` | Installed workspace dependencies and Playwright browsers | Synthetic isolated local account; no provider credential or running model for shell/layout checks | Creates a temporary task root, initializes memory, secrets, local auth, and a credential-free Ollama selection; starts task-owned MCP/gateway/Vite processes on allocated gateway/web ports; writes reports/traces/screenshots only below the temporary artifact root | All selected Playwright projects exit 0; classify browser/runtime/proxy/auth/layout; the runner stops children and removes only its temporary root | B |
| `npm run test:e2e:browser-access` | `builds/typescript/client_web/` | Installed workspace dependencies, Chromium, and a reachable non-loopback IPv4 interface | Synthetic isolated local account; no provider credential or running model | Builds the production web bundle; starts task-owned MCP, production-mode gateway, and the real LAN bridge on allocated ports; uses a two-second access-token policy in disposable auth state; opens Chromium through non-loopback HTTP | The browser proves an insecure context without `crypto.randomUUID`, a non-Secure HttpOnly/Strict refresh cookie, expired-token refresh, app installation, and launch; the runner stops children and removes only its temporary root | B |
| `npm run desktop:dev` | `builds/typescript/` | [Tauri setup](./setup/tauri-desktop.md) | None for baseline | Builds/starts Vite, Rust shell, local services, desktop data/logs | Observe embedded health, desktop transport handoff, and usable main window; `Ctrl-C` and remove only isolated task data | B |

## Tauri claimed-platform evidence

`tauri.conf.json` configures Windows, macOS, and Linux bundle targets. The V1 development-support claim is narrower: native Windows for J-05. macOS and Linux remain configured targets without a V1 J-05 claim. WSL/Linux may supply preflight, test, build, and launch diagnostics, but cannot substitute for native Windows evidence.

The native Windows report is `DEFERRED — REQUIRED BEFORE MILESTONE 7` until integrated. Final readiness must fail closed while it is absent, failed, or incompatible. The earlier WSL dynamic-gateway handoff failure remains a failed diagnostic artifact; it is not a passing journey and is not a waiver.

## OPEN-06 and browser E2E

OPEN-06 is resolved at the source/config level. Ordinary Vite development still proxies to port `8787` by default. The Playwright package commands now use `scripts/run-isolated-e2e.mjs`, which allocates a gateway port, passes it through `VITE_GATEWAY_PROXY_TARGET`, allocates a separate Vite port, and forbids reuse of an existing Vite process.

Playwright is not a basic startup gate. OPEN-10 is resolved by the disposable runner: it initializes task-owned memory and secrets, starts the local runtime, creates a synthetic local account through the public signup contract, selects Ollama only to reach the provider-independent usable shell, and supplies the credentials to the browser helper. It does not access owner state, configure a provider credential, require Ollama to be running, or retain its temporary artifacts after the command. On 2026-08-04 the isolated desktop Chrome selection passed 4 tests with 5 mobile-only skips; after correcting the provider-independent seed, mobile Chrome and mobile Safari passed 12 tests with 6 desktop-only skips. These source-side results resolve the fixture blocker but are not frozen-candidate release evidence.

`test:e2e:browser-access` exercises a different boundary from the Vite runs. It serves the production bundle through `desktop/bridge.ts` on a genuine non-loopback HTTP origin, enables production gateway cookie behavior with an ephemeral internal transport token, and shortens only the disposable account's access-token lifetime. It fails if no reachable non-loopback IPv4 interface exists; loopback is not an accepted substitute.

## Evidence contract

Record the candidate revision, branch/tag, operating system and architecture, tool versions, starting state, exact command and working directory, expected and actual result, interventions, cleanup, remaining risk, disposition, and sanitization. Tier B/C evidence also names the exact target and authority. A skipped command needs a concrete applicability or environment reason. Never paste raw secrets, `.env` contents, owner memory, private identifiers, or unrestricted logs.

Provider-independent AIH-01 through AIH-10 execution follows the [AI coding-agent harness](verification/ai-agent-harness.md). Those read-only scorecards test authority, scope, trust, verification, conflict, documentation impact, and handoff behavior; they are AI evidence, not human review.

### Source revision and evidence revision

Release evidence uses two revisions. `SOURCE_TEST_REVISION` is the full SHA of the clean immutable source candidate on which applicable source checks ran. `SOURCE_CANDIDATE_PROOF` is computed from that commit tree with only the fixed declared evidence outputs excluded. Evidence records embed those two source-identity values. `EVIDENCE_REVISION` is the later full SHA containing the evidence records; it is supplied to or discovered by the checker from the clean checkout and is never embedded in those same records, which would be self-referential.

Run `node tools/docs/candidate-digest.mjs --source-test-revision <full-sha>` before evidence collection. Run `node tools/docs/release-check.mjs --source-test-revision <full-sha> --evidence-revision <full-sha>` for adjudication. The checker may discover one consistent source revision from new evidence records, but explicit inputs are preferred. Carry-forward is permitted only when `git diff --name-only SOURCE_TEST_REVISION..EVIDENCE_REVISION` contains approved evidence outputs and no mapped behavior, guidance, instruction, source, check, schema, or validator path. An arbitrary file never becomes evidence-only merely because it is placed near evidence.

Approved outputs are AIH-01 through AIH-10 scorecards, `platform-reports/windows-j05.json`, `platform-reports/macos-j05.json`, `human-reviews/rev-01.json` through `rev-08.json`, Milestone 7, the M7 trace matrix, and the readiness summary. The catalog declares the same fixed patterns. Platform reports validate against `tools/docs/schemas/platform-report.schema.json`; human records validate against `tools/docs/schemas/human-review.schema.json`.

The V1 REV-01 gate records an explicit repository-owner acceptance decision.
It does not claim the owner is an independent fresh contributor. The record must
retain that limitation, its review date, the exact source revision, scope,
reviewed sources, findings, remaining risk, and sanitized disposition. REV-02
through REV-08 retain their catalog-declared specialist roles; one owner may
combine those roles only through an explicit attributable attestation.

Tauri source, runtime API-base, desktop scripts/configuration, or package-command changes stale native platform evidence. A platform report from an ancestor revision may carry forward only when Git proves the intervening diff has no mapped executable platform impact and the current schema/validator revalidates the report. Documentation claims and evidence-policy changes therefore trigger revalidation, not automatic native reruns. Agent instructions and shared harness/validator contracts stale affected AIH records; catalog routes, scenario prompts/rubrics, scenario sources, and checks stale their mapped scenarios. A reviewed source, security, release, or governance change stales the mapped REV record. Missing, malformed, unsanitized, failed, unattributable, non-native, incompatible, or stale evidence remains blocked.
