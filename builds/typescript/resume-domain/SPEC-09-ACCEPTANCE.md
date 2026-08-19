# Spec 09 Milestone 7 acceptance record

Recorded: 2026-08-14

Disposition: **HOLD — not release-ready**

This is the sanitized, source-adjacent requirement-to-evidence record for Spec 09 structured-inference reliability and recovery. Credential-free source, contract, integration, package, and browser evidence is recorded below. The implementation is still an uncommitted working tree, so there is no immutable source candidate or evidence revision. Docker, live BrainDrive Models, attributable human review, and native Windows/macOS evidence were not authorized or available. No lower-layer result substitutes for those gates.

## Candidate, authority, and environment

- Branch: `feature/resume-builder-app`.
- Repository HEAD: `8343fd7d8266c06760eae8cf7dba47ae90d38a52`.
- Source candidate revision: **WORKTREE_UNVERIFIED**. HEAD predates the cumulative Spec 09 implementation and the working tree is dirty.
- Evidence revision: **WORKTREE_UNVERIFIED**. No source/evidence revision pair can be frozen without a clean immutable candidate.
- Environment: WSL2 Linux x86_64; Node `v20.20.1`; npm `10.8.2`; Rust/Cargo `1.95.0`. CI declares Node 22, so exact CI runtime parity is not established here.
- Product authority present: the owner accepted the Spec 09 planning defaults for implementation.
- Authority absent: exact Tier B Docker target/start/restore authority; Tier C entitlement and bounded-call authority for `braindrive-models` / `braindrive-models-default`; named human reviewers; native Windows and macOS environments; commit, publish, or release authority.
- Revision rule: all candidate-level evidence must be rerun after the complete implementation is committed as one clean immutable source candidate. Any source, schema, configuration, fixture, or provider-policy change invalidates affected and higher-layer evidence.

## Evidence keys

| Key | Environment and command | Result | Evidence |
|---|---|---|---|
| `I1` | WSL/Linux; focused broker and Spec 09 integration tests | LOCAL PASS | Controlled malformed output recovers after one same-boundary retry; final General Resume truncation reaches the validated fact-backed fallback; exact ineligible failures remain typed. |
| `I2` | WSL/Linux; real disposable Resume store and MCP-host bridge tests | LOCAL PASS | Thirteen terminal fault classes, cancellation, and malformed-to-clean recovery leave confirmed facts, interview state, strategy, definitions, approvals, Career projection, and store commits unchanged. |
| `I3` | WSL/Linux; Resume package and focused UI workflow tests | LOCAL PASS | Accurate saved-work copy, category actions, opaque support reference, retry with a fresh logical operation, reload continuity, and subsequent success are exercised with synthetic data. |
| `A1` | WSL/Linux; `npm run contracts:schemas` | PASS | Tracked JSON schemas regenerate without drift. |
| `A2` | WSL/Linux; `npm run lint`, `npm test`, `npm run build` | PASS | Runtime lint/build pass; full runtime regression passes with 120 files and 1,011 tests. |
| `A3` | WSL/Linux; `npm run docs:verify` | PASS | Documentation tests/check pass: 165 passed, one expected platform skip, 259 scoped candidates, and zero diagnostics. |
| `A4` | WSL/Linux; web lint, typecheck, test, and build commands | PASS | Web checks pass with 26 files and 247 tests; the build retains only existing font-resolution and chunk-size warnings. |
| `A5` | WSL/Linux; `npm run desktop:preflight` | PASS (supporting only) | Runtime/MCP builds and web typecheck pass; this is not a native-platform result. |
| `A6` | WSL/Linux; Resume package test and build commands | PASS | Resume Builder package passes 5 files and 44 tests; its TypeScript build passes. |
| `A7` | WSL/Linux; MCP release test and build commands | PASS | MCP release passes 2 files and 6 tests; its TypeScript build passes. |
| `A8` | WSL/Linux; isolated `npm run test:e2e` | PASS | Mobile passed 12 tests with 14 skipped; desktop passed 7 with 6 skipped; total 19 passed and 20 skipped. The focused Career-entry journey also passes after the transient-health correction. This is not Docker or native-desktop evidence. |
| `A9` | WSL/Linux; generated documentation projection check | PASS | Catalog and documentation projections are synchronized. |
| `A10` | WSL/Linux; secret scanner self-test and current-tree scan | PASS | Scanner self-test and current-tree scan pass with zero findings. |
| `A11` | WSL/Linux; focused acceptance-record test | PASS | One file and two tests verify complete one-to-one requirement coverage, HOLD disposition, and content safety. |
| `D1` | Read-only Docker Compose state inspection; controlled journey withheld | BLOCKED | Prior state: `braindrive_dev` running with two services; its app service was running/healthy and web service running. A separate two-service harness project was also running and left out of scope. No Tier B reuse/journey authority was supplied, so neither project was changed and no restore action was required. |
| `P1` | Exact BrainDrive Models v2 conformance | BLOCKED | No Tier C entitlement, provider-specific authority, or authorized isolated synthetic root was supplied. No provider call was made and no v2 registry evidence was installed. |
| `H1` | Attributable human trust/accessibility review | BLOCKED | No named reviewer or controlled review session was supplied. Automated DOM/browser evidence is not relabeled human review. |
| `N1` | Native Windows exact-candidate J-05 | BLOCKED | No native Windows environment or immutable candidate was available. |
| `N2` | Native macOS exact-candidate J-05 | BLOCKED | No native macOS environment or immutable candidate was available. |
| `C1` | Clean immutable candidate proof | BLOCKED | The cumulative implementation and this record are uncommitted by instruction; HEAD does not contain the source under test. |

## Functional requirement matrix

| Requirement | Revision | Environment / command | Evidence | Disposition |
|---|---|---|---|---|
| RB9-REQ-001 | WORKTREE_UNVERIFIED | WSL / `I1`–`I3`, `A2` | Exact taxonomy crosses broker, adapter, host, UI, audit, and support contracts. | LOCAL PASS |
| RB9-REQ-002 | WORKTREE_UNVERIFIED | WSL / `I1`, `I3` | Evidence rejection remains distinct from schema/format failure. | LOCAL PASS |
| RB9-REQ-003 | WORKTREE_UNVERIFIED | WSL / `I1`, `A2` | Stop, length, filter, refusal, tool, unknown, missing, and transport classes have explicit policies. | LOCAL PASS |
| RB9-REQ-004 | WORKTREE_UNVERIFIED | WSL / `I1`, `A2` | Tests enforce two calls and one concurrent call. | LOCAL PASS |
| RB9-REQ-005 | WORKTREE_UNVERIFIED | WSL / `I1`, `I2` | Retry identity, immutable input, policy, schema, and provider boundary stay fixed. | LOCAL PASS |
| RB9-REQ-006 | WORKTREE_UNVERIFIED | WSL / `I1`, `A2` | Eligible fallbacks pass the exact schema and deterministic validators. | LOCAL PASS |
| RB9-REQ-007 | WORKTREE_UNVERIFIED | WSL / `A2` | All twelve purposes have an exhaustive recovery disposition. | LOCAL PASS |
| RB9-REQ-008 | WORKTREE_UNVERIFIED | WSL / `I1` | Final General Resume truncation reaches fallback; ineligible purposes fail as incomplete. | LOCAL PASS |
| RB9-REQ-009 | WORKTREE_UNVERIFIED | WSL / `I2` | Real disposable durable-state mutation spies remain zero on faults and cancellation. | LOCAL PASS |
| RB9-REQ-010 | WORKTREE_UNVERIFIED | WSL / `I2`, `A2` | Duplicate/coalesced/replayed operations and input conflicts preserve idempotency. | LOCAL PASS |
| RB9-REQ-011 | WORKTREE_UNVERIFIED | WSL / `A2` | Cancellation/deadline late responses cannot complete. | LOCAL PASS |
| RB9-REQ-012 | WORKTREE_UNVERIFIED | WSL / `I3`, `A8` | Direct/Career context and workflow location survive retry and reload. | LOCAL PASS |
| RB9-REQ-013 | WORKTREE_UNVERIFIED | WSL / `A2` | Completion mode separates provider, repair, fallback, synthetic, quality, and release claims. | LOCAL PASS; release blocked |
| RB9-REQ-014 | WORKTREE_UNVERIFIED | WSL / `A2` | Compatibility fails before credential resolution where knowable. | LOCAL PASS |
| RB9-REQ-015 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | V2 expiry, observed identity, and drift checks pass synthetically. | LOCAL PASS; live freshness blocked |
| RB9-REQ-016 | WORKTREE_UNVERIFIED | WSL / `A2`, `A10` | App/UI contracts expose no provider secret, endpoint, or fallback authority. | LOCAL PASS |

## AI, UX, conformance, and invariant matrix

| Requirement | Revision | Environment / command | Evidence | Disposition |
|---|---|---|---|---|
| RB9-AI-001 | WORKTREE_UNVERIFIED | WSL / `I1`, `A2` | Fixed policies, strict schemas, tools disabled, scoped blocks. | LOCAL PASS |
| RB9-AI-002 | WORKTREE_UNVERIFIED | WSL / `I1` | Structural repair changes representation only. | LOCAL PASS |
| RB9-AI-003 | WORKTREE_UNVERIFIED | WSL / `I1`, `A2` | Validation repair receives safe findings and revalidates. | LOCAL PASS |
| RB9-AI-004 | WORKTREE_UNVERIFIED | WSL / `I1`, `A2` | Prose, fences, embedded instructions, and tool output remain untrusted. | LOCAL PASS |
| RB9-AI-005 | WORKTREE_UNVERIFIED | WSL / `A2` | Model self-assessment cannot override deterministic or approval gates. | LOCAL PASS |
| RB9-AI-006 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | Report schema separates fallback/synthetic from provider success. | LOCAL PASS; live proof blocked |
| RB9-AI-007 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | Harness retains every fresh run and forbids best-of-N. | LOCAL PASS; live runs blocked |
| RB9-UX-001 | WORKTREE_UNVERIFIED | WSL / `I3`, `A6` | UI projection preserves semantic category. | LOCAL PASS |
| RB9-UX-002 | WORKTREE_UNVERIFIED | WSL / `I3`, `A6` | Every terminal message says saved work and approval are unchanged. | LOCAL PASS |
| RB9-UX-003 | WORKTREE_UNVERIFIED | WSL / `I3`, `A6` | Retry/settings/account/continue actions use an exact category matrix. | LOCAL PASS |
| RB9-UX-004 | WORKTREE_UNVERIFIED | WSL / `A2`, `A6`, `A10` | Findings and diagnostics are allowlisted and canary-safe. | LOCAL PASS |
| RB9-UX-005 | WORKTREE_UNVERIFIED | WSL / `I3`, `A8` | Input, selected context, and location survive error/retry/reload. | LOCAL PASS |
| RB9-UX-006 | WORKTREE_UNVERIFIED | WSL / `A6`, `A8`; human / `H1` | Automated keyboard/focus/status/mobile/zoom contracts pass. | PARTIAL; human review blocked |
| RB9-CONF-001 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | V2 binds exact identity/digests and craft proves zero calls locally. | PARTIAL; live evidence blocked |
| RB9-CONF-002 | WORKTREE_UNVERIFIED | WSL / `A2` | Eleven synthetic fixtures cover all accepted corpus classes. | LOCAL PASS |
| RB9-CONF-003 | WORKTREE_UNVERIFIED | WSL / `I1`, `I2` | Deterministic fault corpus covers mandatory provider/result classes. | LOCAL PASS |
| RB9-CONF-004 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | Harness enforces three fresh operations per applicable fixture/purpose. | PARTIAL; live runs blocked |
| RB9-CONF-005 | WORKTREE_UNVERIFIED | WSL / `A2` | V1/insufficient evidence cannot satisfy release compatibility. | LOCAL PASS |
| RB9-CONF-006 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | Ninety-day expiry and observed-identity drift invalidate v2 records. | LOCAL PASS; live record blocked |
| RB9-CONF-007 | WORKTREE_UNVERIFIED | WSL / `A2` | Reports retain primary/repair/fallback/failure/validity/latency outcomes. | LOCAL PASS |
| RB9-CONF-008 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | Provider evidence is profile-specific; Ollama/OpenRouter remain unclaimed. | LOCAL PASS; provider claim blocked |
| RB9-INV-001 | WORKTREE_UNVERIFIED | WSL / `I1`, `I2` | Invalid/unvalidated output never becomes usable durable state. | LOCAL PASS |
| RB9-INV-002 | WORKTREE_UNVERIFIED | WSL / `I2` | Faults leave approved resume and Career facts unchanged. | LOCAL PASS |
| RB9-INV-003 | WORKTREE_UNVERIFIED | WSL / `I1`, `I2` | Recovery cannot switch authority or provider boundary. | LOCAL PASS |
| RB9-INV-004 | WORKTREE_UNVERIFIED | WSL / `A2` | Fallback property tests prohibit claims absent from immutable inputs. | LOCAL PASS |
| RB9-INV-005 | WORKTREE_UNVERIFIED | WSL / `I1`, `A2` | Primary, repair, and fallback share schema/validator gates. | LOCAL PASS |
| RB9-INV-006 | WORKTREE_UNVERIFIED | WSL / `I3`, `A6` | Owner message matches exact internal category. | LOCAL PASS |
| RB9-INV-007 | WORKTREE_UNVERIFIED | WSL / `I2`, `A2` | Same-input replay and different-input conflict are enforced. | LOCAL PASS |
| RB9-INV-008 | WORKTREE_UNVERIFIED | WSL / `I1`, `I2` | Cancelled/late/filtered/tool/incompatible/failed results cannot complete. | LOCAL PASS |
| RB9-INV-009 | WORKTREE_UNVERIFIED | WSL / `I3`, `A8` | Known context remains selected through recovery. | LOCAL PASS |
| RB9-INV-010 | WORKTREE_UNVERIFIED | WSL / `A2`, `A10` | UI/audit/support evidence is strict and content-minimized. | LOCAL PASS |
| RB9-INV-011 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | Compatibility and resume quality stay separate. | LOCAL PASS; release claim blocked |
| RB9-INV-012 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | Fallback/synthetic outcomes cannot become live evidence. | LOCAL PASS; live evidence blocked |

## Story matrix

| Story | Revision | Environment / command | Evidence | Disposition |
|---|---|---|---|---|
| RB9-US-1 | WORKTREE_UNVERIFIED | WSL / `I1`–`I3`, `A8` | Malformed/incomplete Create Resume Draft recovers or fails exactly without lost work. | LOCAL PASS |
| RB9-US-2 | WORKTREE_UNVERIFIED | WSL / `I1`, `I3` | Every tested category remains distinct and actionable. | LOCAL PASS |
| RB9-US-3 | WORKTREE_UNVERIFIED | WSL / `I2` | Retry/fallback preserves owner, data, and provider authority. | LOCAL PASS |
| RB9-US-4 | WORKTREE_UNVERIFIED | WSL / `I2`, `A10` | Opaque support reference locates safe stage-level evidence. | LOCAL PASS |
| RB9-US-5 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | V2 contract is strict and freshness-bound. | BLOCKED for compatibility claim |
| RB9-US-6 | WORKTREE_UNVERIFIED | WSL / `I1`, `I2`, `A2` | All twelve purposes share the taxonomy and accepted fault policy. | LOCAL PASS |

## Release gates

| Gate | Revision | Environment / command | Evidence | Disposition |
|---|---|---|---|---|
| RB9-G1 | WORKTREE_UNVERIFIED | WSL / `I1`, `I2` | Controlled malformed and final-truncation regressions recover/fail exactly with state unchanged. | LOCAL PASS |
| RB9-G2 | WORKTREE_UNVERIFIED | WSL / `I1`–`I3` | Taxonomy retains meaning across every implemented layer. | LOCAL PASS |
| RB9-G3 | WORKTREE_UNVERIFIED | WSL / `I2` | Real disposable state/mutation spies remain unchanged across fault paths. | LOCAL PASS |
| RB9-G4 | WORKTREE_UNVERIFIED | WSL / `I1`, `A2` | Twelve-purpose decision and fault matrices pass. | LOCAL PASS |
| RB9-G5 | WORKTREE_UNVERIFIED | WSL / `I1`, `A2` | Recovered values pass exact schema/validators; ineligible paths fail closed. | LOCAL PASS |
| RB9-G6 | WORKTREE_UNVERIFIED | live / `P1` | Exact provider/model repeated v2 evidence is unavailable. | BLOCKED |
| RB9-G7 | WORKTREE_UNVERIFIED | WSL / `A2`; live / `P1` | Freshness logic passes synthetically; no authorized v2 live record exists. | PARTIAL |
| RB9-G8 | WORKTREE_UNVERIFIED | WSL / `I2`, `A10` | Diagnostics are useful and safe under automated canary/secret checks. | LOCAL PASS |
| RB9-G9 | WORKTREE_UNVERIFIED | human / `H1` | Automated UX checks cannot establish attributable human trust review. | BLOCKED |
| RB9-G10 | WORKTREE_UNVERIFIED | `C1`, `D1`, `N1`, `N2` | No immutable candidate, authorized Docker journey, or native Windows/macOS evidence. | BLOCKED |

Because `RB9-G6`, `RB9-G9`, and `RB9-G10` are blocked, the disposition remains HOLD regardless of local automated results.

## Incident before and after

The historical remote response body and sanitized operation record were unavailable, so its exact cause is not claimed. Controlled fixtures reproduce the observed problem classes without owner content:

- malformed Create Resume Draft: the first response fails strict parsing, the second clean response completes through structural repair, and no prior durable owner state changes;
- final truncation: two `length` outcomes now reach the General Resume deterministic fact-backed fallback, which must pass the exact schema and evidence validators before completion;
- ineligible final truncation: the operation ends as `incomplete_output`, not a formatting or evidence error;
- retry/reload: the browser preserves interview context, presents the exact saved-work copy and Retry action, creates a fresh operation, survives reload, and accepts a later clean result.
- transient runtime health: the long owner journey exposed that one 500 ms periodic probe miss could terminate an otherwise ready app while audit-heavy work was in progress. Periodic liveness now requires three consecutive one-second misses before termination; a later successful probe resets the count. Unexpected process exits and output-limit containment remain immediate. The focused supervisor regression, focused Career journey, and exact full E2E command pass after this correction.

This proves correction of the incident classes in controlled source/integration/browser layers. It does not establish the historical provider response or live provider reliability.

## Registry, schema, state, and documentation decisions

- Contract additions remain backward-readable and strict; generated schemas are synchronized. No owner-data migration or database backfill is required.
- The compatibility reader supports legacy v1 as provisional and strict v2 evidence. The tracked release registry was not updated because no authorized complete v2 run exists.
- BrainDrive Models, Ollama, and BYOK OpenRouter remain independent. No credential, provider endpoint, or client provider control was added.
- Failure/recovery can persist only idempotent inference lifecycle terminals. It cannot confirm facts, approve resumes, publish Career artifacts, or overwrite prior owner state.
- Runtime liveness state remains host-local and transient. The health-probe tolerance change adds no owner-data field, schema, migration, credential, or provider behavior.
- The acceptance record is cataloged as a non-authoritative internal evidence record. Existing inference/provider documentation already describes the implemented v2 procedure; no release note is added while release gates are blocked.

## Commands not run and required follow-up

The exact credential-free command results on this working tree were:

| Working directory | Command | Result |
|---|---|---|
| Main TypeScript | `npm run contracts:schemas` | PASS; schemas generated without drift. |
| Main TypeScript | `npm run lint` | PASS. |
| Main TypeScript | `npm test` | PASS; 120 files, 1,011 tests. |
| Main TypeScript | `npm run build` | PASS. |
| Main TypeScript | `npm run docs:verify` | PASS; 165 passed, one expected platform skip; 259 candidates and zero diagnostics. |
| Main TypeScript | `npm run web:lint` | PASS. |
| Main TypeScript | `npm run web:typecheck` | PASS. |
| Main TypeScript | `npm run web:test` | PASS; 26 files, 247 tests. |
| Main TypeScript | `npm run web:build` | PASS with font-resolution and chunk-size warnings. |
| Main TypeScript | `npm run desktop:preflight` | PASS; supporting WSL evidence only. |
| Main TypeScript | focused process-supervisor regression | PASS; 1 file, 6 tests. |
| Resume package | `npm test` | PASS; 5 files, 44 tests. |
| Resume package | `npm run build` | PASS. |
| MCP release | `npm test` | PASS; 2 files, 6 tests. |
| MCP release | `npm run build` | PASS. |
| Web client | `npm run test:e2e` | PASS; mobile 12 passed/14 skipped; desktop 7 passed/6 skipped; total 19 passed/20 skipped. |
| Web client | isolated desktop owner-journey rerun | PASS; 1 passed after the transient-health correction. |
| Repository root | `node tools/docs/sync-generated.mjs --check` | PASS; projections match. |
| Repository root | `tools/security/scan-secrets.sh --self-test` | PASS; every scanner guard passed. |
| Repository root | `tools/security/scan-secrets.sh --current` | PASS; zero findings. |
| Main TypeScript | focused acceptance-record test | PASS; 1 file, 2 tests. |

Before correction, the full E2E command timed out waiting for the tailored-resume heading. A focused rerun reached that stage, then the app runtime became unhealthy, recovered, and the owner-review status remained `Review not run`. A clean focused run could pass, but the exact full command reproduced the runtime generation change and failure. The supervisor's single-miss termination policy was corrected and covered directly; the post-fix focused journey and exact full command then passed without broadening assertions or adding retries.

- Docker dev start/journeys: blocked by absent exact Tier B target/data-root/reuse/restore authority. Safe read-only Compose inspection found `braindrive_dev` running with two services (app running/healthy; web running) and an unrelated two-service harness project running. Neither project was started, stopped, recreated, entered, or otherwise mutated, so the observed prior state remained current and no restore action occurred.
- The first read-only inspection formatter expected `jq`, which was unavailable; a second attempted Compose template was rejected before data output. The final read-only inspection used Node to select only project/service/state/health fields and succeeded. These were invocation corrections with no Docker mutation.
- Guarded BrainDrive Models conformance: blocked by absent Tier C authority, entitlement, and approved isolated synthetic root. Resource use was zero; no provider output, digest, or v2 record exists.
- Human review: blocked by absent named reviewers and attributable session evidence.
- Native Windows/macOS: blocked by absent platform environments and immutable candidate. WSL preflight is supporting evidence only.
- `desktop:test`: not needed as native evidence and not run as a substitute; the required credential-free command for this milestone is `desktop:preflight`.

Next: create one clean immutable commit only when authorized, rerun every automated check under CI Node 22, then obtain separately authorized Docker, exact BrainDrive Models, human, native Windows, and native macOS evidence on that same source candidate. Do not install v2 registry evidence unless every required live run and zero-tolerance gate passes.

## Scope and preservation

Milestone 7 adds this evidence record, its content-safety/completeness test, the catalog registration, the source-adjacent README link, and the narrowly evidenced transient-health correction plus complementary supervisor regressions and lifecycle documentation. It adds no fallback, provider change, provider run, Docker mutation, native mutation, release action, or owner-content artifact. The four pre-existing owner changes named in the implementation plan remain preserved. No commit, push, merge, publish, release, stash, reset, or destructive cleanup was performed.
