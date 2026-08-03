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
> - Sources: [`builds/typescript/package.json`](../../builds/typescript/package.json); [`builds/typescript/client_web/package.json`](../../builds/typescript/client_web/package.json); [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
> - Tests: [`tools/docs/test/developer-journeys.test.mjs`](../../tools/docs/test/developer-journeys.test.mjs); [`tools/docs/test/commands.test.mjs`](../../tools/docs/test/commands.test.mjs).
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
| `npm run desktop:test` | `builds/typescript/` | Preflight prerequisites plus Rust/platform build prerequisites | None | Compiles Cargo test artifacts | Runtime/web/Rust tests exit 0; preserve caches | A |
| `npm run docs:verify` | `builds/typescript/` | Node 22 and Git | None | Reads declared documentation inputs | Tests and check exit 0; correct named diagnostics | A |
| `tools/security/scan-secrets.sh --current` | Repository root | Bash, Git, scanner cache/download prerequisites | None | Creates and removes a temporary snapshot; may populate a verified task cache | Exit 0 with redacted summary; follow repository security guidance | A |
| `npm run dev` | `builds/typescript/` | [Native setup](./setup/native.md) | None for baseline | Starts local services and writes selected runtime state | Observe provider-free baseline; `Ctrl-C` and remove only task-owned state | B |
| `./installer/docker/scripts/start.sh dev` | Repository root | [Docker setup](./setup/docker-development.md); authority over configured bind/UID/GID | None for baseline | Stateful Compose start/reuse; container startup changes target ownership, runs package install, and exposes Vite/proxied API | Observe healthy app/web; restore prior service and verified ownership state; preserve pre-existing volumes/data | B |
| `npm run test:e2e` / `test:e2e:mobile` | `builds/typescript/client_web/` | Installed browsers; task-owned runtime at Vite proxy target; reproducible synthetic local-auth fixture (OPEN-10, unresolved) | Synthetic isolated local account; no provider credential for shell/layout checks | Starts/reuses Vite; writes HTML report; trace on retry and screenshot on failure | Blocked until auth fixture exists; classify browser/runtime/proxy/auth/layout; stop task processes and sanitize conditional artifacts | B |
| `npm run desktop:dev` | `builds/typescript/` | [Tauri setup](./setup/tauri-desktop.md) | None for baseline | Builds/starts Vite, Rust shell, local services, desktop data/logs | Observe embedded health, desktop transport handoff, and usable main window; `Ctrl-C` and remove only isolated task data | B |

## Tauri claimed-platform evidence

`tauri.conf.json` configures Windows, macOS, and Linux bundle targets. The V1 development-support claim is narrower: native Windows and native macOS for J-05. WSL/Linux may supply preflight, test, build, and launch diagnostics, but cannot be used as evidence for either native claim and is not itself a claimed J-05 platform.

Both native reports are `DEFERRED — REQUIRED BEFORE MILESTONE 7`. Final readiness must fail closed while either report is absent. The earlier WSL dynamic-gateway handoff failure remains a failed diagnostic artifact; it is not a passing journey and is not a waiver.

## OPEN-06 and browser E2E

OPEN-06 is resolved at the source/config level for this milestone: Playwright source guidance now directs the non-web runtime through `npm run dev:server` from `builds/typescript/`, and `vite.config.ts` supplies the default gateway proxy target on port `8787`. Playwright's `webServer` starts or reuses the Vite command.

Playwright is not a basic startup gate. B-09/B-10 are currently blocked by OPEN-10: the helper submits fixed credentials to real local login, but no reproducible isolated account seed/setup exists. A gateway plus installed browsers is therefore insufficient for clean evidence. Once that fixture exists, run from `builds/typescript/client_web/` with task-owned runtime/auth state and explicit authority. The HTML report is routine output; traces occur on retry and screenshots on failure. Clean or retain those ignored artifacts according to the task and sanitization plan. Neither command ran for this milestone and neither supports its result.

## Evidence contract

Record the candidate revision, branch/tag, operating system and architecture, tool versions, starting state, exact command and working directory, expected and actual result, interventions, cleanup, remaining risk, disposition, and sanitization. Tier B/C evidence also names the exact target and authority. A skipped command needs a concrete applicability or environment reason. Never paste raw secrets, `.env` contents, owner memory, private identifiers, or unrestricted logs.
