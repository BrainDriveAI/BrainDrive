# Spec 07 quality-gate correction Milestone 7 acceptance record

Recorded: 2026-08-12

Disposition: **HOLD — not release-ready**

This is the sanitized requirement-to-evidence record for the accepted Spec 07 quality-gate correction. Local automated evidence passed, but it was collected from a dirty working tree rather than one clean immutable implementation candidate. Provider/model runs, named human calibration, controlled retention/deletion, Docker dev, and native Windows were not authorized. No local result or aggregate score overrides those blockers.

## Candidate, authority, and revision binding

- Branch: `feature/resume-builder-app`.
- Repository HEAD: `5c0a49e3d97353312b4f758b97115209338e0c1a`.
- Source candidate revision: **UNAVAILABLE**. HEAD predates the quality-gate correction and the cumulative Milestones 1–6 implementation remained in the working tree.
- Evidence revision: **UNAVAILABLE**. Evidence cannot carry forward until a clean immutable source revision exists.
- Candidate state before this record: 102 dirty entries. The implementation was not committed, stashed, reset, or otherwise displaced because no commit authority was supplied and unrelated accepted work had to be preserved.
- Candidate state after this record: 104 dirty entries: 93 tracked files changed and 11 non-ignored untracked files. The tracked diff is 6,835 insertions and 1,777 deletions; untracked-file contents are not included in that Git diff statistic.
- Revision rule: a future source candidate must be a clean commit containing the exact implementation, generated schemas, fixtures, tests, and canonical documentation. Any later product/source/configuration/schema/migration/provider change invalidates source-bound evidence. Only declared evidence-only outputs may carry forward to a later evidence revision under the repository evidence-identity rules.
- Authority present: accepted corrective addendum and accepted verification plan, including explicit fail-closed dispositions for `RB7-OQ-1` through `RB7-OQ-4`.
- Authority absent: provider/model classes and credentials, named reviewer identities and calibration, raw-artifact retention/deletion, Docker target/start/cleanup/restore, synchronized native Windows execution, real owner data, external publication, and release action.

The local environment was WSL2 Linux x86_64 with Node `v20.20.1`, npm `10.8.2`, and Rust/Cargo `1.95.0`. Docker and Docker Compose were unavailable in this WSL distro at final verification. Repository CI specifies Node 22, so the Node-version difference remains a release risk. Linux/WSL desktop checks are not native Windows evidence.

## Evidence groups

| Group | Local evidence |
|---|---|
| `CONTRACT` | Fourteen focused contract, canonicalization, frozen-oracle, repair, quality-state, migration, Career, and gateway files passed 111 tests. |
| `PACKAGE` | Resume Builder passed 5 files/39 tests and its TypeScript build. |
| `RUNTIME` | Runtime lint passed; 104 files/826 tests passed; TypeScript build passed. |
| `QUALITY` | Credential-free quality harness passed 15 fixtures, 12/12 mutations, 0/2 clean blockers, seven personas, corrective corpus bindings, and anti-overfit checks; `release_ready=false`. |
| `WEB` | Web lint/typecheck passed; 26 files/235 tests passed; production build passed with existing font-resolution and large-chunk warnings. |
| `DESKTOP` | Desktop preflight passed; repeated runtime 103 files/825 tests, web 26 files/235 tests, MCP build, and Rust 55 passed/1 ignored on WSL/Linux. |
| `MCP` | MCP release package passed 2 files/6 tests and its TypeScript build. |
| `E2E` | Isolated mobile run passed 12 with 10 project skips; isolated desktop run passed 5 with 6 project skips; non-loopback browser-access run passed 1. |
| `DOCS` | Documentation verification passed 163 tests with 1 expected platform skip and 255 scoped candidates with zero diagnostics. |
| `SECURITY` | Current-tree secret scan and prohibited-content checks passed; no provider profile or credential configuration change was found. |

## Functional requirement matrix

| Requirement | Evidence | Disposition |
|---|---|---|
| RB7-QGC-REQ-001 | `CONTRACT`, `QUALITY` mandatory C1–C3/T1–T3 precedence | Local automated pass |
| RB7-QGC-REQ-002 | Strict report-v2 completeness and malformed/duplicate rejection | Local automated pass |
| RB7-QGC-REQ-003 | Positive, negative, absence, statement, anchor, strategy, and target references | Local automated pass |
| RB7-QGC-REQ-004 | Proxy-only negatives and score-free deterministic controls | Local automated pass; human calibration blocked |
| RB7-QGC-REQ-005 | Domain/UI/API/persistence/Career/journal parity tests | Local automated pass |
| RB7-QGC-REQ-006 | Generator/evaluator separation and fail-closed disagreement | Local automated pass; provider/human independence blocked |
| RB7-QGC-REQ-007 | Frozen manifest and synthetic workflow-only boundary | Local automated pass |
| RB7-QGC-REQ-008 | Canonicalization and all 120 fact permutations | Local automated pass |
| RB7-QGC-REQ-009 | Direction cannot establish title, seniority, leadership, or experience | Local automated pass |
| RB7-QGC-REQ-010 | One current ranked evidence opportunity with explicit dispositions | Local automated pass |
| RB7-QGC-REQ-011 | Statement/correction/support scope and overbroad-repair rejection | Local automated pass |
| RB7-QGC-REQ-012 | Fresh truth, structure, mechanical, anchor, artifact, and craft validation | Local automated pass |
| RB7-QGC-REQ-013 | `evidence_limited` remains non-passing under accepted OQ-1 disposition | Local automated pass; final product policy remains blocked |
| RB7-QGC-REQ-014 | Prior approved definition survives correction/publication failure | Local automated pass |
| RB7-QGC-REQ-015 | Frozen C1 fail, C2 fail, C3 pass, no passing label | Local automated pass |
| RB7-QGC-REQ-016 | Frozen/mutation negatives and three clean positive controls | Local deterministic pass; human judgment blocked |
| RB7-QGC-REQ-017 | Harness requires three fresh operations and forbids best-of-three | **Blocked: no authorized provider/model matrix** |
| RB7-QGC-REQ-018 | Reviewer contract fails closed on missing/disputed review | **Blocked: no named authorized reviewers/calibration** |
| RB7-QGC-REQ-019 | Product records and corpus are digest/lineage bound | Local automated pass; immutable source/evidence revisions unavailable |
| RB7-QGC-REQ-020 | Sanitized audits/reports and prohibited-content scans | Local automated pass; controlled-artifact retention blocked |

## UX, data, recovery, security, non-goal, and invariant matrix

| Requirement | Evidence and disposition |
|---|---|
| RB7-QGC-UX-001 | Local pass: scope-specific status copy replaces broad independent-review copy. |
| RB7-QGC-UX-002 | Local pass: blocking findings precede score-free guidance. |
| RB7-QGC-UX-003 | Local pass: neutral evidence-limited copy has no pressure or outcome promise. |
| RB7-QGC-UX-004 | Local pass: evidence, repair, approval, keep-prior, and exit actions remain distinct. |
| RB7-QGC-UX-005 | Automated keyboard/focus/mobile/zoom/reduced-motion/dark-mode checks pass; manual screen-reader and native Windows review remain blocked. |
| RB7-QGC-DATA-001 | Local pass: strict synthetic frozen manifest is versioned, digest-bound, and product-isolated. |
| RB7-QGC-DATA-002 | Local pass: canonical history, priorities, omissions, gaps, and section order are enumeration-independent. |
| RB7-QGC-DATA-003 | Local pass: report v2 is complete, evidence-cited, evaluator-scoped, score-free, and definition-bound. |
| RB7-QGC-DATA-004 | Local pass: correction records contain one exact correction class and scope. |
| RB7-QGC-DATA-005 | Local pass for sanitized deterministic report; controlled run report and immutable revision binding blocked. |
| RB7-QGC-DATA-006 | Local pass: Career carries exact approved identity and narrow metadata without changing resume content. |
| RB7-QGC-REC-001 | Local pass: insufficient C1/C2 evidence cannot pass and yields one bounded action. |
| RB7-QGC-REC-002 | Local pass: missing/malformed criterion evidence fails closed and is retryable. |
| RB7-QGC-REC-003 | Local pass: mandatory evaluator disagreement cannot aggregate-pass. |
| RB7-QGC-REC-004 | Local pass: order drift fails canonical regression evidence. |
| RB7-QGC-REC-005 | Local pass: unsupported or unflagged repair changes are rejected. |
| RB7-QGC-REC-006 | Local pass: unavailable/incompatible provider creates no quality claim; controlled provider run blocked. |
| RB7-QGC-REC-007 | Correctly blocked: absent human calibration keeps release evidence non-passing. |
| RB7-QGC-REC-008 | Local pass: publication failure preserves approval/state and exact retry input. |
| RB7-QGC-REC-009 | Local pass: artifact parity failure blocks publication/export and preserves recovery. |
| RB7-QGC-SEC-001 | Local pass: credentials remain in vault/broker boundaries; controlled provider inspection blocked. |
| RB7-QGC-SEC-002 | Local pass: model output remains untrusted through strict deterministic/criterion validation. |
| RB7-QGC-SEC-003 | Local pass: logs and durable reports exclude content, prompts, bodies, credentials, transcripts, and paths. |
| RB7-QGC-SEC-004 | Local pass: synthetic fixtures are outside product prompts/branches. |
| RB7-QGC-SEC-005 | **Blocked: no accepted raw-review retention/deletion authority or controlled artifacts.** |
| RB7-QGC-SEC-006 | Local pass: failures preserve prior approved content and reject partial/different publication. |
| RB7-QGC-SEC-007 | Local diff review pass: Ollama/BYOK remain independent; no BrainDrive-owned key or provider profile change. |
| RB7-QGC-NG-001 | Local pass: no C1/C2/C3 weakening. |
| RB7-QGC-NG-002 | Local pass: no padding, invented scope, leadership, title, or metric. |
| RB7-QGC-NG-003 | Local pass: aspiration remains non-evidence. |
| RB7-QGC-NG-004 | Local pass: fixtures, self-check, approval, and aggregates are not labeled independent review. |
| RB7-QGC-NG-005 | Local contract pass; controlled three-run proof remains blocked and no best-of-three claim exists. |
| RB7-QGC-NG-006 | Local pass: unresolved policies remain explicit blockers. |
| RB7-QGC-NG-007 | Local pass: failed correction/publication preserves prior approved content. |
| RB7-QGC-INV-001 | Local pass: truth, support, title, scope, metric, and target-injection negatives fail closed. |
| RB7-QGC-INV-002 | Local pass: failed/incomplete/disputed/stale/unauthorized criteria never show pass. |
| RB7-QGC-INV-003 | Local pass: workflow, product review, owner approval, human review, and release remain separate. |
| RB7-QGC-INV-004 | Local pass: equivalent semantic inputs produce identical strategy and section order. |
| RB7-QGC-INV-005 | Local deterministic bounds pass; three fresh authorized generations blocked. |
| RB7-QGC-INV-006 | Local pass: correction never mutates approved history. |
| RB7-QGC-INV-007 | Local pass: evaluator/repairer/fixture acquire no provider/filesystem/approval/publication/human authority. |
| RB7-QGC-INV-008 | Local pass: artifacts and Career preserve the approved logical definition. |
| RB7-QGC-INV-009 | Local pass: aggregate evidence cannot override a mandatory failure. |
| RB7-QGC-INV-010 | Local pass: missing decisions remain visibly blocked. |

## Story matrix

| Story | Disposition |
|---|---|
| QGC-US-1 | Local automated pass: status is honest and owner approval remains separate. |
| QGC-US-2 | Local automated pass: findings cite exact evidence/absence and expose one bounded next action. |
| QGC-US-3 | Canonical reproducibility passes locally; authorized fresh-generation variation remains blocked. |
| QGC-US-4 | Local automated/browser pass: exact approved Career content and narrow status survive publication/history/reopen. |

## Release gates

| Gate | Disposition | Evidence or blocker |
|---|---|---|
| RB7-QGC-G1 | PASS | Accepted addendum/verification plan and attributable OQ dispositions are present. |
| RB7-QGC-G2 | PASS (local) | Frozen C1/C2 non-pass, C3 pass, and no passing copy reproduced. |
| RB7-QGC-G3 | PASS (local) | Canonical digest and 120-permutation strategy suite passed. |
| RB7-QGC-G4 | PASS (local) | Bounded repair/evidence action, full revalidation, retry, stale, and prior-version tests passed. |
| RB7-QGC-G5 | PASS (deterministic) | Clean controls pass without padding or forced metrics; human confirmation remains unavailable. |
| RB7-QGC-G6 | PASS (local) | UI/API/store/artifact/Career/journal/history parity and isolated journeys passed. |
| RB7-QGC-G7 | BLOCKED | No authorized provider/model classes or three fresh operations per fixture. |
| RB7-QGC-G8 | BLOCKED | No named authorized resume-quality/non-technical reviewers or calibration evidence. |
| RB7-QGC-G9 | PARTIAL | Local authorization, sanitization, fixture-isolation, secret scan, and provider-safety checks pass; retention and controlled-runtime evidence are blocked. |
| RB7-QGC-G10 | BLOCKED | No clean immutable candidate, Docker contract/run, or native Windows run; Node 22 parity is also unproven. |

Because G7, G8, G9, and G10 are not passing, the final disposition is HOLD regardless of the local automated results.

## Exact command results

| Command | Result |
|---|---|
| `cd builds/resume_builder && npm run test && npm run build` | Pass: 5 files/39 tests; TypeScript build pass. |
| `cd builds/typescript && npm run lint && npm run test && npm run build` | Pass after adding this record's contract: lint; 104 files/826 tests; TypeScript build. |
| `cd builds/typescript && npm run resume:quality` | Pass in credential-free scope; 15 fixtures; 12/12 mutations; 0/2 clean blockers; `release_ready=false`; report digest `sha256:f9f7da3413ab530a5bac8385c0dc459da32e06ded61827fed633d1de7788021e`. |
| `cd builds/typescript && npm run web:lint && npm run web:typecheck && npm run web:test && npm run web:build` | Pass: lint/typecheck; 26 files/235 tests; production build with font and chunk-size warnings. |
| `cd builds/typescript && npm run docs:verify` | Pass after the acceptance/catalog update: 163 passed/1 expected platform skip; 255 candidates; zero diagnostics. |
| `cd builds/typescript && npm run desktop:preflight && npm run desktop:test` | Pass on WSL/Linux: runtime 103 files/825 tests; web 26 files/235 tests; Rust 55 passed/1 ignored. Not native Windows evidence. |
| `cd builds/mcp_release && npm run test && npm run build` | Pass: 2 files/6 tests; TypeScript build. |
| `cd builds/typescript/client_web && npm run test:e2e` | Pass: mobile 12 passed/10 skips; desktop 5 passed/6 skips; isolated task roots cleaned. |
| `cd builds/typescript/client_web && npm run test:e2e:browser-access` | Pass: production build and 1 non-loopback HTTP/session-refresh/reopen test. |
| focused corrective integration suite | Pass: 14 files/111 tests. |
| `cd builds/typescript && npx vitest run resume-domain/spec-07-qgc-m7-acceptance.test.ts` | Pass: 1 file/1 test; every corrective requirement, story, invariant, and gate ID is represented and the record remains fail-closed. |
| `cd builds/typescript && npm run contracts:schemas` | Pass; generated contract schemas remain synchronized with their TypeScript sources. |
| `node tools/docs/sync-generated.mjs --check` | Pass after the acceptance/catalog update. |
| `tools/security/scan-secrets.sh --current` | Pass with zero findings after the acceptance/catalog update. |
| `git diff --check` | Pass after the acceptance/catalog update. |
| `git status --short --branch` | Dirty by design; cumulative accepted implementation plus this M7 evidence remains uncommitted. |
| `./installer/docker/scripts/start.sh dev` | Not run: exact target, starting-state, cleanup/restore, and mutation authority absent. |
| `BRAINDRIVE_RESUME_CONFORMANCE=1 npm run resume:conformance` | Not run: provider/model classes, credentials, retention, and controlled-call authority absent. |
| accepted human-review ingestion | Not run: named reviewers, calibration, rubric attribution, and retention/deletion authority absent. |
| native Windows verification | Not run: no synchronized exact immutable candidate or native-platform authority. |

## Design, schema, migration, provider, and scope review

- Product behavior was not changed during M7. The new acceptance record, its focused contract test, its catalog declarations, and the source-adjacent README link are evidence/documentation only.
- Contract/source/generated-schema pairing is present and schema drift checks passed. Schema 4 remains current; historical schema-3 bytes stay unchanged and derive `pre_correction_review`; new report/approval evidence uses v2.
- Migration tests cover empty/current roots, 3→4, every injected fault/restart boundary, response loss, duplicate/equivalent retry, mismatched operation, corruption/newer schema, export/import/backup/restore, and downgrade refusal.
- Configuration and provider review found no changes below `builds/typescript/adapters/`, no new provider key/configuration, no removal of Ollama or BYOK OpenRouter, and no coupling to BrainDrive Models credits.
- Installer, Docker compose, release workflow, provider profiles, and secret files were not changed. Controlled services and external environments were not mutated.
- The cumulative implementation diff is confined to the accepted Resume Builder correction surfaces plus existing documentation mappings; no future product scope was added by M7.

## Interventions, cleanup, limitations, and follow-up

- Isolated Playwright runners created synthetic task-owned roots and processes, then stopped services and removed their temporary roots. Desktop preparation created only the existing ignored development resource/output surfaces. No owner data, credentials, provider calls, Docker state, human transcript, external publication, or release target was used.
- One combined evidence-validation invocation used repository-root-prefixed paths while already running from `builds/typescript`; its initial file-existence check exited 1 before any test ran. The command was rerun with the correct working-directory-relative paths, and the focused acceptance test passed 1/1. No source or external state changed because of the invocation error.
- The original pre-correction executable was not reconstructed because no preserved clean pre-fix worktree or authority to alter the cumulative working tree existed. The retained frozen manifest is the accepted normalized oracle; the current focused test reproduces C1 fail, C2 fail, C3 pass and forbids passing copy. This is a deviation from an executable before/after replay and remains recorded as such.
- A clean commit containing Milestones 1–7 is required before any source-candidate proof. After that, every automated gate must be rerun on that exact revision, followed by separately authorized Docker, provider, human, retention/deletion, Node 22, and native Windows evidence. Any failure or missing authority keeps HOLD.

M7 evidence changes: 4 files added/updated. The cumulative working tree remains intentionally dirty and no commit, stash, reset, push, release, or destructive cleanup was performed.
