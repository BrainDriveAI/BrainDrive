# Spec 10 Milestone 6 acceptance record

Recorded: 2026-08-15

Disposition: **HOLD — not release-ready**

This is the sanitized, source-adjacent requirement-to-evidence record for Spec 10 durable interview save and General Resume completion. Every authorized Tier A source, contract, disposable-store, package, web, documentation, security, and build check passed on the implementation candidate below. Separately authorized isolated browser runs passed the desktop Chrome synthetic owner journey, deterministic save/recovery, Mobile Chrome/Mobile Safari responsive and 200% zoom, exact dense/holdout presentation, and exhaustive typed invalid-candidate presentation matrices. A task-isolated Docker deployment smoke also passed health, synthetic authentication/app discovery, and restart persistence without touching the pre-existing owner-bound stack. Seven separately approved bounded live BrainDrive Models runs used 28 calls and $0.46 observed spend in total. Prompt policy 12 preserves the provider-only nested role envelope and structural six-bullet ceiling while splitting host semantic binding failures into exact content-free issue IDs for the existing one retry. The newest live run completed both fixtures through safe host fallback but did not establish provider compatibility: dense repeated top-level experience leakage and holdout repeated an invalid heading shape after receiving the exact retry issue. Named-human, native Windows/macOS, exact Docker save/recovery topology, and clean-candidate execution remain blocked, so `RB10-G8` remains blocked and the release disposition is HOLD.

## Candidate, authority, environment, and cleanup

- Branch: `feature/resume-builder-app`.
- HEAD: `8343fd7d8266c06760eae8cf7dba47ae90d38a52`.
- Candidate timestamp: `2026-08-16T00:18:54Z`.
- Implementation candidate tracked binary-diff SHA-256: `02386311ba96b7bec744c94f01e1c66f8810df595fdf19ebce3b4025471cbebb`.
- Implementation candidate untracked path-manifest SHA-256: `f1fe4652eceae83e17d3d0d5cf034923739900494701ba7738042cda458f0278`.
- Implementation candidate untracked path/content SHA-256: `bba0bb2eb09b93b2d724c50f47a89f2c0096d4ba998fb69b3e39da12a7d1ca04`.
- Combined implementation candidate SHA-256: `c8d6273dd02f7a622240f88bedfb0b9d3880908bca380d0cdd1726849d0e9a51`.
- The identity includes HEAD plus every tracked and nonignored untracked implementation file, excluding only this acceptance record and `spec-10-acceptance.test.ts`. Those two M6 evidence-overlay files receive a separate final identity and do not alter the implementation candidate proof.
- Dependency/config identity: main lock `047bed5d413387c2a0c1371d973fa695ba98312a2664eb094dcf76a9f7af87b5`; Resume package lock `87a4bd99d64cb77e9f1b85bcf8d44d57402b2a6060898d68840ef1cbd89c2bf8`; MCP release lock `dceecf1db451d1ee4041be16dfcc663b47a97b8be511a2a4a84dad0e5d37dce2`.
- Versions: Ubuntu 24.04.3 under WSL2 Linux x86_64; Node `v20.20.1`; npm `10.8.2`; Rust/Cargo `1.95.0`; main/web `26.7.23`; Resume package `0.0.0-milestone-7`; MCP release `1.0.0`. CI declares Node 22, so exact CI-runtime parity is not established.
- Roots and data: tests used repository-owned synthetic fixtures and test-created disposable temporary roots. The currently retained ignored evidence roots contain one browser summary, one browser inference manifest, and the newest strict content-free live-provider manifest; historical live evidence remains represented by its audited hashes below. Docker used a separate Compose project, synthetic memory bind, task-generated secrets volume, task app-platform volume, task dependency volumes, and loopback port. The live runner read the active profile/model, resolved the existing vault credential inside the running app container, queried balance, and contacted only the approved provider; no credential value, endpoint, prompt, output, owner content, backup, or production configuration was retained or changed.
- Cleanup: test-created disposable browser roots were removed by their harnesses. Ports 8911–8913 were free after every browser run, no recent disposable browser root remained, and no runner, Playwright, runtime, or Vite process survived. The task Docker containers, network, four named volumes, override, and synthetic memory were removed; the pre-existing two-service development stack remained running and healthy. No native service was started and no owner-domain cleanup occurred.

The implementation candidate is reproducible from the repository root with this exact overlay exclusion:

```bash
git diff --binary | sha256sum
git ls-files --others --exclude-standard \
  | grep -vF -e 'builds/typescript/resume-domain/SPEC-10-ACCEPTANCE.md' \
             -e 'builds/typescript/resume-domain/spec-10-acceptance.test.ts' \
  | LC_ALL=C sort | sha256sum
git ls-files --others --exclude-standard \
  | grep -vF -e 'builds/typescript/resume-domain/SPEC-10-ACCEPTANCE.md' \
             -e 'builds/typescript/resume-domain/spec-10-acceptance.test.ts' \
  | LC_ALL=C sort \
  | while IFS= read -r file; do printf '%s\0' "$file"; sha256sum "$file"; done \
  | sha256sum
printf '%s\n%s\n%s\n%s\n' \
  'head:8343fd7d8266c06760eae8cf7dba47ae90d38a52' \
  'tracked-diff-sha256:02386311ba96b7bec744c94f01e1c66f8810df595fdf19ebce3b4025471cbebb' \
  'untracked-manifest-sha256:f1fe4652eceae83e17d3d0d5cf034923739900494701ba7738042cda458f0278' \
  'untracked-content-sha256:bba0bb2eb09b93b2d724c50f47a89f2c0096d4ba998fb69b3e39da12a7d1ca04' \
  | sha256sum
```

## Evidence keys

| Key | Layer / command | Result | Evidence summary |
|---|---|---|---|
| `S1` | From `builds/typescript`: `npx vitest run resume-inference/spec-10-acceptance-fixture.test.ts app-capabilities/operations.test.ts app-capabilities/recovery-reconciliation.test.ts app-platform/mcp-host/data-capability-bridge.test.ts resume-domain/resume-data-store.test.ts resume-inference/spec-10-dense-recovery.test.ts app-inference/capability.test.ts app-inference/spec-09-projection.test.ts app-platform/contracts/security.test.ts memory/support-bundle.test.ts resume-inference/compatibility.test.ts resume-inference/spec-09-integration.test.ts app-platform/two-app-isolation.test.ts` | PASS; 13 files / 126 tests | Save coordinator/reconciliation/host/store, dense/holdout, action/retry, compatibility, security/support, and two-app isolation pass together. |
| `S2` | From `builds/resume_builder`: `npx vitest run test/recovery-save.test.ts test/workflow.test.ts test/ui-resource.test.ts` | PASS; 3 files / 63 tests | Recovery timing/status, guarded actions, exact three evidence actions, explicit Retry, repeated-failure emphasis, retention, and accessibility contracts pass. |
| `R1` | From `builds/resume_builder`: `npm test`; `npm run build` after the browser-found race repair | PASS; 6 files / 72 tests; build PASS | Serialized field-activation/guard-order regression and the complete Resume package pass after the initial `B1` failure. |
| `A1` | `npm run contracts:schemas` | PASS | Generated contract schemas synchronize without drift. |
| `A2` | `npm run lint`; `npm run test`; `npm run build` | PASS | Lint/build pass; runtime regression before the evidence-overlay update includes the bounded live-validation harness tests, reporting 126 files / 1,076 tests. |
| `A3` | `npm run resume:quality` | PASS | 15 fixtures; 56 production files scanned; 12/12 mutations caught; zero blocking false positives in 2 clean controls. Controlled/provider/human release gates remain blocked. |
| `A4` | web lint/typecheck/test/build | PASS | Web lint/typecheck/build pass; 26 files / 247 tests pass. Existing font-resolution and chunk-size warnings remain non-fatal. |
| `A5` | `npm run desktop:preflight` | PASS supporting only | Runtime/MCP builds and web typecheck pass; this is not native Windows/macOS evidence. |
| `A6` | `npm run docs:verify`; generated projection check | PASS | 167 documentation tests total: 166 pass and one expected platform skip; 260 candidates and zero diagnostics; projections match. |
| `A7` | Resume package test/build | PASS | Post-repair 6 files / 72 tests pass and TypeScript build passes. |
| `A8` | MCP release test/build | PASS | 2 files / 6 tests pass and TypeScript build passes. |
| `A9` | current secret scan; `git diff --check` | PASS | Scanner reports zero findings; whitespace check passes. |
| `B1` | exact isolated desktop Chrome owner journey | PASS | One synthetic Career/full interview/four typed inference failures/evidence actions/reload/General draft/approval/history/export/direct-reopen journey passed in 2.3 minutes on the frozen candidate after the M3 race repair. |
| `B2` | deterministic browser save/recovery matrix | PASS | The production Resume resource functions passed delayed observation, response loss, duplicate/all-six guarded intents, stale new value, denied/conflict/cancel/final-readback, teardown, and iframe reconnect rows with exact counters in one strict content-free manifest. |
| `B3` | mobile/responsive/200% zoom browser matrix | PASS | Mobile Chrome and Mobile Safari passed current-job identity, progress, optional controls, reduced motion, history comparison, no horizontal overflow, and 200% zoom checks; 2 passed / 2 desktop-only tests intentionally skipped. |
| `B4` | dense/holdout and exhaustive invalid-candidate browser matrix | PASS | Desktop Chrome loaded the production Resume resource, rendered both frozen 29-fact/3-job corpora as 29-statement proposed/unapproved drafts, and presented all 24 typed invalid outcomes fail-closed with zero proposal writes and zero protected-state mutations. This is browser presentation evidence; broker/store acceptance remains `S1`. |
| `D1` | controlled dev Docker deployment smoke | PASS | A separate Compose project reached app `healthy`, web shell 200, API health OK, synthetic signup 201, authenticated app discovery 200, and post-app-restart login/discovery 200. This does not relabel as the unrun Docker save/recovery fault-topology matrix. |
| `P1` | bounded live provider dense/holdout validation | FAIL | Seven separately approved BrainDrive Models/default-model runs used 28 calls and $0.46 observed spend in total. The policy 12 semantic-binding diagnostic used exactly 4 calls and $0.10 observed spend: both fixtures completed through deterministic fallback, so aggregate host recovery passed while provider compatibility remained false. |
| `H1` | named human UX/accessibility review | BLOCKED | No named reviewer or controlled session was supplied. Automated tests are not relabeled human review. |
| `N1` | native Windows candidate | BLOCKED | No authorized native Windows environment was supplied. |
| `N2` | native macOS candidate | BLOCKED | No authorized native macOS environment was supplied. |
| `C1` | clean immutable source revision | BLOCKED | The implementation remains an intentionally preserved dirty worktree identified by exact content hashes; no commit authority was supplied. |

## Before/after defect evidence

| Defect | Before | Corrected Tier A evidence | Remaining higher-layer evidence |
|---|---|---|---|
| Late save | Frozen legacy one-shot fixture classifies the 500 ms read as `not_saved` while the same one write commits at 741 ms. | `S1`, `S2`, `B2`: 500 ms is display-only; not-found stays pending; exact operation/readback reaches Saved; response loss reconciles; final Not saved requires settled lifecycle plus final readback. | Docker/native topology portions in `D1`, `N1`, and `N2` remain blocked. |
| Dense draft | Frozen original branch tried only targeted evidence repair and could retain an invalid result with zero proposal writes. | `S1`: dense and disjoint holdout primary, structural repair, evidence repair, targeted repair, full deterministic construction, schema/evidence failures, replay, cancellation, concurrency, and real disposable-store readback pass; `B1` completes one synthetic General draft; `B4` presents both exact corpora in desktop Chrome; newest `P1` aggregate host recovery completes both fixtures. | Live provider compatibility still failed; `H1` blocked. |
| Evidence dead end | Frozen adapter/package maps evidence validation failure to no recovery action. | `S1`, `S2`, `B1`: exactly Try again, Review confirmed evidence, and Not now; zero pre-click spend; Review zero additional call; one fresh Retry; equivalent repeat emphasizes review. | `P1` and `H1` blocked. |
| Rapid multi-field guarded transition | Initial authorized `B1` failed at `resume-builder.spec.ts:221`: after rapid title/employer edits and immediate Save this job, the draft reported Saved but the journey stayed on the job form. | M3 serialized recovery-field activation in input order and made guard creation await prior activations; focused race coverage passed, Resume package passed 6 files / 72 tests, and the exact `B1` rerun passed. | `B2` additionally proves every guarded intent deduplicates; Docker/native topology remains blocked. |

## Exact count and mutation evidence

- Save fixture contract contains 19 named timing/fault/topology rows and 6 guarded intents. Equal concurrent/forced saves coalesce to one owner-domain durable effect; successful duplicate guarded requests are `2 requested / 1 executed`; failed, conflicted, or cancelled requests are `1 / 0`.
- `fast_ack`, `observed_630ms`, `observed_741ms`, `later_in_policy`, response loss, first-not-found-then-visible, teardown/reload/reconnect, and restart success rows each produce exactly one recovery write. Terminal failure, conflict, and cancellation produce zero recovery writes. A genuinely new value has its own identity and produces one write per distinct semantic value.
- Dense and holdout accepted rows create exactly one unapproved proposal and one durable readback. Invalid schema/evidence, insufficient/stale/foreign input, cancellation, response loss before terminal persistence, and persistence failure create zero invalid writes.
- Each logical General Resume operation uses at most 2 provider-adapter calls and concurrency 1. Local deterministic work uses zero provider calls. Replay adds zero calls; equivalent concurrency coalesces; explicit Retry creates a fresh operation with a fresh per-operation ceiling only after owner action.
- All failure matrices assert zero implicit fact confirmations, interview submissions, strategy replacements, approvals, publications, Career projections, provider switches, credential reads, or browser-storage writes.

## Requirement-to-evidence matrix

| Requirement | Evidence | Disposition |
|---|---|---|
| RB10-REQ-001 | `S1`, `S2`, `B2`: exact owner/install/slot/revision/operation/value-digest acknowledgement and durable readback. | LOCAL + BROWSER PASS |
| RB10-REQ-002 | `S1`, `S2`, `B2`: initial display wait becomes pending, never terminal failure. | LOCAL + BROWSER PASS |
| RB10-REQ-003 | `S1`, `S2`, `B2`: repeated bounded reads, one not-found pending, host-aligned final proof. | LOCAL + BROWSER PASS |
| RB10-REQ-004 | `S1`, `S2`, `B2`: equal flushes coalesce/replay with one durable effect and one transition. | LOCAL + BROWSER PASS |
| RB10-REQ-005 | `S1`, `S2`, `B2`: later value has distinct identity and ignores stale acknowledgement. | LOCAL + BROWSER PASS |
| RB10-REQ-006 | `S1`, `S2`, `R1`, `B1`, `B2`: all six guarded intents show progress and execute once or zero on failure; the repaired rapid multi-field job guard passes. | LOCAL + BROWSER PASS |
| RB10-REQ-007 | `S1`, `S2`, `B2`: CAS conflict preserves exact local and durable digests/revisions. | LOCAL + BROWSER PASS |
| RB10-REQ-008 | `S2`, `B2`: pending/error/conflict retain visible input; discard is explicit and narrow. | LOCAL + BROWSER PASS; human blocked |
| RB10-REQ-009 | `S1`, `S2`, `B1`, `B2`: reload/reconnect rebuild from durable state; runtime/MCP restart passes locally; `D1` proves isolated Docker restart health/auth/app discovery. | LOCAL + BROWSER + DOCKER SMOKE PASS; exact Docker topology/native blocked |
| RB10-REQ-010 | `S1`: insufficient/stale/foreign/missing inputs fail preflight with zero calls. | LOCAL PASS |
| RB10-REQ-011 | `S1`: eligible, disjoint three-job dense and holdout fixtures complete; `B1` proves one synthetic General draft journey; `B4` presents both exact frozen corpora; newest `P1` completed both through deterministic host fallback. | LOCAL + BROWSER + live aggregate host-recovery PASS; provider compatibility FAIL |
| RB10-REQ-012 | `S1`: exact strategy/fact/coverage/policy/schema binding survives every path and Retry. | LOCAL PASS |
| RB10-REQ-013 | `S1`: per-operation call ceiling 2 and concurrency 1. | LOCAL PASS |
| RB10-REQ-014 | `S1`: targeted then full deterministic candidates pass strict parse/normalize/parse/validators. | LOCAL PASS |
| RB10-REQ-015 | `S1`: original provider and recovery-stage failures remain distinct and strict. | LOCAL PASS |
| RB10-REQ-016 | `S1`: schema/provenance/support/stale/foreign failures create zero proposals. | LOCAL PASS |
| RB10-REQ-017 | `S1`, `S2`, `B1`: exact three safe evidence actions render and Review performs no additional browser call. | LOCAL + scoped browser PASS; human blocked |
| RB10-REQ-018 | `S1`, `S2`, `B1`: Retry is explicit, fresh, same-boundary, and not an automatic third call. | LOCAL + scoped browser PASS; live blocked |
| RB10-REQ-019 | `S1`, `S2`, `B1`: equivalent second failure emphasizes evidence review and exposes four distinct browser operation identities. | LOCAL + scoped browser PASS |
| RB10-REQ-020 | `S1`, `S2`, `B1`, `B4`: protected surfaces remain stable through injected failures, evidence review, reload, and all 24 typed browser presentation rows. | LOCAL + BROWSER PASS |
| RB10-AI-001 | `S1`: brokered structured no-tools adapter with active safe provider/model identity; `P1` confirms exact live profile/model and four bounded calls. | LOCAL + LIVE CALL PATH PASS; provider compatibility FAIL |
| RB10-AI-002 | `S1`: structural/evidence repair receives exact prior candidate and safe findings within two calls. | LOCAL PASS |
| RB10-AI-003 | `S1`: repair cannot widen fact, strategy, purpose, section, or job authority. | LOCAL PASS |
| RB10-AI-004 | `S1`: deterministic construction uses answered eligible evidence and excludes deferred/unknown classes. | LOCAL PASS |
| RB10-AI-005 | `S1`: headings, bullets, summaries, education, credentials, projects, skills, and contact retain shape/provenance. | LOCAL PASS; human quality blocked |
| RB10-AI-006 | `S1`: provider and local candidates share exact parser/schema/normalization/evidence gates. | LOCAL PASS |
| RB10-AI-007 | `S1`, `S2`: no automatic call after ceiling; only explicit Retry starts fresh budget. | LOCAL PASS |
| RB10-AI-008 | `S1`, `A3`, `P1`: fallback, compatibility, quality, approval, provider, and release claims remain separate; live host recovery is not relabeled provider success. | PASS; provider compatibility explicitly FAIL |
| RB10-UX-001 | `S2`, `B2`: idle/saving/still-saving/saved/conflict/not-saved copy and states. | LOCAL + BROWSER PASS; human blocked |
| RB10-UX-002 | `S2`, `B2`: no terminal failure from initial acknowledgement timer. | LOCAL + BROWSER PASS |
| RB10-UX-003 | `S2`, `B2`: guarded action and owner input remain visible while pending. | LOCAL + BROWSER PASS; human blocked |
| RB10-UX-004 | `S2`, `B2`: Saved uses exact current value and acknowledged revision. | LOCAL + BROWSER PASS |
| RB10-UX-005 | `S2`, `B2`: conflict exposes local/saved values and explicit non-default discard. | LOCAL + BROWSER PASS; human blocked |
| RB10-UX-006 | `S1`, `S2`, `B1`, `B4`: bounded generation failure/retry/success completes in the owner journey and exact dense/holdout plus 24 typed invalid presentation rows pass. | LOCAL + BROWSER PASS |
| RB10-UX-007 | `S1`, `S2`, `B1`: safe findings and exact three actions render in desktop Chrome. | LOCAL + scoped browser PASS; human blocked |
| RB10-UX-008 | `S2`, `B1`: Retry visibly discloses active-provider request and possible credits without credentials. | LOCAL + scoped browser PASS; human blocked |
| RB10-UX-009 | `S1`, `S2`, `B1`, `B2`: selected Career context, strategy, approved state, stage, saved value, and pending reconnect survive their browser rows; `D1` proves Docker restart health/auth/app discovery only. | LOCAL + BROWSER PASS; exact Docker topology/native blocked |
| RB10-UX-010 | `S2`, `A4`, `B1`, `B3`: desktop and both mobile projects pass responsive behavior; mobile projects also pass 200% zoom and reduced-motion checks. | AUTOMATED BROWSER PASS; named-human accessibility blocked |
| RB10-OBS-001 | `S1`, `A1`: strict save event includes safe identity/digest/revision/timing/read/disposition fields. | LOCAL PASS |
| RB10-OBS-002 | `S1`, `A1`: strict inference event includes purpose/digests/attempts/repair/recovery/final disposition. | LOCAL PASS |
| RB10-OBS-003 | `S1`: timeout-to-late-commit correlation uses opaque identity/digest only. | LOCAL PASS |
| RB10-OBS-004 | `S1`: created/coalesced/replayed save and fresh owner Retry relations are explicit. | LOCAL PASS |
| RB10-OBS-005 | `S1`: real disposable-store before/after reads cover workspace, strategy, proposal, approval, and projection. | LOCAL PASS |
| RB10-OBS-006 | `S1`, `A9`: strict UI/audit/support canaries and current-tree secret scan pass. | LOCAL PASS |
| RB10-INV-001 | `S1`, `S2`, `B2`: Saved requires exact visible digest and durable commit. | LOCAL + BROWSER PASS |
| RB10-INV-002 | `S1`, `S2`, `B2`: slow/ambiguous/not-yet-visible remain pending. | LOCAL + BROWSER PASS |
| RB10-INV-003 | `S1`, `S2`, `B2`: equal semantic save produces at most one write/effect. | LOCAL + BROWSER PASS |
| RB10-INV-004 | `S1`, `S2`, `B2`: older acknowledgement cannot save newer value. | LOCAL + BROWSER PASS |
| RB10-INV-005 | `S2`, `B2`: typed and conflicting values remain available; discard is explicit. | LOCAL + BROWSER PASS |
| RB10-INV-006 | `S1`, `B1`, `B4`: invalid/unvalidated candidates create no usable proposal or approval; the owner journey stays in safe recovery and all 24 typed browser presentation rows fail closed. | LOCAL + BROWSER PASS |
| RB10-INV-007 | `S1`: every accepted statement resolves to exact eligible evidence. | LOCAL PASS |
| RB10-INV-008 | `S1`: deferred/skipped/unknown/not-applicable evidence is excluded. | LOCAL PASS |
| RB10-INV-009 | `S1`: provider/model/policy/schema/snapshot/purpose authority remains immutable. | LOCAL PASS |
| RB10-INV-010 | `S1`, `S2`, `B1`: two-call ceiling and explicit fresh-operation Retry; four injected failures use four distinct browser operation IDs. | LOCAL + scoped browser PASS; live blocked |
| RB10-INV-011 | `S1`, `S2`, `B1`, `B2`, `B4`: save and all typed inference presentations preserve guarded transitions and protected surfaces through evidence review/reload. | LOCAL + BROWSER PASS |
| RB10-INV-012 | `S1`, `A9`, `B1`, `B2`, `B3`, `B4`: no raw content, credentials, endpoints, secret references, or paths in retained evidence; raw trace is excluded. | LOCAL + BROWSER PASS |
| RB10-OPS-001 | Candidate identity plus this named layer/authority matrix; no lower-layer relabeling. | LOCAL PASS; external layers blocked |
| RB10-SEC-001 | `S1`, `A9`: authorization/CAS/provider/credential/approval/publication remain host-controlled. | LOCAL PASS |
| RB10-COMP-001 | `S1`, `A2`, `A4`, `A7`, `A8`, `B1`, `B4`, `D1`: Specs 03/06/09, Brief/two-app, direct/Career, existing contracts, provider choices regress green; Career/direct reopen and exact inference presentation pass in desktop Chrome; isolated Docker deployment smoke passes. | LOCAL + BROWSER + DOCKER SMOKE PASS; live/native blocked |
| RB10-DOC-001 | Source-adjacent READMEs, browser retention contract, catalog, and generated schemas are synchronized; `A6` passes. | LOCAL PASS |

## Gate matrix

| Gate | Evidence | Disposition |
|---|---|---|
| RB10-G1 | `S1`, `S2` pass the full Tier A save truth/readback matrix; `B2` passes delayed observation and response-loss browser rows with exact counters. | PASS — Tier A and deterministic browser timing/loss rows pass |
| RB10-G2 | `S1`, `S2`, `R1` pass duplicate/coalesced and guarded-action matrices; `B1` passes the repaired rapid-edit guard and `B2` passes all six duplicate guarded intents exactly once. | PASS — Tier A and browser duplicate/all-guarded rows pass |
| RB10-G3 | `S1`, `S2` pass conflict/new-value/reload/reconnect/restart locally; `B1` passes reload/Career continuity; `B2` passes new-value/teardown/reconnect rows; `D1` passes Docker health/auth/app discovery across an app restart. | BLOCKED — Tier A/browser continuity and isolated Docker health/restart smoke PASS; required Docker topology/native not run |
| RB10-G4 | `S1` passes dense and holdout broker/store paths; `B1` persists/reloads one draft; `B4` presents both exact corpora; newest `P1` passes aggregate host recovery for both fixtures after policy 12 but still requires fallback for both. | BLOCKED — Tier A/browser/live host recovery PASS; live provider compatibility FAIL; required human evidence not run |
| RB10-G5 | `S1` passes the complete invalid-result/no-mutation matrix; `B1` passes injected evidence-failure/reload; `B4` presents all 24 typed invalid terminal classes with zero proposal/protected mutation. | PASS — Tier A and complete typed invalid-candidate browser presentation pass with zero protected mutation |
| RB10-G6 | `S1`, `S2` pass action/call/mutation counts; `B1` passes exact actions, explicit fresh Retry, repeat emphasis, disclosure, and Review navigation; each `P1` execution consumed only its separately authorized four-call ceiling. | BLOCKED — Tier A/browser bounded-action evidence PASS; live provider compatibility FAIL; required human evidence not run |
| RB10-G7 | `S1`, `A1`, `A9`: strict diagnostics/support allowlists and zero-finding scan. | PASS |
| RB10-G8 | `A1`–`A9`, `B1`–`B4`, and the scoped `D1` deployment smoke pass, but `P1` fails provider compatibility and exact Docker fault topology, `H1`, `N1`, `N2`, and clean-candidate `C1` remain mandatory. | BLOCKED — HOLD |

## Exact commands and results

| Working area | Command | Result |
|---|---|---|
| Main TypeScript | `npx vitest run resume-inference/spec-10-acceptance-fixture.test.ts app-capabilities/operations.test.ts app-capabilities/recovery-reconciliation.test.ts app-platform/mcp-host/data-capability-bridge.test.ts resume-domain/resume-data-store.test.ts resume-inference/spec-10-dense-recovery.test.ts app-inference/capability.test.ts app-inference/spec-09-projection.test.ts app-platform/contracts/security.test.ts memory/support-bundle.test.ts resume-inference/compatibility.test.ts resume-inference/spec-09-integration.test.ts app-platform/two-app-isolation.test.ts` | PASS; 13 files / 126 tests. |
| Resume package | `npx vitest run test/recovery-save.test.ts test/workflow.test.ts test/ui-resource.test.ts` | PASS; 3 files / 63 tests. |
| Main TypeScript | `npm run contracts:schemas` | PASS. |
| Main TypeScript | `npm run lint` | PASS; zero warnings. |
| Main TypeScript | `npm run test` | PASS; 126 files / 1,076 tests before the final evidence-overlay update. |
| Main TypeScript | `npm run build` | PASS. |
| Main TypeScript | `npm run resume:quality` | PASS for credential-free deterministic checks; report retains blocked higher gates. |
| Main TypeScript | `npm run web:lint` | PASS. |
| Main TypeScript | `npm run web:typecheck` | PASS. |
| Main TypeScript | `npm run web:test` | PASS; 26 files / 247 tests. |
| Main TypeScript | `npm run web:build` | PASS with existing non-fatal font/chunk warnings. |
| Main TypeScript | `npm run desktop:preflight` | PASS supporting only. |
| Main TypeScript | `npm run docs:verify` | PASS; 167 total: 166 pass / 1 expected skip; 260 candidates / 0 diagnostics. |
| Resume package | `npm test`; `npm run build` | PASS; post-repair 6 files / 72 tests; build PASS. |
| MCP release | `npm run test`; `npm run build` | PASS; 2 files / 6 tests; build PASS. |
| Repository | generated docs projection check | PASS. |
| Repository | current-tree secret scan | PASS; zero findings. |
| Repository | `git diff --check` | PASS. |
| Client web | `BRAINDRIVE_E2E_RETAIN_EVIDENCE_ROOT="$PWD/test-results/spec10-tier-b-desktop-matrix-3f730b0c" node scripts/run-isolated-e2e.mjs --project=desktop-chrome e2e/resume-builder.spec.ts` | PASS; 1 passed in 2.3 minutes; 1 mobile-only test intentionally skipped. |
| Client web | `BRAINDRIVE_E2E_RETAIN_EVIDENCE_ROOT="$PWD/test-results/spec10-tier-b-mobile-matrix-3f730b0c" node scripts/run-isolated-e2e.mjs --project=mobile-chrome --project=mobile-safari e2e/resume-builder.spec.ts` | PASS; 2 passed / 2 intentionally skipped in 47.9 seconds. |
| Client web | `BRAINDRIVE_E2E_RETAIN_EVIDENCE_ROOT="$PWD/test-results/spec10-tier-b-recovery-matrix-3f730b0c" node scripts/run-isolated-e2e.mjs --project=desktop-chrome e2e/resume-builder-recovery.spec.ts` | PASS; 1 passed in 2.1 seconds with the strict recovery manifest. |
| Client web | `BRAINDRIVE_E2E_RETAIN_EVIDENCE_ROOT="$PWD/test-results/spec10-tier-b-inference-matrix-ed36af57" node scripts/run-isolated-e2e.mjs --project=desktop-chrome e2e/resume-builder-inference-matrix.spec.ts` | PASS; 1 passed in 1.5 seconds with the strict inference manifest. |
| Docker | Task-isolated Compose project using `compose.dev.yml` plus a temporary volume/memory override on loopback port 15073 | PASS; app healthy, web 200, API health OK, signup 201, app discovery 200, restart healthy, login/app discovery 200, and fatal/unhandled/error log-pattern count zero. |
| Existing app container | `BRAINDRIVE_SPEC10_LIVE=1 BRAINDRIVE_SPEC10_LIVE_MAX_CALLS=4 BRAINDRIVE_SPEC10_LIVE_MAX_USD=0.5 BRAINDRIVE_SPEC10_LIVE_PREFLIGHT_ONLY=1 npx tsx scripts/resume-spec10-live-validation.ts` | PASS; exact profile/model, two fixture input digests, zero provider calls, and no credential access. |
| Existing app container | Same bounded command without preflight-only and with an exclusive sanitized report path | FAIL provider compatibility / PASS host recovery; exactly 4 calls, $0.03 spend delta, both fixtures schema/evidence-valid through deterministic fallback. |
| Existing app container | Separately approved diagnostic rerun on candidate `78ff7139…` with the same exact ceiling and a new exclusive report path | FAIL provider compatibility / PASS host recovery; exactly 4 calls, $0.07 spend delta, complete diagnostics for both attempts and both fixtures. |
| Existing app container | Separately approved rule-ID diagnostic on candidate `75955c62…` with the same exact ceiling and a new exclusive report path | FAIL provider compatibility / FAIL aggregate host recovery; exactly 4 calls and $0.07 spend delta. Dense completed through deterministic fallback; holdout retry ended at the provider deadline. |
| Existing app container | Separately approved policy-9 diagnostic on candidate `c17460b7…` with the same exact ceiling and a new exclusive report path | FAIL provider compatibility / PASS aggregate host recovery; exactly 4 calls and $0.05 spend delta. Dense and holdout completed through deterministic fallback with complete timing, structural-subtype, and rule-ID diagnostics. |
| Existing app container | Separately approved policy-10 structural-envelope diagnostic on candidate `99faeda4…` with the same exact ceiling and a new exclusive report path | FAIL provider compatibility / PASS aggregate host recovery; exactly 4 calls and $0.09 spend delta. Dense and holdout completed through deterministic fallback with complete content-free schema issue IDs. |
| Existing app container | Separately approved policy-11 nested-role diagnostic on candidate `20b04844…` with the same exact ceiling and a new exclusive report path | FAIL provider compatibility / PASS aggregate host recovery; exactly 4 calls and $0.05 spend delta. Dense and holdout completed through deterministic fallback; provider JSON reached host normalization and failed exact role ownership binding. |
| Existing app container | Separately approved policy-12 semantic-binding diagnostic on candidate `c8d6273d…` with the same exact ceiling and a new exclusive report path | FAIL provider compatibility / PASS aggregate host recovery; exactly 4 calls and $0.10 spend delta. Dense repeated top-level experience leakage; Holdout repeated invalid heading shape; both completed through deterministic fallback. |
| Main TypeScript | `npx vitest run resume-inference/spec-10-live-validation.test.ts` | PASS; 6 tests after the tests-first adjudication, schema-issue, and safe-diagnostic repairs. |
| Repository | `node --test tools/docs/test/browser-e2e-contract.test.mjs` | PASS; 3/3 after tests-first retention-contract changes. |
| Repository | `node tools/docs/check.mjs --paths docs/developers/verification.md builds/typescript/client_web/README.md docs/developers/catalog.json` | PASS; 260 scoped candidates / 0 diagnostics. |

## Sanitized browser evidence

The table preserves the previously audited M6 artifact hashes and adds the currently retained inference-matrix root. Only `spec10-tier-b-inference-matrix-ed36af57` remains on disk; it contains exactly the two allowlisted JSON artifacts below and no raw Playwright trace:

| Evidence root | Artifact | Bytes | SHA-256 |
|---|---|---:|---|
| `spec10-tier-b-desktop-matrix-3f730b0c` | `sanitized-browser-run.json` | 1,105 | `c5e73a6a82fea6dfadab147b82beead65e184e657c35c25ed0371411a72bdc99` |
| same | `screenshots/resume-builder-career-preview.png` | 114,827 | `ee0c22f98caf8558e7e77681ea9ceccb41e9a6094632709fe136fe0cb4565787` |
| same | `screenshots/resume-builder-owner-review.png` | 124,000 | `48dc6f3ded3e629a16fb5bf70e7483776da48004529cfe6825812959061419ad` |
| same | `screenshots/resume-builder-version-comparison.png` | 132,058 | `825e3381e1999681a7905d912c66f9ccebc182c4322f6956c16f4731c0de47bc` |
| `spec10-tier-b-mobile-matrix-3f730b0c` | `sanitized-browser-run.json` | 621 | `29f56d39d0703ef1f0f12b42e151b86f21deaede53b175cb3ccc10cad207b0f9` |
| `spec10-tier-b-recovery-matrix-3f730b0c` | `sanitized-browser-run.json` | 772 | `a1269163cbb037c1e2bcb6d43fd946314d9c6b73e120ec96b0c241926fc4051b` |
| same | `manifests/spec10-browser-recovery-matrix.json` | 2,162 | `5df5ccbce33890983661ccdb37a65f646ac27f12de06c9b7c57fb4069a374e67` |
| `spec10-tier-b-inference-matrix-ed36af57` | `sanitized-browser-run.json` | 781 | `039e588487ed416b7912efe701f3d71e26746982350326f0f5bec8c5e897f5bc` |
| same | `manifests/spec10-browser-inference-matrix.json` | 6,473 | `2bd4d136485a2a45ae2240b4c1385321003f745bc26ff809fd42b716ff3b8854` |

Each summary records status `passed`, its exact project/file selection, synthetic-fixture-only scope, and false for retained credentials/tokens/endpoints/private paths. The strict `spec10-browser-recovery-matrix.json` contains only scenario IDs, typed status classes, and exact write/read/transition counters. The strict `spec10-browser-inference-matrix.json` records two frozen fixture IDs/digests with 29 confirmed facts, 3 jobs, 29 rendered statements, status `proposed`, and zero approvals, plus all 24 typed error codes with zero proposal writes and zero protected-state mutations. Independent visual review found only the documented synthetic owner fixture in the three desktop screenshots. The raw Playwright trace was not retained; the unsafe raw archive from the initial failed attempt was deleted without inspecting or outputting its contents.

## Sanitized Docker deployment evidence

- The existing owner-bound development project was discovered read-only as two running services and was not restarted, stopped, or reconfigured.
- A separate project used task-owned synthetic memory, secrets, app-platform state, app dependencies, web dependencies, network, containers, and loopback port 15073. The isolated Docker app reached `healthy`; the web shell returned 200 and proxied API health returned OK.
- Synthetic signup returned 201 and authenticated app discovery returned 200 with Resume Builder available. After an app-container restart, health returned on attempt 6; the synthetic account logged in with 200 and Resume Builder remained discoverable.
- The app image identity was `sha256:edfe0bebe8029854b11f51c334301e639d48b718c266e6277881ae2ada3ef229`; the web image identity was `sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea`; fatal/unhandled/error log-pattern count was zero.
- Teardown removed the task containers, network, four named volumes, override, and synthetic memory. A post-cleanup check found no task project or volumes and found the pre-existing two-service development stack still running with the app healthy.

## Sanitized live-provider evidence

- Authority was exact: profile `braindrive-models`, model `braindrive-models-default`, maximum 4 calls, maximum $0.50, exact frozen dense/holdout fixtures, and immediate authentication/authorization/quota/rate-limit/model-mismatch/budget stops. The no-call preflight passed before credential resolution.
- The initial execution candidate was combined identity `a68a21557ab3d43c9f9c5eee42b88baf881441fea61520b8efcb2e9657030da1`. The separately approved diagnostic rerun used combined candidate `78ff7139583b8ed809630f6b6cba0f880c707ff22ede780779386eeb63b32263`; the rule-ID diagnostic used combined candidate `75955c626aae34d379f9ed6b5fb10969a657d6d348e99722deb511070b1c5aea`; the policy-9 diagnostic used `c17460b75e53eccab5acb72621ca967b3fc3bbd37d11ad1da20b332a8ca970cf`; the policy-10 structural-envelope diagnostic used `99faeda4cdfc1e12fbb9320c7ebeb8d04d541d7901e28ca3bd8e250c72c24083`; the policy-11 nested-role diagnostic used `20b0484485933dc43724633a4b81959c45ce2a706992e0f921e7855f7928d02f`; and the policy-12 semantic-binding diagnostic used `c8d6273dd02f7a622240f88bedfb0b9d3880908bca380d0cdd1726849d0e9a51`.
- The initial run used exactly 4 provider calls and an observed $0.03 spend delta. Dense and holdout each used 2 calls; both final results were schema-valid, evidence-valid, contained 25 statements, and completed through `deterministic_fallback`. Both provider attempts exhausted into `deterministic_fallback`; therefore host recovery passed and provider compatibility failed.
- The retained `spec10-live-provider-a68a2155/spec10-live-provider.json` is 1,220 bytes with SHA-256 `7b3a041aea6c4dfdf554c0d67322421637e939fbe4c80d99f6c9206132149bfd`. It contains only fixture IDs/digests, counts, dispositions, modes, booleans, and the authorized/observed spend numbers; the content scan found no credential, token, endpoint, private path, prompt, provider body, raw output, or owner content.
- The original manifest status is superseded by the tests-first adjudication repair: a valid final host fallback is `recovered`, with `provider_compatibility_passed=false` and `host_recovery_passed=true`, not `passed`. The immutable manifest remains retained rather than rewritten. Focused tests captured the prior false-positive red, then passed 4/4 after the repair.
- After the initial run, the bounded harness was upgraded tests-first to require a complete content-free attempt/terminal projection. The newest upgrade adds stable allowlisted validator rule IDs to deterministic-validation attempts and separate provider/targeted/full terminal arrays. Reports otherwise retain only attempt number, stage, normalized finish category, decision, bounded terminal outcome fields, allowlisted validator codes, and ordered recovery dispositions; prompts, prior candidates, validator messages, statement IDs, provider bodies, raw output, and owner content remain excluded. Historical manifests were not rewritten.
- The separately approved diagnostic rerun used exactly 4 calls and $0.07 observed spend. Dense and holdout each returned `stop` and reached `deterministic_validation` on attempt 1 (`retry`) and attempt 2 (`fallback`). Dense final provider codes were `schema_invalid`. Holdout final provider codes were `schema_invalid` and `unsupported_claim`. For both fixtures, targeted fact repair remained `schema_invalid`, the complete deterministic General constructor passed, and the final disposition was `full_constructor_accepted`. The report therefore records `status=recovered`, complete diagnostics, provider compatibility false, and host recovery true.
- The retained `spec10-live-provider-diag-78ff7139/spec10-live-provider.json` is 4,270 bytes with SHA-256 `915b7b2175352d6afaba4046e6c102c938ebaa93f2d01b1d8e816ecbab32f847`. Independent schema/content audit passed and found no prompt, candidate, validator message, statement ID, provider body, raw output, owner content, credential, token, endpoint, or private path. Cumulative authorized validation evidence is 8 calls and $0.10 observed spend across two separately approved bounded runs.
- The rule-ID diagnostic used exactly 4 calls and $0.07 observed spend. Dense attempt 1 stopped at `output_schema_validation` and triggered structural retry; attempt 2 reached deterministic validation with `role_bullet_limit_exceeded`, `statement_factual_wording_unsupported`, and `statement_section_not_ordered`, after which targeted repair still failed bullet-limit and section-order rules and the full constructor accepted. Holdout attempt 1 reached deterministic validation with the same three rule IDs, so its second request received the prior structured candidate plus those rule IDs, safe codes, affected statement identities, and safe messages; Holdout attempt 2 ended `deadline_exceeded` at `provider_request`, before a second candidate could be compared. Dense therefore recovered through `deterministic_fallback`, holdout failed, and the run records provider compatibility false and aggregate host recovery false.
- The retained `spec10-live-provider-rules-9e2c94d7/spec10-live-provider.json` is 4,444 bytes with SHA-256 `57cc13b091b8fc02e2a17baeda1a2d0657632df54c439876e2c6046d5e50ab9f`. Its strict schema/content audit found no retained prompt, candidate, validator message, statement ID, provider body, raw output, owner content, credential, token, endpoint, or private path. Cumulative authorized validation evidence is 12 calls and $0.17 observed spend across three separately approved bounded runs.
- The policy 9 diagnostic used exactly 4 calls and $0.05 observed spend. Dense attempt 1 failed `purpose_schema_mismatch` after an `under_2m` provider response; its structural retry completed in `under_30s` but then failed `statement_factual_wording_unsupported` and `substantive_role_underrepresented`. Holdout received `role_bullet_limit_exceeded` on both attempts: its `under_2m` first attempt triggered the evidence-validation retry, and the `under_30s` retry received the prior structured candidate, compact grouped rule evidence, and a narrow instruction to reduce the affected job to six bullets, yet repeated the same rule. Targeted local repair did not resolve either final candidate; full deterministic construction accepted both, so the report is `recovered`, provider compatibility false, and aggregate host recovery true.
- The retained `spec10-live-provider-prompt9-c17460b7/spec10-live-provider.json` is 5,392 bytes with SHA-256 `eaabc7b07a7c80810b625dd222ede58652e0ceb39ca48e9c84fe1148f8dc8caa`. The runner's built-in content-free assertion passed before its exclusive write; independent key/value review confirmed that only the documented false retention booleans mention credential/token/path categories. It retains no prompt, candidate, validator message, statement identity, provider body, raw output, owner content, credential value, token value, endpoint, or private path. Cumulative authorized validation evidence is 16 calls and $0.22 observed spend across four separately approved bounded runs.
- The policy 10 structural-envelope diagnostic used exactly 4 calls and $0.09 observed spend. The General provider JSON schema required `experience_roles` and structurally limited each role's `bullet_statement_ids` to six while the broker retained the exact two-call ceiling. Dense attempt 1 reported `statement_invalid` and `experience_role_bullet_statement_ids_invalid`; its retry reported `experience_role_binding_invalid`. Holdout attempt 1 reported `experience_role_binding_invalid`; its retry reported `statement_invalid`. These are allowlisted content-free schema issue IDs: malformed field values and provider output were not retained or echoed. Both fixtures then completed through the unchanged deterministic General fallback with 25 schema/evidence-valid statements, so the report is `recovered`, provider compatibility false, and aggregate host recovery true.
- The retained `spec10-live-provider-schema-v2-99faeda4/spec10-live-provider.json` is 3,907 bytes, mode 0600, with SHA-256 `5dcbd7e590235c92f22b98f806f5f7bbf946b0a2bedf5c36f7c5a0edbdc4d636`. The runner's built-in assertion and an independent in-container key/value audit passed. It retains no prompt, candidate, validator message, statement identity, provider body, raw output, owner content, credential value, token value, endpoint, or private path. Cumulative authorized validation evidence is 20 calls and $0.31 observed spend across five separately approved bounded runs.
- The policy 11 nested-role diagnostic used exactly 4 calls and $0.05 observed spend. Dense returned `stop` twice; Holdout attempt 1 ended with `length`, and its `stop` retry reached host normalization. The content-free result was `experience_role_binding_invalid` on both dense attempts and the holdout retry. Thus the provider accepted the structural nested schema but did not preserve exact job-owned heading/bullet evidence binding. Both fixtures completed through the unchanged deterministic fallback with 25 schema/evidence-valid statements, so the report is `recovered`, provider compatibility false, and aggregate host recovery true. The retry received the content-free binding ID; no malformed value or provider output was retained or echoed.
- The retained `spec10-live-provider-schema-v3-20b04844/spec10-live-provider.json` is 3,714 bytes, mode 0600, with SHA-256 `44a0774d0778e823ecdf1fe4a358d544a1d100eb1fcd58e648b898ce2e12e7e2`. The runner's built-in assertion and an independent in-container key/value audit passed with zero forbidden keys and zero suspicious string values. It retains no prompt, candidate, validator message, statement identity, provider body, raw output, owner content, credential value, token value, endpoint, or private path. Cumulative authorized validation evidence is 24 calls and $0.36 observed spend across six separately approved bounded runs.
- The policy 12 semantic-binding diagnostic used exactly 4 calls and $0.10 observed spend. Dense received `experience_role_top_level_leakage` on both attempts; Holdout received `experience_role_heading_shape_invalid` on both attempts. Each exact content-free issue ID reached the already-bounded structural retry, but the provider repeated the same defect. Both fixtures completed through the unchanged deterministic fallback with 25 schema/evidence-valid statements. The report therefore records `status=recovered`, provider compatibility false, and aggregate host recovery true without increasing the two-call-per-operation ceiling.
- The retained `spec10-live-provider-semantic-policy12-c8d6273d/spec10-live-provider.json` is 3,898 bytes, mode 0600, with SHA-256 `b5a602e1fb4c3a592730ef687616de27186129a7071ff6dc2cf1c861e5924ed0`. The runner's built-in assertion and an independent in-container key/value audit passed with zero forbidden keys and zero suspicious string values. It retains no prompt, candidate, validator message, statement identity, provider body, raw output, owner content, credential value, token value, endpoint, or private path. Cumulative authorized validation evidence is 28 calls and $0.46 observed spend across seven separately approved bounded runs.
- No live process survived. The existing app container remained running and healthy; no provider profile, model, credential, owner data, approval, or publication was changed.

## Unrun gates, limitations, and final decision

- The isolated desktop owner journey, deterministic browser save/recovery matrix, Mobile Chrome/Mobile Safari responsive matrix, reduced-motion checks, 200% zoom checks, exact dense/holdout presentation, and exhaustive 24-class invalid presentation matrix pass. `B4` is PASS for browser presentation; broker/store truth remains independently covered by `S1`.
- The scoped Docker deployment smoke passed without owner-state mutation. Exact Docker delayed/lost response, process/MCP restart, CAS conflict, and guarded-action topology rows were not executed, so `RB10-G3` remains blocked alongside native topology.
- All seven bounded live runs stayed within their separate authorities. Provider compatibility remains failed. The newest run proves that the exact content-free semantic issue reaches the retry, but the provider repeats it: top-level experience leakage for Dense and invalid heading shape for Holdout. The structural six-bullet ceiling, two-call ceiling, and deterministic fallback remain effective; further provider work should improve adherence to the role envelope without weakening host validation or adding calls. No further provider call is authorized after the policy 12 diagnostic's four-call ceiling was consumed.
- Native Windows/macOS execution and named human review were not run because their environments/reviewers and authority were not supplied.
- A clean committed source revision was not created because commit authority was not supplied; the exact dirty content identity is reproducible but does not substitute for that release gate.
- Desktop preflight, deterministic browser harnesses, Docker health/auth/restart smoke, host fallback success, and synthetic adapter calls are not relabeled as native, live-provider compatibility, named-human, or Docker save/recovery fault-topology evidence.
- No provider profile, credential, pricing, production configuration, schema migration, owner data, approval, publication, commit, push, release, or reset behavior changed in M6.

`RB10-G1`, `RB10-G2`, `RB10-G5`, and `RB10-G7` pass. `RB10-G3`, `RB10-G4`, and `RB10-G6` retain exact Tier A/browser/Docker-smoke/host-recovery PASS subsets but remain BLOCKED by exact Docker topology, failed live-provider compatibility, human, or native evidence. `RB10-G8` is BLOCKED by those remaining provider, human, native, topology, and clean-candidate gates. Final disposition: **HOLD — not release-ready and not ready for product/release approval.**
