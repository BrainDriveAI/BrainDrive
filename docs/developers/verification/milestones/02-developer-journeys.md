# Milestone 2 — Developer journeys and subsystem documentation

This is a sanitized, revision-bound execution record. It is not product or technical authority.

## Candidate revision

- Branch: `dev`
- Base revision: `ba37f0893fbd`
- Candidate state: uncommitted working tree containing Milestones 0 through 2. Commit, push, pull request, publication, external issue creation, and repository-settings changes were outside this prompt.

## Dependencies

- Milestone 1 was revalidated before edits: 56 documentation tests passed, the composed check passed with 156 scoped candidates and zero diagnostics, projections matched, and its terminal result remained valid.
- The specification, verification plan, implementation plan, root instructions, scoped documentation instructions, and Milestones 0–1 records were read completely.
- Repository scripts, package configuration, Compose files, Tauri source, web adapters, tests, and source-adjacent READMEs were used as authority. Runtime, installer, Docker, Tauri, provider, and auth behavior were not changed to make documentation pass.
- Controlled host: Ubuntu 24.04 under WSL2 on x86_64 with a graphical session. Host defaults were Node 20.20.1 and npm 10.8.2; native and documentation baselines were also executed with isolated Node 22.23.2. Rust/cargo were 1.95.0, GTK was 3.24.41, WebKitGTK was 2.52.3, Docker was 29.2.0, and Compose was 5.0.2.

## Files changed

- Canonical developer journeys: `docs/developers/setup/native.md`, `docs/developers/setup/docker-development.md`, `docs/developers/setup/tauri-desktop.md`, `docs/developers/verification.md`, and `docs/developers/debugging.md`.
- Source-adjacent routes: `builds/typescript/README.md`, `builds/typescript/client_web/README.md`, `builds/typescript/src-tauri/README.md`, `installer/docker/README.md`, and `installer/docker/scripts/README.md`.
- Source comments corrected without behavioral change: `builds/typescript/client_web/playwright.config.ts`, `builds/typescript/client_web/e2e/mobile-layout.spec.ts`, and `builds/typescript/client_web/e2e/helpers.ts`.
- Machine-readable contracts: `docs/developers/catalog.json`, `tools/docs/schemas/catalog.schema.json`, `tools/docs/schemas/evidence.schema.json`, and `docs/developers/verification/templates/journey-report.md`.
- Validation: `tools/docs/lib/rules/commands.mjs`, `tools/docs/lib/rules/evidence.mjs`, `tools/docs/lib/schema.mjs`, `tools/docs/test/commands.test.mjs`, `tools/docs/test/developer-journeys.test.mjs`, `tools/docs/test/evidence-harness.test.mjs`, and their scoped catalog, command, and evidence fixtures.
- Evidence: `docs/developers/verification/milestones/02-developer-journeys.md`.

## Commands and results

- Tests-first initial red run: 55 of 63 documentation tests passed and eight expected journey/command-contract assertions failed before implementation.
- Subsequent red runs proved the absent current-host Tauri blocker statement, absent Milestone 2 record, incomplete safe-evidence fields, missing Tier B/C targets, stale Playwright source guidance, missing browser-auth boundary, unnamed native isolation variables, and undisclosed Docker mutation/network effects.
- Final documentation suite after record creation: 72 of 72 tests passed.
- Final composed documentation check: PASS with 165 scoped candidates and zero diagnostics.
- Isolated Node 22 documentation verification: `npm run docs:verify` passed with the same test and diagnostic results; its task cache was removed.
- Runtime checks from `builds/typescript`: lint passed, 240 tests in 34 files passed, and the TypeScript build passed.
- Web checks from `builds/typescript`: lint and typecheck passed, 178 tests in 17 files passed, and the production web build passed. Existing font-resolution and chunk-size warnings were non-fatal and are not represented as new success claims.
- Desktop checks from `builds/typescript`: preflight passed; desktop test passed the 240 runtime tests, 178 web tests, MCP build, and 49 Rust tests.
- Native J-03/J-06: PASS on the controlled WSL/Linux host. An isolated Node 22 process with task-owned memory and secrets roots ran `npm run dev`; all three MCP services, gateway health, and the Vite shell responded without any provider credential or local model. The process was stopped and both task roots and the isolated Node cache were removed.
- Docker J-04: PASS only for the start-only boundary. `./installer/docker/scripts/start.sh dev` reused a pre-existing initialized stack, reported the app healthy and web running, and the web surface responded. The pre-existing web service was temporarily stopped only to free its port for native/Tauri evidence, then the original running app/web state was restored. No first install, rebuild, local/prod, PowerShell, Windows, or macOS result is claimed.
- Tauri J-05: BLOCKED on the controlled WSL/Linux host. Preflight, Vite, Rust compilation, native WebKit processes, all three embedded MCP services, the dynamically allocated gateway health check, and the runtime-ready marker succeeded in two isolated runs. In both runs the frontend continued routing API requests through the Vite proxy instead of switching to the dynamic desktop gateway, so the local auth/bootstrap surface did not become usable. Task-specific XDG data was removed after each run and the pre-existing Docker web state was restored.
- J-07/J-15 negative evidence: an intentionally restricted executable search path made `npm run dev` fail at the missing-npm prerequisite with exit 127. The failure was classified without system mutation, raw environment output, owner data, or credentials.
- OPEN-06 source reconciliation: Playwright comments, mobile-test guidance, and Vite now agree on the non-web runtime and default proxy target on port 8787. B-09/B-10 were not run or cited because OPEN-10 records the separate missing reproducible isolated local-auth fixture.
- Projection check and `git diff --check` passed. The current safe secret scan used the declared scanner/config over tracked and non-ignored worktree scope and reported zero findings.

## Reviews and adjudication

- TypeScript/web review: initial NEEDS CORRECTION for stale Playwright comments, an incorrect auth-helper claim, missing B-09/B-10 command contracts, conditional artifacts described as unconditional, and unnamed native isolation variables. Corrected without runtime behavior changes; final independent AI re-review: PASS.
- Docker/installer review: initial NEEDS CORRECTION for undisclosed recursive ownership changes, bind-mounted package-install effects, LAN/proxied-API exposure, overbroad execution evidence, and PowerShell scripts that can print completion without fail-closed native exit handling. Corrected by documenting exact targets/effects/recovery and marking unexecuted or product-blocked paths honestly; final independent AI re-review: PASS.
- Tauri/platform review: initial NEEDS CORRECTION for missing transport-handoff classification, incomplete safe handoff diagnosis, inaccurate task-local path wording, non-actionable isolation, and optional tests presented near an untested core handoff. Corrected with explicit designed-versus-observed boundaries and missing coverage; final independent AI re-review: PASS.
- Safe-debugging/evidence review: initial NEEDS CORRECTION for incomplete redaction patterns, incomplete journey evidence requirements, implicit risky-command targets, and a schema conditional the custom validator did not execute. Corrected tests-first with fail-closed non-echoing checks and direct schema coverage; final independent AI re-review: PASS.
- All four reviews are independent AI specialist evidence, not human, Windows, macOS, native-Linux, or GitHub-platform evidence.

## Global gates

- G-01: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-02: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-03: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-04: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-05: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-06: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-07: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-08: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-09: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-10: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-11: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-12: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-13: OPEN — FINAL ADJUDICATION IN MILESTONE 7
- G-14: OPEN — FINAL ADJUDICATION IN MILESTONE 7

## Open items

- OPEN-03 is blocked on the current host: native and Docker start-only evidence passed, but the required Tauri shell baseline failed twice after embedded-runtime readiness. Windows and macOS remain unverified, and the core dynamic desktop handoff lacks a focused automated test.
- OPEN-06 is resolved at the current source/config level: Playwright guidance and Vite agree on the runtime/proxy port contract. This does not make browser E2E a basic-startup gate.
- OPEN-09 records non-fail-closed PowerShell Docker lifecycle reporting and absent controlled Windows evidence. Product script changes were outside this documentation prompt.
- OPEN-10 records the missing reproducible isolated browser-E2E auth fixture. B-09/B-10 remain blocked and uncited.
- Other catalog open items retain their assigned later-milestone or final-adjudication status.

## Remaining risks

- Milestone 2 cannot complete until the desktop client uses its dynamic embedded gateway on an evidenced supported graphical platform and the required Tauri journey is rerun successfully.
- Windows, macOS, native Linux, Docker first-install, PowerShell, browser E2E, and any provider response remain unexecuted; the corpus explicitly avoids promoting source availability into passing evidence.
- Docker dev startup can change host-bind ownership and package metadata. The documentation now exposes the target, authority, side effects, and bounded recovery, but the underlying behavior remains.
- The host's default Node version is below the documented CI baseline; isolated Node 22 evidence passed, but contributors still need the stated prerequisite.
- The working tree intentionally combines the uncommitted Milestones 0–2 changes and has not been committed or published.

BLOCKED
