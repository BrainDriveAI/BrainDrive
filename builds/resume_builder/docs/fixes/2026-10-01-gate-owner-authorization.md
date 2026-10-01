# Missing-essentials gate: owner authorization (CF-3)

Internal, non-authoritative fix evidence for `fix/rb-gate-owner-authorization`, based on `2756b32` on `feature/internet-search-capability`. This records implementation and local verification, not Candidate 14 qualification or live acceptance.

## Defect and evidence

Candidate 13 diagnostic `e6e10-slice/REPORT.md`, E-6 A10: on a plain “make a resume” request with six visible Profile gaps, the assistant called `app_action_resume_create` with `missing_essential_disposition=proceed_with_limitations`. Resume revision 4 was created without an owner gate choice or Proceed click. The UI gate existed, but the model supplied its own disposition and the host treated the render descriptor's confirmation label as owner confirmation.

## Spec check

Step 1 verdict: the accepted authority clearly reserves the incomplete-Profile decision to the owner. No spec-gap stop is required. Authority was read from `/Users/davidwaring/BrainDrive-Library/accepted/docs`, using these paths relative to that checkout:

- `docs/apps/resume-builder/resume-builder-spec.md`
- `docs/apps/resume-builder/evaluation/resume-builder-evaluation-plan.md`
- `docs/platform/host-chat/host-chat-spec.md`
- `docs/platform/app-platform/braindrive-app-host-spec.md`

Exact quotations:

Resume Builder, Functional Requirements:

> - [ ] Before rendering marked gaps or missing essentials, name them and let the owner continue with an honest partial resume or return to editing. Essentials are contact information and at least one experience entry; the check uses gap markers and required-section presence, not a readiness score.

Resume Builder, Critical Failure Behavior:

> | Invalid or incomplete Profile | Name the missing item. Let the owner edit the Profile, return to chat, or knowingly create an honest partial render. |

Resume Builder, AC-10.1–10.2:

> - **AC-10.1** — Given an editable Resume Profile exists, when the owner chooses Create Resume, the app creates a distinct formatted Resume from the current Profile.
> - **AC-10.2** — No additional model call occurs, and the Profile remains unchanged.

Evaluation plan, CF-3 (full row):

> | CF-3 | Invalid/incomplete Profile → name the missing item; owner may edit, return, or knowingly render partial | Deterministic incomplete-Profile gate: confirmation names exact items and offers the three choices — E-9 (P1, P5). (The "no readiness score in code" inspection is a Build Gate candidate, recorded here as supporting evidence only.) | ui | confirmation screenshot | G2 | Yes | Covered |

App Host, APP-6.1 and APP-6.5:

> - **APP-6.1** — Given an app workspace with host-executed controls, when the owner triggers one and it completes, then a host-origin message naming the control and its outcome is appended to that conversation's record before the owner's next turn, and the model's next reply is consistent with it. *Pass bar:* across the evaluation's post-action state-question set, zero replies state that the artifact or result does not exist.
> - **APP-6.5** — Given a host message, then it is informational only. It grants the model no new action; the model never triggers Export or Create (Library D373) and that rule is unchanged.

Host Chat, CHAT-3.1 (inherited preservation/recovery boundary):

```text
- **CHAT-3.1** — Given saved conversation or workspace documents, when a model, rendering, or export failure occurs, then that work remains available, the owner receives an understandable next action, and the conversation is not replaced by a hard-failure screen. *Pass bar:* a judge qualified under [Judge Qualification](host-chat-judge-qualification.md) scores owner clarity and control ≥4/5 on each induced-failure run, against the rubric the consumer's evaluation plan pins.

```

The original CHAT-3.1 link target is `host-chat-judge-qualification.md` in the accepted Host Chat directory; the wording is otherwise verbatim. APP/CHAT quotes supply related host boundaries, not claims that this focused CF-3 fix qualifies all those rows.

Repository governing context: `AGENTS.md`, `docs/AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json` (`installed-apps` task route and `installed-app-platform-change` change route), `docs/developers/integrations/installed-apps.md`, `docs/developers/verification.md`, `builds/typescript/app-platform/mcp-host/README.md`, `builds/typescript/app-inference/README.md`, and `builds/resume_builder/README.md`.

## Design and shipped path

A limitations disposition is input, not authorization. The packaged planner now requires both `owner_confirmed: true` and the exact `proceed_with_limitations` disposition when missing essentials or visible gaps exist. Otherwise it writes only the named-gap action result: no Resume definition or Resume document write, and no Profile write.

Model render tools carry `ownerConfirmed: false`; the Resume host adapter also forces that value on the model callback before action planning. This uses the generic descriptor kind, not a host-side Resume action-ID policy branch. The disposition remains in the shared action schema for the owner UI, but is neutralized for model calls by the independently constructed host confirmation flag. Model tool input cannot set that flag. Existing Create resume and Proceed with limitations buttons use the authenticated owner action endpoint with explicit confirmation and continue to work. Chat gate results name the gaps; instructions direct the owner to choose through Create resume. This change does not implement natural-language owner confirmation, change complete-Profile rendering, or qualify the broader Export/Create tool-exposure policy.

`builds/typescript/app-platform/lifecycle/fixture-repository.ts` loads `builds/resume_builder/resources/inference-program.js`, packages it as `payload/docker/inference-program.js`, and generates the runtime entrypoint that calls `planResumeAction`. That shipped resource is changed directly; `src/chat-workspace.ts` is kept consistent. The regression imports the resource directly, and the host proof installs the signed fixture produced from it.

Existing immutable installations need a rebuilt signed package plus update/reinstall and the corrected host. A host restart alone does not change installed package bytes. Package version remains 4.2.21; release versioning and frozen archive identity belong to the release preparation.

## Files changed

- `builds/resume_builder/resources/inference-program.js` and `src/chat-workspace.ts`: require independent owner confirmation at the gap gate.
- `builds/resume_builder/resources/agent-instructions.md`: name gaps and reserve the Proceed choice to the owner.
- `builds/resume_builder/test/inference-program.test.ts`: same authorization matrix against shipped and source planners.
- `builds/typescript/app-platform/mcp-host/app-chat-model.ts` and `resume-host-adapter.ts`: prevent model render requests from attesting owner confirmation.
- `builds/typescript/app-platform/mcp-host/self-contained-app-proof.test.ts`: forged disposition and plain model request preserve the Resume and return the gate; owner action succeeds through the installed fixture.
- `builds/typescript/app-platform/mcp-host/app-chat-session.test.ts`: use owner actions in fixtures that need an authorized partial Resume.
- `builds/typescript/app-platform/mcp-host/README.md`: source-mapped confirmation-boundary documentation.
- `docs/developers/catalog.json`: register this internal evidence note.
- This note.

## Verification

Test-first: both shipped-resource and source-planner regressions failed for the unconfirmed `proceed_with_limitations` case (2 failures, 78 passes). The installed host proof also failed because the model render made another capability call. Dependencies were initially absent (`vitest: command not found`); identical worktree package dependencies were copied locally from the fix-1 worktree without changing lockfiles. Sandbox-only integration runs hit `listen EPERM`; port-binding test runs use disposable local servers outside that restriction. An initially oversized instruction addition failed the existing prompt-size bound; the final concise instruction stays within 16 KiB.

| Check | Result |
| --- | --- |
| `builds/resume_builder`: `npm test` | PASS: 9 files, 233 tests; includes 14 source/shipped authorization matrix cases. |
| `builds/resume_builder`: `npm run build` | PASS. |
| `builds/typescript`: `npm run lint`, `npm run build` | PASS. |
| `builds/typescript`: `npm run web:lint`, `npm run web:typecheck`, `npm run web:build` | PASS. Existing unresolved font-path and large-chunk build warnings remain. |
| `builds/typescript`: `npm run web:test` | PASS: 27 files, 337 tests, including the existing owner gate-button regression. Existing jsdom navigation diagnostic remains. |
| `builds/typescript`: `npm test -- --run app-platform/mcp-host --maxWorkers=2` | PASS: 11 files, 96 tests, including signed runtime integration. |
| Final installed-package regression: `npm test -- --run app-platform/mcp-host/self-contained-app-proof.test.ts` | PASS: 3 tests; strengthened assertions verify unchanged Profile and exactly one owner-created Resume revision. |
| `builds/typescript`: `npm test -- --maxWorkers=2` | PASS: 157 files, 1,439 tests. |
| `builds/typescript`: `npm run docs:verify` (runs `docs:test` and `docs:check`) | PASS: 166 tests, 1 Windows-specific skip; 269 scoped candidates, zero diagnostics. |
| Root: `node tools/docs/sync-generated.mjs --check`, `git diff --check` | PASS. |

No dependencies, lockfiles, generated schema, or UI code changed. The final installed-package assertion additions were checked after the full suite; the implementation was unchanged. One local commit is requested with title `Resume Builder: only the owner can approve a resume with missing essentials (CF-3)`; no push.

## Still needs live verification

On the frozen Candidate 14 host and rebuilt installed package, repeat the E-6 A10 plain chat request with the six visible gaps. Capture the tool input/result, named-gap owner presentation, unchanged Profile and Resume revision/hash, and absence of a definition/render write. Try a forged model disposition and verify it still cannot proceed. Then use Create resume and Proceed with limitations as the owner; capture exactly one successful render, preserved visible limitations, unchanged Profile, and the host outcome message before the next turn. Repeat with a complete Profile, cancellation/return-to-editing, all required personas and claimed web/desktop surfaces, and verify zero extra model calls during deterministic rendering. Local tests do not replace CF-3's live UI confirmation screenshot or release qualification evidence. No live owner/provider or Candidate 14 run was performed here.
