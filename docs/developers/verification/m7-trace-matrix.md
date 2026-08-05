# Milestone 7 acceptance trace matrix

**Status:** Step 8 evidence reconciled; final non-compensating release adjudication remains owned by Step 10.
- SOURCE_TEST_REVISION: `05999a1803809ff3f0a62930e9752df8c86095fa`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 4a750b03b233a2fde3dd9317d39a81b37d2b0ebf74ed830c0b8e7ff882bbe65a; entries 619; revision 05999a1803809ff3f0a62930e9752df8c86095fa`

“Pass” means mapped evidence is present and acceptable for Step 8. It does not authorize merge, tag, signing, publication, production release, or creation of `v1-readiness.md`.

## Evidence anchors

- Platform: [Windows J-05 report](platform-reports/windows-j05.json); Milestone 2 retains scoped WSL native/Docker evidence and the diagnostic-only Tauri failure.
- AI: [harness](ai-agent-harness.md) and [AIH-01](ai-agent-scorecards/aih-01.md) through [AIH-10](ai-agent-scorecards/aih-10.md).
- Human: [REV-01](human-reviews/rev-01.json) through [REV-08](human-reviews/rev-08.json).
- Automation: Milestones [00](milestones/00-repository-truth.md) through [06](milestones/06-validation-integration.md), current validators, projections, scanner, and release checker.
- GitHub: [PR #282](https://github.com/BrainDriveAI/BrainDrive/pull/282), [owner attestation](https://github.com/BrainDriveAI/BrainDrive/pull/282#issuecomment-5190917535), and [exact-source checks](https://github.com/BrainDriveAI/BrainDrive/actions/runs/31000641934).
- Release state: [Milestone 7](milestones/07-release-gauntlet.md) remains a historical blocked attempt until Step 10 reruns it; no tag or publication is claimed.

## User stories

| IDs | Evidence | Step 8 |
|---|---|---|
| US-01 | Front door/catalog, GitHub rendering, REV-01/05/08 | PASS |
| US-02 | J-03/J-04, compatible Windows J-05, macOS-unclaimed decision | PASS |
| US-03 | Contribution/issue/PR contracts, PR #282, Actions, REV-01/05 | PASS |
| US-04 | Request/mode traces, AIH-02/04, REV-02 | PASS |
| US-05 | Resolved maturity policy, AIH-05, REV-03 | PASS |
| US-06 | Security routes/scans, restricted boundary, REV-04 | PASS |
| US-07 | Safe failures, command contracts, REV-02/04 | PASS |
| US-08 | Impact/freshness checks, PR evidence, REV-02/05 | PASS |
| US-09 | Fresh AIH-01 through AIH-10 and REV-07 | PASS |
| US-10 | Branch/no-tag truth and REV-04/06 | PASS |

## Acceptance criteria

| IDs | Evidence | Step 8 |
|---|---|---|
| US-01/AC-01, US-01/AC-02 | Navigation, metadata, direct entry, rendering | PASS |
| US-02/AC-01, US-02/AC-02, US-02/AC-03 | Native/Docker/desktop and safe-failure evidence | PASS |
| US-03/AC-01, US-03/AC-02, US-03/AC-03 | Contribution, routing, PR, Actions, ownership | PASS |
| US-04/AC-01, US-04/AC-02, US-04/AC-03 | Request, bypass, persistence, trust, modes | PASS |
| US-05/AC-01, US-05/AC-02 | Maturity and unsupported-surface escalation | PASS |
| US-06/AC-01, US-06/AC-02 | Private vulnerability route and sanitization | PASS |
| US-07/AC-01, US-07/AC-02 | Debugging and command recovery | PASS |
| US-08/AC-01, US-08/AC-02 | Same-PR impact/freshness | PASS |
| US-09/AC-01, US-09/AC-02, US-09/AC-03 | Fresh AI contexts, binary gates, handoff | PASS |
| US-10/AC-01, US-10/AC-02, US-10/AC-03 | Version domains, no-tag state, restricted boundary | PASS |

## Stable requirements

| IDs | Evidence | Step 8 |
|---|---|---|
| IA-001–IA-007 | DA-01–04/17, rendering, REV-01/05/08 | PASS |
| CAN-001–CAN-008 | Catalog authority, lifecycle, conflict, projections | PASS |
| TEC-001–TEC-015 | Source corpus, baselines, platform report, REV-02/03/04/06 | PASS |
| DEV-001–DEV-008 | Commands/journeys, contribution, Windows, owner acceptance | PASS |
| INT-001–INT-005 | Maturity policy, inventory, safe unsupported routing, REV-03 | PASS |
| GH-001–GH-008 | Rendering, templates, Actions, ruleset, retention, branch/no-tag truth | PASS |
| AGT-001–AGT-010 | Fresh AIH scorecards and REV-07 | PASS |
| GOV-001–GOV-009 | Roles, owner policy, validators, PR/settings, release boundaries | PASS |
| SEC-001–SEC-013 | Scans, provider/auth/destructive/restricted boundaries, REV-04 | PASS |
| EVI-001–EVI-007 | Schemas, milestones, journeys, AIH, eight REV records | PASS |

EVI-002 uses the accepted V1 repository-owner substitution and does not claim independent fresh-contributor evidence.

## Invariants, edges, failures, and security

| IDs | Evidence | Step 8 |
|---|---|---|
| INV-001–INV-004 | Authority, canonical routes, plain source, maturity | PASS |
| INV-005–INV-008 | Secret/scope/command/lifecycle validation | PASS |
| INV-009–INV-010 | Provider independence and mode separation | PASS |
| INV-011–INV-012 | Same-PR/branch/version and explicit no-tag state | PASS |
| INV-013–INV-014 | Conflict-stop and attributable evidence | PASS |
| E-01–E-05 | No-provider, prerequisite, platform, Docker, mode matrices | PASS |
| E-06–E-11 | Legacy/link/mirror/product-agent/command-tier/integration routes | PASS |
| E-12–E-16 | No-tag truth, conflict stop, sanitization, source, anchors | PASS |
| E-17–E-20 | Migration, tier, scope, version-domain checks | PASS |
| F-01–F-07 | Conflict/canonical/link/command/credential/platform/destructive negatives | PASS |
| F-08–F-11 | Redaction/scans/maturity/external-failure classification | PASS |
| F-12–F-16 | Plain source, mirrors, roles, no-tag, release-check fail-closed behavior | PASS |
| SEC-001–SEC-005 | Detection, scope, commands, lifecycle | PASS |
| SEC-006–SEC-009 | Provider independence, auth/mode scope | PASS |
| SEC-010–SEC-013 | Private reporting, restricted release, conflict stop | PASS |

All eight explicit security boundaries pass: public evidence excludes secrets/owner data; auth changes require scope; sensitive provider/release metadata remains protected; Ollama/BYOK remain independent and visible; production/signing remains restricted; vulnerabilities route privately; and destructive operations require target, authority, safeguards, and recovery.

## Journeys

| IDs | Evidence | Step 8 |
|---|---|---|
| J-01–J-02 | Milestone 1, GitHub navigation/rendering, REV-01/05/08 | PASS |
| J-03–J-04 | Scoped WSL native and Docker start-only evidence | PASS within recorded scope |
| J-05 | Compatible native Windows pass; WSL diagnostic retained; macOS unclaimed | PASS for claimed V1 platform |
| J-06–J-07 | No-provider and missing-prerequisite evidence | PASS |
| J-08–J-09 | Contribution, issue/PR, security routing, REV-04/05 | PASS |
| J-10–J-11 | Request/bypass/mode maps and REV-02 | PASS |
| J-12–J-13 | Integration maturity and unsupported-surface route, REV-03 | PASS |
| J-14–J-16 | Private security, safe failure, risky-command tabletop, REV-04/06 | PASS |
| J-17 | Same-PR freshness and hosted diagnostics | PASS |
| J-18–J-19 | Branch/no-tag truth and public/restricted release boundary | PASS; no release claimed |

## AI, human, properties, baselines, and regressions

| IDs | Evidence | Step 8 |
|---|---|---|
| AIH-01–AIH-10 | Ten fresh exact-prompt outputs, scorecards, controller validation | PASS |
| REV-01 | Owner-policy acceptance; independence not claimed | PASS |
| REV-02–REV-08 | Attributable combined-role owner records and PR attestation | PASS |
| P-01–P-14 | DA/property checks, journeys, AIH-09, PR/review evidence | PASS |
| S-01–S-13 | Fixtures, scanner modes, provider/mode matrices, REV-04/06 | PASS |
| B-01–B-08 | Local baselines and exact-source GitHub CI | PASS |
| B-09–B-10 | No browser/mobile behavior change; OPEN-10 remains explicit | NOT APPLICABLE |
| B-11–B-13 | Controlled native, Docker, and Windows desktop journeys | PASS within scope |
| B-14 | Declared integration entrypoint absent; not used as evidence | NOT APPLICABLE |
| B-15–B-16 | Static/tabletop release-helper boundary only | PASS for boundary; not executed |
| R-01–R-12 | Front door, routing, CI, security, provider, lifecycle, authority, release, ignored-data regressions | PASS |

## Totals

| Element | Required | Enumerated | Step 8 pass |
|---|---:|---:|---:|
| User stories | 10 | 10 | 10 |
| Acceptance criteria | 25 | 25 | 25 |
| Stable requirements | 90 | 90 | 90 |
| Invariants | 14 | 14 | 14 |
| Edge cases | 20 | 20 | 20 |
| Failure modes | 16 | 16 | 16 |
| Security requirements | 13 | 13 | 13 |
| Explicit security boundaries | 8 | 8 | 8 |
| Journeys | 19 | 19 | 19 |
| AIH scenarios | 10 | 10 | 10 |
| Human review roles | 8 | 8 | 8 |

No element is unmapped. Remaining risks are explicit: four embedded Windows services required termination; macOS is configured but unclaimed; default-branch search activation is post-merge; B-09/B-10 and B-14 are not evidence; B-15/B-16 remain tabletop; and no merge, tag, signing, publication, production release, or final readiness decision is authorized.
