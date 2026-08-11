# Spec 07 Milestone 8 integration and release-verification record

Recorded: 2026-08-11
Disposition: **HOLD — not release-ready**

This is the sanitized, source-adjacent requirement/story/gate-to-evidence manifest for Spec 07. It records checks independently rerun on the current worktree and distinguishes useful local evidence from release evidence. It does not treat a dirty worktree as an immutable candidate, deterministic fixtures as provider or human evidence, WSL/Linux as native Windows, or local browser execution as Docker dev verification.

## Candidate, authority, and environment

- Branch: `feature/resume-builder-app`
- Checked-out base revision: `7ba4e8abebdc0032c9c2f8021321585b85397811`
- Candidate state before M8 reporting: 87 tracked files changed and 34 untracked status entries across cumulative M1–M7 work; 5,197 insertions and 342 deletions in the tracked diff. The worktree is dirty/non-immutable, so the revision above identifies only the checked-out base, not the verified source candidate.
- Spec/authority state: Spec 07 is Draft; `RB7-OQ-1` through `RB7-OQ-4` remain open; no accepted Spec 07 verification plan, M1–M7 acceptance chain, provider/model authority, human-review attribution, Docker target/cleanup contract, or native-Windows synchronization authority was present.
- Local platform: WSL2 Linux x86_64, kernel `6.6.87.2-microsoft-standard-WSL2`.
- Local tools: Node `v20.20.1`, npm `10.8.2`, Rust/Cargo `1.95.0`, Docker `29.2.0`, Compose `v5.0.2`. Repository CI specifies Node 22, so the Node-version difference remains a release risk.
- Read-only Docker inspection found a pre-existing stateful `braindrive_dev` project: app container running but unhealthy, web container running, and three named project volumes. No Docker state or volume was mutated.
- Isolated browser runners used task-owned temporary roots and synthetic data, stopped their services, and returned success. No provider credentials, owner content, external publication, commit, push, or release action was used.

## Evidence groups

| Group | Independently observed local evidence |
|---|---|
| COV | `resume-domain/evidence-coverage.test.ts`, package opportunity/workflow/UI tests, contract tests, and isolated owner E2E cover per-job dimensions, distinct outcomes, defer/reopen, question identity, known/refusal suppression, yield, grouping, correction, and job association. |
| STRAT | Contract, snapshot, strategy, broker, validator, craft, package UI, and owner E2E evidence covers bounded inspectable strategy, selected/omitted evidence, history shaping, summary/section decisions, and minimum snapshots. |
| TARGET | `resume-domain/target-fit.test.ts`, inference target-fit/e2e tests, package no-change UI tests, and owner E2E cover support classes, versioned provisional threshold, material-change manifests, durable no-change, untrusted target input, idempotency/CAS, and immutable children. |
| CRAFT | Craft evaluator/repair, validator, service, quality, mutation, clean-case, and owner E2E evidence covers statement/criterion findings, one bounded repair, mandatory-gate precedence, non-regression, evidence-limited handling, and separate approval. |
| OWNER | Capability, host-decision, workflow/UI, component, desktop, mobile, and browser-access evidence covers confirmation groups, semantic action separation, focus, retry/recovery, reload/reopen, token refresh, and preserved controls. |
| ART | Renderer/parity/export/Career publication, Rust native-export, and owner E2E evidence covers one-definition preview, clean text, exact clipboard bytes, `.txt`, PDF extraction/export, Career projection, history, comparison, and failure/recovery behavior. |
| QUALITY | `npm run resume:quality` passed the credential-free deterministic scope with `release_ready=false`: 15 fixtures, F1–F12, 12/12 mutations caught, 0/2 clean blockers, seven personas, successor checks, and anti-overfit/corpus-integrity checks. Report digest: `sha256:67f03fa088553d650659b148ce3a77558a7e94f9cbee277e30840289f83c505c`. |
| LIFE | Contract/schema drift, schema-3 migration, persistence/store, lifecycle, capability, recovery, restart, retry, response-loss, stale-input, compatibility, and downgrade/refusal cases passed in the full suites. |
| SEC | Authorization, sandbox isolation, no-tools/purpose-minimum inference, target-injection, canary/content-free diagnostic, fixture anti-gaming, and secret-scan checks passed locally; provider configuration files were unchanged. |
| LIVE | Isolated desktop owner journey, mobile projects, and non-loopback HTTP browser access passed on WSL/Linux. Docker dev verification, authorized live providers, independent human calibration, retention review, and native Windows verification were not run. |

“Local automated pass” below is useful worktree evidence only. It is not release acceptance where a row also depends on blocked authority, human judgment, provider execution, Docker, native Windows, or an immutable source revision.

## Functional and model requirement matrix

| Requirement | Evidence | M8 status |
|---|---|---|
| RB7-REQ-001 | COV, LIFE | Local automated pass; immutable-candidate runtime evidence blocked |
| RB7-REQ-002 | COV, contract/property tests | Local automated pass |
| RB7-REQ-003 | COV, owner E2E reopen | Local automated pass; Docker/native restart evidence blocked |
| RB7-REQ-004 | COV, opportunity and quality tests | Deterministic pass; human interview-quality calibration blocked |
| RB7-REQ-005 | COV, known-context tests | Local automated pass |
| RB7-REQ-006 | COV, UI and schema tests | Local automated pass |
| RB7-REQ-007 | COV, metric/refusal tests | Deterministic pass; human pressure review blocked |
| RB7-REQ-008 | COV, QUALITY yield cases | Deterministic pass; controlled generation evidence blocked |
| RB7-REQ-009 | COV, authorization/property tests | Local automated pass |
| RB7-REQ-010 | STRAT, contract/inference tests | Local automated pass; accepted OQ defaults absent |
| RB7-REQ-011 | STRAT, package UI and owner E2E | Local automated pass; non-technical review blocked |
| RB7-REQ-012 | STRAT, CRAFT, QUALITY | Deterministic pass; three-generation/human proof blocked |
| RB7-REQ-013 | STRAT, CRAFT, persona tests | Deterministic pass; human craft proof blocked |
| RB7-REQ-014 | CRAFT, validator/persona tests | Deterministic pass; human craft proof blocked |
| RB7-REQ-015 | CRAFT, QUALITY | Deterministic pass; human craft proof blocked |
| RB7-REQ-016 | STRAT, CRAFT, persona tests | Deterministic pass; human craft proof blocked |
| RB7-REQ-017 | STRAT, persona/quality tests | Deterministic pass; human craft proof blocked |
| RB7-REQ-018 | STRAT, seven-persona matrix | Deterministic pass; human craft proof blocked |
| RB7-REQ-019 | CRAFT, QUALITY denylist/pattern tests | Deterministic pass; independent tone review blocked |
| RB7-REQ-020 | TARGET, contract/inference tests | Local automated pass; accepted OQ-3 threshold absent |
| RB7-REQ-021 | TARGET, no-child/no-change tests | Local automated pass; live provider proof blocked |
| RB7-REQ-022 | TARGET, partial/unsupported visibility tests | Local automated pass; human honesty review blocked |
| RB7-REQ-023 | CRAFT, quality/mutation tests | Deterministic pass; provider/human evaluation blocked |
| RB7-REQ-024 | CRAFT, repair limit/scope tests | Local automated pass; live provider repair blocked |
| RB7-REQ-025 | CRAFT, repair non-regression tests | Local automated pass; live provider repair blocked |
| RB7-REQ-026 | CRAFT, thin-history/persona tests | Deterministic pass; human craft proof blocked |
| RB7-REQ-027 | COV, OWNER grouping tests | Local automated pass |
| RB7-REQ-028 | COV, non-fact-state tests | Local automated pass |
| RB7-REQ-029 | OWNER, host-decision and owner E2E | Local automated pass |
| RB7-REQ-030 | STRAT, TARGET, CRAFT, forbidden-copy tests | Local automated pass; non-technical review blocked |
| RB7-REQ-031 | TARGET, CRAFT, LIFE lineage tests | Local automated pass |
| RB7-REQ-032 | ART parity/extractor/E2E | Local browser pass; Docker/native Windows parity blocked |
| RB7-REQ-033 | ART, QUALITY | Reproducible-artifact pass; three-generation/provider evidence blocked |
| RB7-REQ-034 | SEC, QUALITY sanitized reports | Local automated pass; authorized retention/deletion review blocked |
| RB7-REQ-035 | CRAFT, QUALITY mutation/clean gates | Deterministic pass; human craft ground truth blocked |
| RB7-REQ-036 | CRAFT, QUALITY successor tests | Deterministic pass; human successor review blocked |
| RB7-REQ-037 | STRAT, TARGET, CRAFT broker/policy tests | Local automated pass; provider conformance blocked |
| RB7-REQ-038 | STRAT, authorization and non-fact tests | Local automated pass |
| RB7-REQ-039 | CRAFT independent validator/extractor paths | Local automated pass; independent human path blocked |
| RB7-REQ-040 | CRAFT finding-schema tests | Local automated pass |
| RB7-REQ-041 | SEC snapshot/canary tests | Local automated pass; live provider inspection blocked |
| RB7-REQ-042 | SEC anti-overfit/fixture scan | Local automated pass |
| RB7-REQ-043 | COV refusal/new-context tests | Local automated pass |
| RB7-REQ-044 | COV, TARGET truth/authority tests | Local automated pass |
| RB7-REQ-045 | inference compatibility/recovery tests | Deterministic safe-failure pass; provider conformance blocked |

## Story matrix

| Story | Evidence | M8 status |
|---|---|---|
| US-1 | COV coverage/reopen UI and owner E2E | Local automated pass; native accessibility review blocked |
| US-2 | COV yield/refusal/metric tests | Deterministic pass; non-technical human review blocked |
| US-3 | STRAT, CRAFT, QUALITY persona evidence | Deterministic pass; human craft/provider evidence blocked |
| US-4 | STRAT history shaping and persona evidence | Deterministic pass; human craft review blocked |
| US-5 | TARGET support/no-change/partial-fit evidence | Local automated pass; accepted threshold and human honesty review blocked |
| US-6 | CRAFT bounded repair/non-regression evidence | Local automated pass; live provider repair and human review blocked |
| US-7 | OWNER score-free guidance/semantic actions | Local automated pass; non-technical usability review blocked |
| US-8 | ART parity and QUALITY deterministic runs | Partial; three-generation/provider, Docker, and native Windows blocked |

## UX, observability, security, and invariant matrix

| Requirement | Evidence | M8 status |
|---|---|---|
| RB7-UX-001 | COV current-job coverage UI | Local automated pass |
| RB7-UX-002 | COV reopen/deferred owner E2E | Local automated pass |
| RB7-UX-003 | Package answer-shape UI tests | Local automated pass; non-technical review blocked |
| RB7-UX-004 | Package alternate-phrasing tests | Local automated pass; non-technical review blocked |
| RB7-UX-005 | OWNER semantic action separation | Local automated pass |
| RB7-UX-006 | OWNER accessible grouped confirmation | Component/E2E pass; manual screen-reader review blocked |
| RB7-UX-007 | STRAT/TARGET/CRAFT evidence-grounded explanation | Local automated pass; human clarity review blocked |
| RB7-UX-008 | TARGET no-change/evidence-limited states | Local automated pass |
| RB7-UX-009 | OWNER preserved controls and recovery | Local automated pass; Docker/native lifecycle blocked |
| RB7-UX-010 | Mobile/component accessibility and keyboard E2E | Automated pass; manual screen-reader/native Windows review blocked |
| RB7-OBS-001 | COV interview outcome counts | Local automated pass |
| RB7-OBS-002 | COV coverage/yield/confirmation counts | Local automated pass |
| RB7-OBS-003 | STRAT/TARGET/CRAFT/ART version-digest lineage | Local automated pass |
| RB7-OBS-004 | TARGET/CRAFT repair counts and safe categories | Local automated pass |
| RB7-OBS-005 | QUALITY separates automated and human timing | Schema pass; human timing absent |
| RB7-OBS-006 | SEC prohibited-content/canary checks | Local automated pass |
| RB7-OBS-007 | SEC content-free failed-run evidence | Local automated pass; provider failure run blocked |
| RB7-SEC-001 | Specs 2/3/5/6 boundary regression and authorization | Local automated pass; immutable-candidate live proof blocked |
| RB7-SEC-002 | Independent evaluation/extraction paths | Local automated pass; human independence blocked |
| RB7-SEC-003 | Visible evidence/change reasoning and owner actions | Local automated pass |
| RB7-SEC-004 | Synthetic-only quality corpus and privacy scans | Local automated pass; bounded retention review blocked |
| RB7-SEC-005 | ART parity blocks publication and preserves recovery | Local automated pass; Docker/native runtime proof blocked |
| RB7-SEC-006 | Controlled provider/Docker/Windows authority boundary | Correctly held; controlled executions not authorized |
| RB7-INV-001 | Truth gates across COV/TARGET/CRAFT | Local automated pass |
| RB7-INV-002 | Confirmed support references | Local automated pass |
| RB7-INV-003 | No derived authority expansion | Local automated pass |
| RB7-INV-004 | Non-fact-state safety | Local automated pass |
| RB7-INV-005 | Explicit dimension state | Local automated pass |
| RB7-INV-006 | Opportunity identity/non-repeat | Local automated pass |
| RB7-INV-007 | Evidence-shaped bullet quantity | Deterministic pass; human craft proof blocked |
| RB7-INV-008 | Contextual skills | Deterministic pass; human craft proof blocked |
| RB7-INV-009 | Material targeting change | Local automated pass; provider proof blocked |
| RB7-INV-010 | Immutable approved versions | Local automated pass |
| RB7-INV-011 | One scoped repair | Local automated pass |
| RB7-INV-012 | Mandatory-gate precedence | Deterministic mutation/clean pass |
| RB7-INV-013 | Artifact parity | Local browser pass; Docker/native Windows blocked |
| RB7-INV-014 | Bounded fresh variation | Deterministic schema pass; three-generation evidence blocked |
| RB7-INV-015 | Sanitized evidence | Local scan/report pass; controlled retention review blocked |
| RB7-INV-016 | No conversion of Spec 06 blockers without ground truth | Pass by fail-closed HOLD; no blocker was converted |

## Release gates

| Gate | Disposition | Evidence or blocker |
|---|---|---|
| RB7-G1 | Blocked | Spec 07 is Draft, OQ-1–OQ-4 are open, and no accepted M1–M7 evidence chain or immutable candidate exists. |
| RB7-G2 | Partial | COV passes locally; exact Docker/native restart and accepted authority evidence are absent. |
| RB7-G3 | Partial | Yield/refusal/metric behavior passes deterministic tests; accepted thresholds and human interview review are absent. |
| RB7-G4 | Blocked | QUALITY deterministic gates pass, but authorized three-generation output and independent craft review are absent. |
| RB7-G5 | Partial | TARGET supported/partial/no-change behavior passes locally; OQ-3 and controlled provider/human evidence are absent. |
| RB7-G6 | Partial | CRAFT mutation, clean, repair, and non-regression paths pass locally; provider/human repair evidence is absent. |
| RB7-G7 | Partial | OWNER semantics and automated interaction paths pass; accepted friction budget and non-technical usability review are absent. |
| RB7-G8 | Partial | ART parity passes local deterministic/browser checks; Docker and native Windows artifact parity are absent. |
| RB7-G9 | Blocked | `release_ready=false`; three-generation/provider conformance was not authorized and the compatibility registry cannot be promoted. |
| RB7-G10 | Blocked | No named independent resume reviewer or non-technical owner review exists. |
| RB7-G11 | Partial | Local security/privacy/lifecycle suites and zero-finding secret scan pass; controlled runtime and retention evidence are absent. |
| RB7-G12 | Blocked | The worktree is not an immutable candidate; Docker-first and exact native Windows evidence are absent despite green local regressions and this matrix. |

## Exact command results

| Command | Result |
|---|---|
| `cd builds/resume_builder && npm run test && npm run build` | Pass: 5 files/37 tests; TypeScript build pass. |
| `cd builds/typescript && npm run lint && npm run test && npm run build` | Initial pass: lint; 100 files/778 tests; TypeScript build. Post-manifest pass: lint; 101 files/779 tests; TypeScript build. |
| `cd builds/typescript && npm run resume:quality` | Deterministic scope pass; 15 fixtures; 12/12 caught mutations; 0/2 clean blockers; `release_ready=false`; digest listed in QUALITY. |
| `cd builds/typescript && npm run web:lint && npm run web:typecheck && npm run web:test && npm run web:build` | Pass: lint/typecheck; 26 files/235 tests; production build. Unresolved build-time font references and a greater-than-500-kB chunk were warnings, not failures. |
| `cd builds/mcp_release && npm run test && npm run build` | Pass: 2 files/6 tests; TypeScript build pass. |
| `cd builds/typescript && npm run docs:verify` | Pass: 164 tests, 163 passed/1 expected platform skip; 253 scoped candidates; zero diagnostics. |
| `cd builds/typescript && npm run desktop:preflight && npm run desktop:test` | Pass on WSL/Linux only: preflight; runtime 100 files/778 tests; web 26 files/235 tests; Rust 55 passed/1 ignored. This is not native Windows evidence. |
| isolated desktop Resume Builder owner E2E | Pass: 1 passed/1 expected mobile-only skip; full synthetic owner journey, artifact export, history, reload/reopen, and recovery. |
| `cd builds/typescript/client_web && npm run test:e2e:mobile` | Pass: 12 passed/10 expected project skips. |
| `cd builds/typescript/client_web && npm run test:e2e:browser-access` | Pass: production build and 1 non-loopback HTTP/session-refresh/reopen test. |
| `node tools/docs/sync-generated.mjs --check` | Pass: documentation projections match the catalog. |
| `tools/security/scan-secrets.sh --current` | Pass: Gitleaks 8.30.1, zero findings; config digest `59d1a855b5c804ea83467a98f1c490f612ad55d2b9d5a3b78028d522a7f81d79`. |
| `npx vitest run resume-domain/spec-07-m8-acceptance.test.ts` | Expected red phase failed because this manifest did not yet exist; post-creation rerun passed: 1 file/1 test. |
| `git diff --check` | Pass at initial, post-manifest, and final handoff checkpoints. |
| Docker dev verification | Not run: explicit target/start-state/cleanup authority was absent and the pre-existing stateful project was unhealthy. |
| `npm run resume:conformance` and three-generation/provider conformance | Not run: no accepted provider/model class, explicit synthetic-only call authority, compatible immutable candidate, or retention contract. |
| independent human calibration | Not run: no named resume-quality reviewer, non-technical owner reviewer, accepted rubric/defaults, or retention/deletion contract. |
| native Windows verification | Not run: Docker-first gate did not pass, exact-candidate synchronization was impossible, and explicit authority was absent. |

## Original issue, review decisions, and cleanup

- The pre-fix cosmetic TypeScript-target behavior was not executed from a preserved baseline: no clean preserved worktree or authority to create/synchronize one was available, and disturbing the cumulative worktree would invalidate rather than strengthen the evidence. The current suites directly assert that cosmetic-only or threshold-failing target operations persist a score-free no-change result and create no targeted child; the isolated current TypeScript target journey also completed through the guarded target path. These observations do not substitute for a controlled before/after reproduction.
- Schema/config/migration review found versioned Spec 07 contracts and generated schemas, schema-3 migration and compatibility coverage, content-free audit additions, provisional target-threshold labeling, and paired source/generated-schema changes. Schema drift and migration/lifecycle tests passed. Provider profile/config files, installer packaging, and release workflow files were unchanged.
- No focused product defect was discovered in authorized local verification, so no product fix was made. The only M8 additions are this acceptance record and its focused completeness/sanitization test.
- One combined final-check invocation called the root-relative secret scanner while the shell was still in `builds/typescript`; the focused manifest test passed first, then the scanner path failed with exit 127. The scanner was immediately rerun from the repository root and passed with zero findings. No source or environment intervention was needed.
- The isolated E2E runners stopped their processes and used task-owned temporary roots. Pre-existing Docker containers/volumes and external environments were not changed. No publication, commit, push, provider call, reviewer simulation, or release action occurred.
- Rollback/containment for this milestone is removal of the two M8 report/test files. Product-runtime behavior is unchanged.

Final status inspection reported 87 tracked modifications and 36 untracked status entries, of which this milestone added two source-adjacent files. The tracked `git diff --stat` is `87 files changed, 5197 insertions(+), 342 deletions(-)`; Git does not include the two untracked M8 files in that statistic. Path and scope review found the cumulative changes confined to Resume Builder/package, app contracts/runtime/host, resume domain/inference/renderer, the Resume Builder web E2E/host frame, migration coverage, and the developer catalog. No unrelated top-level feature, future-scope implementation, provider profile, installer/release workflow, or publish change was introduced by M8. The cumulative dirty state still prevents a reviewable release-candidate claim.

## Required follow-up

Release remains blocked until all work is rerun on one clean committed full SHA after:

1. Spec 07, the verification plan, Resume Quality Standard/defaults, OQ-1–OQ-4, and attributable M1–M7 acceptance are approved and versioned.
2. An authorized synthetic provider/model matrix completes three fresh generations per required fixture without lowering gates; only passing evidence may populate compatibility claims.
3. Named independent resume-craft and non-technical owner reviewers complete calibrated, sanitized review under an accepted retention/deletion contract.
4. The owner authorizes a Docker target, starting-state handling, cleanup, and restore contract; Docker dev then passes without compromising pre-existing data.
5. After Docker passes, the owner authorizes exact synchronization of the same immutable candidate to native Windows; build/package, owner journey, Copy/`.txt`/PDF, recovery/lifecycle, and normalized parity then pass.
6. All invalidated local checks, secret/diff/status review, and the matrix are rerun against that exact source/package identity.
