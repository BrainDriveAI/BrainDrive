# Spec 06 Milestone 8 acceptance record

Recorded: 2026-08-11
Disposition: **HOLD — not release-ready**

This is the sanitized, source-adjacent requirement-to-evidence manifest for Spec 06. It records independently rerun local evidence and names every mandatory gate that remains blocked. It does not reuse the Specs 1–5 acceptance manifest as proof, treat a dirty worktree as an immutable release candidate, or substitute WSL/browser evidence for Docker or native Windows.

## Candidate and environment

- Branch: `feature/resume-builder-app`
- Base revision: `519497957259439127f401c8a962544a537ebeb6`
- Candidate state: cumulative M1–M8 worktree; not committed or immutable
- Source platform: WSL2 Linux x86_64, kernel `6.6.87.2-microsoft-standard-WSL2`
- Node/npm: `v20.20.1` / `10.8.2` (repository CI and documentation use Node 22)
- Rust/Cargo: `1.95.0` / `1.95.0`
- Docker/Compose inspected versions: `29.2.0` / `v5.0.2`
- Resume Builder installed fixture: `4.0.0`; package source workspace: `0.0.0-milestone-7`
- Observed fixture digest in isolated acceptance: `sha256:93a882c0ba132dd24810e41a48381b9d35b752f19047fd028c8eaa7f39c08ce5`

The pre-existing `braindrive_dev` Compose project was already running with its app container unhealthy and its web container running. Its compose file uses fixed project/volume identities and a default owner-memory bind. No Docker mutation was authorized or performed. The Windows checkout at `C:\Users\DJJones\Projects\BrainDrive` remained on branch `agent/developer-documentation-system` at `da55c793f4ba3576cde68adbbec511b81eaa827c`; it was not synchronized or intentionally modified. Final inspection from WSL Git reported 481 line-ending-only changes (`--ignore-space-at-eol --ignore-cr-at-eol` produced no semantic diff), so its native cleanliness is unresolved and cannot support exact-candidate evidence.

## Evidence groups

| Group | Integrated evidence |
|---|---|
| REC | `resume-domain/{service,resume-data-store,capabilities}.test.ts`; exact-slot save/restore/discard, CAS, duplicate/retry, response loss, before/after-switch cancellation, partial transaction cleanup, restart reconciliation; isolated desktop reload/reopen and non-loopback token-expiry recovery |
| JOB | `resume-domain/resume-data-m3.test.ts`, package workflow/UI tests, and desktop/mobile E2E; per-job identity, known evidence, all six dimensions, skip/unknown/N/A/back/pause/complete, correction/removal, and durable visible-turn provenance |
| UPDATE | `resume-domain/resume-data-m4.test.ts`, `definition-comparison.test.ts`, capability tests, and desktop/mobile E2E; remembered matching, immutable successor, exact impact, stale variants, comparison, retry/concurrency, and non-mutation |
| REV | `resume-domain/service.test.ts`, `resume-inference/{broker,validators,repair}.test.ts`, and desktop E2E; presentation/factual/mixed/ambiguous routing, confirmation, bounded regeneration, failure/cancel/repair, owner outcomes, separate approval, and lineage |
| TEXT | `resume-renderer/renderer.test.ts`, web browser-policy/frame tests, Rust native-export tests, and desktop E2E; deterministic clean text, PDF failure, Copy failure/success, `.txt`/PDF validation, cancellation, response-loss reconciliation, and exact clipboard bytes |
| GUIDE | guidance schema/runtime/broker tests and desktop E2E; evidence-cited closed categories, fallback, optional questions, forbidden score/prediction/guarantee language, and read-only behavior |
| QUALITY | `resume-inference/quality.test.ts`, the deterministic quality harness, renderer/Career rechecks, and M7 normalized adapter test; 15 fixtures, 12/12 caught mutations, 0/2 clean blockers, seven personas, F9 successor no-regression, and 38-file anti-overfit scan |
| LIFE | schema-2 migration, persistence, lifecycle, app-lifecycle, store, capability, and M7 normalized-adapter tests; interruption/restart, downgrade refusal, disable/update/rollback/uninstall/reinstall, retained data, old-authority denial, and content-free diagnostics |
| LIVE | isolated desktop/mobile/non-loopback browser journeys passed. Docker dev, live provider generations, calibrated human review, and synchronized native Windows remain blocked as described below. |

## Requirement-to-evidence matrix

“Automated pass” means the applicable deterministic/integration/E2E evidence passed on the worktree. It is not a release pass where the row also requires blocked LIVE or human evidence.

| Requirement | Evidence | M8 status |
|---|---|---|
| RB6-REQ-001 | REC, LIFE | Automated pass; Docker process/container restart and native Windows resume remain blocked |
| RB6-REQ-002 | REC, security scan | Automated pass |
| RB6-REQ-003 | REC, package UI tests | Automated pass |
| RB6-REQ-004 | REC, desktop E2E | Automated pass |
| RB6-REQ-005 | JOB, QUALITY | Automated pass; calibrated craft review pending |
| RB6-REQ-006 | JOB, capability authorization | Automated pass |
| RB6-REQ-007 | JOB, desktop/mobile E2E | Automated pass |
| RB6-REQ-008 | JOB, REC, desktop/mobile E2E | Automated pass |
| RB6-REQ-009 | UPDATE, desktop E2E | Automated pass |
| RB6-REQ-010 | UPDATE, quality-gated approval | Automated pass |
| RB6-REQ-011 | UPDATE, desktop E2E | Automated pass |
| RB6-REQ-012 | UPDATE, desktop/mobile E2E | Automated pass |
| RB6-REQ-013 | UPDATE, component accessibility assertions, mobile 200% zoom | Automated pass; manual screen-reader review pending |
| RB6-REQ-014 | REV, desktop E2E | Automated pass |
| RB6-REQ-015 | REV | Automated pass; authorized provider conformance pending |
| RB6-REQ-016 | REV, owner-decision/capability denial tests, desktop E2E | Automated pass |
| RB6-REQ-017 | REV, LIFE, privacy/canary scans | Automated pass |
| RB6-REQ-018 | TEXT, QUALITY | Automated pass |
| RB6-REQ-019 | TEXT, desktop E2E | Automated pass; native Windows chooser parity pending |
| RB6-REQ-020 | GUIDE, snapshot/broker tests | Automated pass |
| RB6-REQ-021 | GUIDE, QUALITY | Automated pass; calibrated human classification review pending |
| RB6-REQ-022 | GUIDE, QUALITY | Automated pass; non-technical human review pending |
| RB6-REQ-023 | GUIDE, forbidden-surface tests, desktop E2E | Automated pass |
| RB6-REQ-024 | Career publication tests, UPDATE, desktop E2E | Automated pass |
| RB6-REQ-025 | JOB, QUALITY | Deterministic pass; three-generation and human craft evidence pending |
| RB6-REQ-026 | JOB, QUALITY | Deterministic pass; three-generation and human craft evidence pending |
| RB6-REQ-027 | JOB, REV, QUALITY | Deterministic pass; three-generation and human craft evidence pending |
| RB6-REQ-028 | REV, QUALITY | Deterministic pass; three-generation and human craft evidence pending |
| RB6-REQ-029 | QUALITY persona matrix | Deterministic pass; human craft evidence pending |
| RB6-REQ-030 | QUALITY, GUIDE | Deterministic pass; calibrated human craft evidence pending |
| RB6-REQ-031 | GUIDE, REV, artifact comparison | Automated pass; human tone review pending |
| RB6-REQ-032 | TEXT, independent clean-text extractor, Unicode browser E2E | Automated pass; native Windows parity pending |
| RB6-REQ-033 | QUALITY binding in approval/render/export/Career and successor tests | Deterministic pass; authorized generation and human gates pending |

## Story matrix

| Story | Integrated evidence | M8 status |
|---|---|---|
| US-1 | REC and desktop/non-loopback reload/reopen | Automated pass; Docker restart and native Windows pending |
| US-2 | JOB and desktop/mobile journey | Automated pass; calibrated output review pending |
| US-3 | UPDATE remembered-detail/correction/duplicate/stale-variant journey | Automated pass |
| US-4 | UPDATE accessible exact comparison and 200% mobile zoom | Automated pass; manual screen-reader review pending |
| US-5 | REV presentation, ambiguous, factual, rejection, and separate approval journey | Automated pass; live provider conformance pending |
| US-6 | TEXT clean preview, exact Copy, `.txt`, PDF, and failure recovery | Browser automated pass; native Windows pending |
| US-7 | GUIDE and QUALITY guidance/Career freshness journey | Deterministic pass; human guidance/craft review pending |

## Release gates

| Gate | Disposition | Evidence or blocker |
|---|---|---|
| RB6-G1 | Blocked | Governing Spec 06/test plan/quality revision are accepted, but an immutable candidate and attributable M2–M7 acceptance records are not present in this worktree |
| RB6-G2 | Partial | REC passes; required Docker restart and native Windows recovery are unrun |
| RB6-G3 | Pass (local) | Draft separation, prohibited projection, content-free diagnostics, and zero secret findings pass |
| RB6-G4 | Partial | JOB passes deterministic/E2E checks; required calibrated craft review remains |
| RB6-G5 | Pass (local) | Immutable successor, impact, stale variants, exact accessible compare, and non-mutation pass |
| RB6-G6 | Partial | All routes and owner controls pass locally; live provider conformance remains |
| RB6-G7 | Partial | Browser clean-text/Copy/`.txt`/PDF and failures pass; native chooser parity remains |
| RB6-G8 | Partial | Deterministic and fallback guidance pass; human trust/tone review remains |
| RB6-G9 | Blocked | Deterministic harness passes, but authorized three-generation Tier 1/Tier 3 and independent human calibration are absent |
| RB6-G10 | Partial | Authorization/security/redaction tests and Gitleaks pass; Docker/native live authority checks remain |
| RB6-G11 | Blocked | Docker dev was not authorized; Windows is a different revision and cannot run before Docker approval/exact synchronization |
| RB6-G12 | Blocked | Local baselines and this manifest pass, but the candidate is dirty/non-immutable and mandatory live/human evidence is incomplete |

## Exact command results

| Command | Result |
|---|---|
| `cd builds/resume_builder && npm run test && npm run build` | Pass: 4 files/29 tests; TypeScript build pass |
| `cd builds/typescript && npm run lint && npm run test && npm run build` | Pass: lint; 86 files/693 tests; TypeScript build |
| `npm run resume:quality` | Scoped deterministic pass; digest `sha256:13340611d4da975e6d510859d8d8c3e830b50212e096b68048cb1720d307c069`; `release_ready=false` |
| `npm run resume:conformance` | Not run: live calls require explicit `BRAINDRIVE_RESUME_CONFORMANCE=1` authority, a selected synthetic provider target, and task-owned memory |
| `npm run web:lint && npm run web:typecheck && npm run web:test && npm run web:build` | Pass: lint/typecheck; 26 files/233 tests; production build |
| `npm run desktop:preflight && npm run desktop:test` | Pass: preflight; runtime 85 files/692 tests; web 26 files/233 tests; Rust 55 passed/1 ignored |
| `npm run docs:verify` | Pass: 163 passed/1 platform skip; 252 scoped candidates; zero diagnostics |
| `cd builds/mcp_release && npm run test && npm run build` | Pass: 2 files/6 tests; TypeScript build |
| isolated desktop Resume Builder E2E | Initial Copy permission failure reproduced; after explicit synthetic permission modeling, pass: 1 passed/1 expected mobile skip with exact clipboard-byte assertion |
| `npm run test:e2e:mobile` | Pass: 12 passed/10 expected project skips |
| `npm run test:e2e:browser-access` | Pass: 1 non-loopback HTTP test; build pass |
| `node tools/docs/sync-generated.mjs --check` | Pass: catalog projections match |
| `tools/security/scan-secrets.sh --current` | Pass: Gitleaks 8.30.1, zero findings; config digest `59d1a855b5c804ea83467a98f1c490f612ad55d2b9d5a3b78028d522a7f81d79` |
| `git diff --check` | Pass at local verification checkpoints; rerun at handoff |
| Docker `start.sh dev` / `stop.sh dev` | Not run: explicit state-mutation authority absent and the fixed project was pre-existing/stateful |
| native Windows build/preflight/test | Not run: Docker-first gate, exact-revision synchronization, and Windows authority absent |

## Required follow-up

Release remains blocked until all of the following occur on one clean immutable candidate:

1. The owner authorizes a Docker target and cleanup contract that preserves or restores the pre-existing Compose state and volumes; Docker dev and the full synthetic journey then pass.
2. The owner authorizes exact synchronization of the Windows checkout after Docker passes; native Windows build, packaged journey, Copy/`.txt`/PDF, retained lifecycle, and normalized parity pass.
3. The owner selects and authorizes a configured provider for synthetic-only conformance and three-generation evidence. The compatibility registry must be populated only from passing evidence.
4. A named independent quality reviewer completes Tier-3 calibration plus guidance/craft/accessibility review on sanitized synthetic artifacts.
5. M2–M7 acceptance is attributable, the resulting source candidate is committed/clean, and all affected checks are rerun against its full SHA.
