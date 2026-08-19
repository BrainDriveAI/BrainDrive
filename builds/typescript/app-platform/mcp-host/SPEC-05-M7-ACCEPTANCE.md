# Spec 05 Milestone 7 acceptance record

Date: 2026-08-09
Branch: `feature/resume-builder-app`
Base revision inspected: `2caf9d46329379775ff9ead8be0db98193214a6c`
Candidate identity: cumulative M1–M7 source represented by the Git commit containing this acceptance record. Native development installer SHA-256: `cea89ab4839cdaaad2e6e75c3f67ce0103fc1c46a79d7360ab763974d51bbcbb`

This is candidate-bound engineering evidence, not product authority and not a release approval. The accepted Spec 05, implementation plan, M7 prompt, M1–M6 evidence, Specs 01–04, repository instructions, developer catalog, source, tests, configuration, and live runtime were the governing context. The cumulative candidate was staged without Git metadata, owner memory, credentials, or ignored runtime state at `C:\Users\DJJones\Projects\BrainDrive-Spec05-M7-Native` and verified with native Windows Node, Rust, browser, Tauri, and NSIS tooling. Real provider credentials/conformance entries and named human reviewers remain unavailable.

## Outcome

M7 reconnect and concurrency integration is implemented and passes the available automated, signed-fixture, browser, Docker, MCP, web, TypeScript, and Rust evidence. Reload preserves view and durable operation identities while rotating session and bridge generation. Stale generations cannot use the bridge or commit a late tool result. Concurrent views have isolated identity, cancellation, result, and close authority. Launch remains downstream of verified lifecycle, authenticated readiness, MCP negotiation/discovery, resource verification, and sandbox eligibility.

The milestone is ready for code review but not release acceptance. Native Windows automated suites, isolated browser journeys, an NSIS build, and an isolated release-binary smoke now pass. Release acceptance still requires Release Bridge signing, safely authorized installed-package/native-chooser acceptance, live accepted-model runs for Ollama, BYOK OpenRouter, and BrainDrive Models, and assigned human security/accessibility/documentation review.

## Environment and initial state

- Host: WSL2 Linux x86_64, kernel `6.6.87.2-microsoft-standard-WSL2`.
- Node.js `20.20.1`, npm `10.8.2`, Docker `29.2.0`, Compose `5.0.2`.
- Selected packaged target in the accepted specification: native Windows x64.
- Native host reached from WSL: Windows NT `10.0.26200.0` x64, PowerShell `5.1.26100.8875`, Node.js `22.22.3`, npm `10.9.8`, Cargo `1.95.0`.
- Native source staging preserved the user's clean `C:\Users\DJJones\Projects\BrainDrive` checkout and existing installed BrainDrive `26.7.23`; neither was modified or stopped.
- Initial Compose state: web running on public development port 5073; app running but unhealthy; app port 8787 was container-internal and unpublished.
- Pre-M7 source behavior: reload closed the prior session before launch, allocated a new view/operation, and initialized the browser bridge at generation 1. There was no host view registry. The old E2E assertion expecting a close during reload reproduced this boundary and failed after correct reconnect behavior was added; the assertion was replaced with exact resume-envelope and ordering checks.
- The accepted M1 conformance alpha requires Node 22 because it calls `fs.globSync`. This Node 20 host cannot rerun that CLI; M1 records its scenario inventory run under Node 22. No command was invented or runtime requirement changed.

## Integration decisions and state changes

- `AppViewRegistry` has a 16-view-per-installation ceiling and five-minute inactivity TTL. Planning and commit are separate so failed prerequisite checks cannot mutate live view authority.
- Exact resume input is `{session_id, view_id, operation_id, bridge_generation}`. No token, resource HTML, server identity, connection credential, or path is accepted from the browser.
- Exact current resume retains view/operation, rotates session, and increments bridge generation. A second racer using the old session loses with `session_closed`.
- The host tracks active Apps bridge operations by exact session. Cancellation no longer searches every capability operation; cross-view guessing has no effect.
- View commit happens after lifecycle/supervisor readiness, MCP negotiation/discovery, resource verification, and sandbox policy validation. A failed handshake leaves the current view intact.
- Existing M4 capability and M5 inference idempotency stores remain the sole duplicate-work authority. No schema migration, provider configuration, memory layout, installer format, or public port was added.
- `Spec05ParityEvidenceSchema` is used by a normalizer that permits only transport, process-isolation, package-root-reference, cache-root-reference, and diagnostic-platform differences. Missing target evidence is `blocked`; semantic differences fail.
- Windows child termination now reports `stopped_forced` truthfully because Node maps Windows signal termination to `TerminateProcess`; POSIX process-group IDs remain null on Windows, where the enclosing Tauri Job Object owns descendant containment.
- Vitest excludes generated Tauri runtime/target copies and runs source files serially on Windows. This preserves the five-second assertions while avoiding false failures from parallel NTFS contention and duplicate packaged test discovery.

## Protocol, renderer, authority, and threat evidence

| Boundary | Evidence | Result |
| --- | --- | --- |
| Modern and legacy protocol | M1 foundation, M2 official-v2 connection manager, legacy adapter, rich-envelope tests | Pass, automated/signed loopback |
| Complete envelopes | `mcp/result-envelope.test.ts`, M2 projection tests, signed fixture mixed result | Pass; no modern internal flattening |
| Launch ordering | lifecycle, host, route, signed live fixture, desktop browser audit | Pass; session opens after readiness/negotiation/resource verification |
| Sandbox/DOM | bridge, proxy, frame component, malicious-message tests, desktop Playwright | Pass automated; no human or screenshot review |
| Resume trace | registry/host/API/component tests and desktop Playwright audit | Pass; same view/operation, new session, generation 1→2, old session denied |
| Concurrency trace | registry and host tests | Pass; distinct views/operations, exact cancellation and close isolation |
| Grants/tokens | M1 security, M4 registry/token/idempotency suites | Pass automated; bearer never reaches app projection |
| Provider transport | M5 synthetic three-class fixtures and captured request body | Pass deterministic only; all real model-class runs blocked |
| Lifecycle | signed child-process fixture, M6 supervisor suites, Docker health/listener checks, native Rust containment, release-binary smoke | Pass automated on Linux/Docker/Windows; installed-package crash/orphan drill remains blocked |
| Parity | parity-normalizer unit harness, native lifecycle/parity suites, native release-binary observation | Automated semantics pass; signed installed Docker↔Windows ground-truth report remains blocked |

The signed version-3 fixture performed install, authenticated process start/readiness, MCP negotiation, resource read, resume, stale-session denial, concurrent view isolation, exact close, disable/session invalidation, and uninstall. The desktop Chrome owner journey performed install/launch, sandbox initialization, Career reads/writes, approvals, PDF export, history/reopen, exact resume, and post-close fresh launch against disposable data. Capability and export audits showed one committed operation per explicit action; deterministic inference replay tests show one provider invocation for an equivalent reconnect and conflict on changed semantic input.

## Forbidden-data and live runtime inspection

- Secret scan: `gitleaks 8.30.1`, tracked plus nonignored worktree, 0 findings.
- Docker after the requested start: app `running/healthy`; web running; `/api/health` returned `{"status":"ok"}`.
- Listener check: host port 5073 was listening; no host listener existed on 8787. Docker inspection reported `8787/tcp` with no published binding.
- Process tree: one Compose app service tree and one web service tree; the signed fixture's exact stop completed in test teardown.
- Command-line scan: 0 relevant processes contained Authorization/Bearer/API-key/secret-reference patterns after excluding the scanner itself.
- Provider-key environment scan: 0 readable app-container processes contained the four provider key variables checked. Permission-denied `/proc` entries were not treated as proof.
- Secret mount: two regular files, both mode 0600. No file content was read or recorded.
- Recent app logs: 0 matches for credential/header patterns, host home paths, or app-platform data-root paths.
- App-platform durable volume remained private to the app container and contained 112 regular fixture/state files at inspection time. This count is observational, not a schema invariant.
- Unit/API/component/security suites scan app projections, resource/proxy content, diagnostic/audit envelopes, export metadata, and support-bundle projections for credentials, tokens, provider/model IDs, raw provider bodies, unrelated records, and host paths.
- Native release binary ran with isolated task-owned `APPDATA`/`LOCALAPPDATA`, reached runtime ready and `/health` HTTP 200, contained eight descendants, accepted a normal main-window close, and left zero surviving descendant PIDs. Its temporary data and smoke script were removed.
- Native NSIS artifact: 28,954,486 bytes; SHA-256 `CEA89AB4839CDAAAD2E6E75C3F67CE0103FC1C46A79D7360AB763974D51BBCBB`; Authenticode `NotSigned`, with no signer certificate. It is a development artifact only.

## Verification commands

Commands are relative to this workspace clone; the absolute paths in the prompt refer to the source repository and were translated only to the active workspace root.

| Command | Result |
| --- | --- |
| `builds/typescript: npm run test` | Pass after final harness exclusion — 81 source files, 606 tests |
| `builds/typescript: npm run build` | Pass |
| `builds/typescript: npm run web:typecheck` | Pass |
| `builds/typescript: npm run web:test` | Pass — 24 files, 226 tests |
| `builds/typescript: npm run web:build` | Pass; existing font-resolution and chunk-size warnings |
| `client_web: npm run test:e2e -- --project=desktop-chrome` | Pass after correcting the obsolete close-on-reload assertion — mobile 12 passed/8 skipped; desktop 5 passed/5 skipped |
| `builds/mcp_release: npm run test` | Pass — 2 files, 6 tests |
| `builds/mcp_release: npm run build` | Pass |
| `builds/typescript: npm run desktop:preflight` | Pass |
| `builds/typescript: npm run desktop:test` | Pass — historical aggregate run included generated copies (TypeScript 634); final canonical main corpus is 606; web 226; Rust 54 passed/1 intentional ignored |
| `installer/docker: docker compose -f compose.dev.yml config` | Pass |
| `installer/docker: ./scripts/start.sh dev` | Pass; unhealthy existing app recreated and became healthy in 13.4 seconds |
| Optional `jq`-formatted final Compose status projection | Not run — `jq` is not installed; raw `docker compose ps`, formatted `docker inspect`, and `/api/health` checks passed instead |
| `npm run test -- app-platform/contracts/spec-05-m1.test.ts app-platform/lifecycle/package-verifier.test.ts app-inference app-capabilities app-platform/mcp-host/live-fixture.integration.test.ts app-platform/mcp-host/app-view-registry.test.ts app-platform/mcp-host/parity-normalizer.test.ts` | Pass — 8 files, 40 tests |
| `builds/resume_builder: npm run test && npm run build` | Pass — 4 files, 11 tests; TypeScript build pass |
| `tools/security/scan-secrets.sh --current` | Pass — 0 findings |
| Focused M7 ESLint plus `npm run web:lint` | Pass |
| `npm run lint` | Initial run found one unused catch binding in cumulative package-store work; corrected to a binding-free catch, then pass. Focused store/package rerun: 2 files, 16 tests pass. |
| `npm run docs:verify` and generated-doc sync check | Pass — 163 passed/1 platform skip, 252 candidates/0 diagnostics; projections match catalog |
| `git diff --check` | Pass |
| Native Windows `npm run test` with committed platform config | Pass — 81 source files, 606 tests; generated Tauri runtime/target copies excluded |
| Native Windows `npm run desktop:test` | Pass — aggregate main, MCP build, web, and Rust command; main 87 files/620 tests in the run before the final target-output exclusion, web 24 files/226 tests, Rust 54 passed/1 intentional helper ignored |
| Native Windows `npm run desktop:preflight` | Pass — main/MCP builds and web typecheck |
| Native Windows `npm run test:e2e -- --project=desktop-chrome` | Pass — mobile 12 passed/8 skipped; desktop 5 passed/5 skipped; isolated runtime cleanup passed |
| Native Windows `builds/resume_builder: npm run test` and `npm run build` | Pass — 4 files/11 tests; TypeScript build pass |
| Native Windows `builds/mcp_release: npm run test` | Pass — 2 files/6 tests |
| Native Windows `npm run web:build` | Pass; existing font-resolution and chunk-size warnings |
| Native Windows `npm run desktop:build:windows` | Pass — x64 NSIS artifact and stable alias created |
| Native Windows Authenticode inspection | `NotSigned`; release gate fails closed |
| Native Windows isolated release-binary smoke | Pass — ready, health 200, 8 descendants before close, zero survivors after normal close |

An initial post-implementation desktop E2E run failed one obsolete test assertion because it expected reload to close the old session. The implementation was not weakened; the assertion now requires the first reload event to be a bounded resume launch with the exact prior IDs and generation. The exact complete command then passed.

## Acceptance gates

| Gate | Status | Ground-truth evidence or blocker |
| --- | --- | --- |
| M7-AC1 | Pass available evidence | Modern/legacy, complete-envelope, resource, visibility, compatibility suites and signed peer pass. Node-22 conformance CLI is inherited M1 evidence, not rerun here. |
| M7-AC2 | Pass automated/live | Signed HTML, double iframe, CSP, forged source/origin/message, navigation/storage/network/Tauri denial, focus, and zero-side-effect tests pass. Human security review remains part of AC8. |
| M7-AC3 | Pass automated/live | Exact opaque grants/tokens/scopes/idempotency/data placement/export tests and browser journey pass; scans show no forbidden projection. |
| M7-AC4 | Blocked | Synthetic Ollama/OpenRouter/BrainDrive Models class fixtures pass, but the real compatibility registry is intentionally empty and no accepted credentials/model records exist. |
| M7-AC5 | Partial | Linux/Docker and native Windows process suites, Rust Job Object containment, package build, release health, normal shutdown, and zero-survivor checks pass. Signed installed-package crash/orphan/restart and uninstall/reinstall remain unproved. |
| M7-AC6 | Pass available evidence | Reload, stale/racing resume, concurrent views, cancellation, close isolation, durable idempotency, and late-result rejection pass on native Windows browser processes as well as Linux. |
| M7-AC7 | Partial | Normalizer, permitted-difference, native lifecycle/parity, and release-binary observations pass; the accepted signed installed Docker↔Windows ground-truth report is not complete. |
| M7-AC8 | Partial | Automated security/accessibility/configuration/regression/build/docs and native packaging gates pass; the artifact is unsigned and named human security/accessibility/documentation review is unavailable. |
| M7-AC9 | Blocked | Matrix is complete, but release-method requirements cannot be marked passing without native Windows, real providers, human review, and an immutable candidate digest. |

## REQ-001–REQ-045 matrix

`Pass` means the requirement's repository evidence is available in this candidate. `Partial` or `Blocked` preserves the accepted evidence method rather than substituting a unit test.

| REQ | Status | Concrete evidence |
| --- | --- | --- |
| REQ-001 | Partial | Scope diff and regression suites pass; project-owner final review unavailable. |
| REQ-002 | Partial | Direct Apps UI/browser flow passes; human product-UX review unavailable. |
| REQ-003 | Pass | Auth/privacy/provider/trust contract and regression suites. |
| REQ-004 | Pass | M1/M2 official-v2 protocol tests and signed peer. |
| REQ-005 | Pass | Legacy adapter and fixed-MCP regressions. |
| REQ-006 | Pass | Negotiation/resource failures precede view commit. |
| REQ-007 | Pass | Connection manager and signed live lifecycle/reconnect fixture. |
| REQ-008 | Pass | Complete-result and envelope projection tests. |
| REQ-009 | Pass | Modern tools/resources/read and signed peer tests. |
| REQ-010 | Pass | MIME/size/digest/cache/redirect/content-policy tests. |
| REQ-011 | Pass | Apps `2026-01-26` contracts and bridge initialization. |
| REQ-012 | Pass | Model/app visibility tests. |
| REQ-013 | Pass | Same-server enforcement tests. |
| REQ-014 | Pass | Desktop browser opaque sandbox and malicious resource checks. |
| REQ-015 | Pass | Provenance/schema/limit/replay/token tests. |
| REQ-016 | Pass | Browser focus/teardown/reload plus registry lifecycle tests. |
| REQ-017 | Pass | Browser broker PDF, navigation, clipboard, and denial tests. |
| REQ-018 | Pass | Versioned named-capability registry/contracts. |
| REQ-019 | Pass | Exact claim/grant/revocation/token binding tests. |
| REQ-020 | Pass | Host-only one-use token and revocation tests. |
| REQ-021 | Pass | Non-enumerating M4 denial tests. |
| REQ-022 | Pass | Operation coordinator, replay/conflict, export, and inference tests. |
| REQ-023 | Pass | Opaque Career adapter and browser write-placement flow. |
| REQ-024 | Pass | Host-mediated export broker and browser/native-boundary tests. |
| REQ-025 | Blocked | Credential isolation passes synthetically; no accepted real-model entry/run. |
| REQ-026 | Pass | Three profile classes remain independent; no credits/fallback coupling. |
| REQ-027 | Pass | Typed bounded no-tools/no-fallback protected request tests. |
| REQ-028 | Partial | Synthetic structured/repair/usage/cancel/late-discard pass; real-provider live run blocked. |
| REQ-029 | Pass | Untrusted content/resource/model projection tests. |
| REQ-030 | Pass | Separate minimized app/model projection tests. |
| REQ-031 | Pass | Versioned runtime-neutral supervisor contract. |
| REQ-032 | Pass | Signed child readiness/registration ordering and lifecycle suites. |
| REQ-033 | Pass | Timeout/restart/backoff/hang tests. |
| REQ-034 | Pass | Exact revoke/stop/cleanup/orphan and lifecycle invalidation tests. |
| REQ-035 | Pass | Live Compose inspection: healthy internal 8787, no published binding. |
| REQ-036 | Partial | Native Windows x64 build, source supervision, Rust Job Object containment, release health, and zero-survivor shutdown pass; signed installed-package lifecycle drill remains. |
| REQ-037 | Pass | Spec 04 adapter and supervisor conformance suites. |
| REQ-038 | Pass | Durable replay plus stable view/operation reconnect identities. |
| REQ-039 | Pass | Live fixture and registry/host concurrent isolation tests. |
| REQ-040 | Pass | Runtime-neutral parity schema and semantic normalizer tests. |
| REQ-041 | Pass | Correlated content-minimized audit/diagnostic and forbidden scans. |
| REQ-042 | Pass available evidence | Layered contract/protocol/API/browser/security/process evidence; external reviews remain blocked. |
| REQ-043 | Partial | Native source/parity/browser/release observations exist; signed installed Docker↔Windows normalized ground-truth report remains. |
| REQ-044 | Pass available evidence | Main/web/MCP/desktop/Rust/browser/Docker regression suites pass. |
| REQ-045 | Partial | Source/diff review shows no optional MCP/marketplace/hosting additions; project-owner sign-off unavailable. |

## Operator and troubleshooting checks

1. Run Compose configuration validation before starting; do not print resolved secret values into evidence.
2. Start with `installer/docker/scripts/start.sh dev`. Require the app container to become healthy and verify 8787 has no host publication.
3. Install or reinstall the signed fixture from Apps, then launch. An owner-visible frame is not ready evidence unless runtime readiness, MCP negotiation, resource verification, and sandbox initialization precede it.
4. Reload while the view is open. The request body may contain only the four resume fields. Expect stable view/operation, a new session, and generation increment; a request using the old session must return `session_closed`.
5. On a mismatched or stale resume, keep the current view authoritative and show the existing safe recovery state. Do not retry a mutation or provider request with changed semantic input.
6. Disable/uninstall and verify the exact session is denied, the dynamic registration and process are removed, and retained owner data remains governed by Spec 02.
7. If Docker and packaged-desktop observations differ outside transport, process isolation, package-root reference, cache-root reference, and diagnostic platform, treat parity as failed. A missing target is blocked, not equivalent.

Rollback/containment uses the existing Spec 04 disable, update rollback/LKG, uninstall, revocation, and orphan cleanup paths. M7 adds no migration and no fallback transport. If reconnect behavior must be disabled, closing the exact current session forces a fresh view without weakening token, capability, inference, lifecycle, or sandbox checks.

## Unrun evidence and remaining risk

- Release Bridge signature and immutable-candidate provenance: the native installer is `NotSigned`, so no release signer identity exists.
- Installed-package/native-chooser, crash/orphan/restart, update/rollback, uninstall/reinstall, and retained-data reopen were not run for this candidate. The unsigned installer shares identity/version `26.7.23` with the currently installed and running BrainDrive app; replacing it was not inferred from source/build authorization.
- Docker-versus-native Windows final signed installed-package normalized ground-truth diff remains incomplete; source/parity/browser/release-binary observations now exist on both runtime classes.
- Real Ollama, BYOK OpenRouter, and BrainDrive Models calls: blocked by the intentionally empty real compatibility registry and absent accepted credentials/conformance records. Synthetic fixtures are not substituted.
- M1 conformance CLI passed in the native Node 22 main corpus; the WSL Node 20 limitation remains only for that host.
- Human UX/recovery, accessibility, security, documentation-quality review, and screenshots: no assigned reviewer/session; not claimed.
- Immutable candidate identity is the Git commit containing this record. The target evidence was run against the same cumulative source tree; publication changed only this acceptance record's whitespace and candidate-identity wording. The development installer has the recorded digest above and still requires Release Bridge signing.

No marketplace, remote OAuth, public app hosting, stdio, Sampling, prompts, completions, subscriptions, Tasks, elicitation, managed hosting, second provider selector, provider fallback, or unrelated refactor was added by M7.
