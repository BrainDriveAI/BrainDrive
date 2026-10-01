# Missing-essentials gate: owner authorization (CF-3)

Internal, non-authoritative fix evidence for `fix/rb-gate-owner-authorization`, initially based on `2756b32` on `feature/internet-search-capability`, with this review correction based on `09f026f` in the named worktree. This records implementation and local verification, not Candidate 14 qualification or live acceptance.

## Defect and evidence

Candidate 13 diagnostic `e6e10-slice/REPORT.md`, E-6 A10: on a plain “make a resume” request with six visible Profile gaps, the assistant called `app_action_resume_create` with `missing_essential_disposition=proceed_with_limitations`. Resume revision 4 was created without an owner gate choice or Proceed click. The UI gate existed, but the model supplied its own disposition and the host treated the render descriptor's confirmation label as owner confirmation.

Review of `09f026f` found two remaining defects: a complete Profile could render with `owner_confirmed: false` and empty model input, because the planner checked confirmation only at the gaps gate; and the owner gate displayed only a gap count. Both Create and Export also remained in the packaged model audience. This correction removes both actions from that audience and displays every missing-item label before Proceed.

## Spec check

Step 1 verdict: the accepted authority reserves every Create/Export to owner controls and the incomplete-Profile decision to the owner. No spec-gap stop is required. Authority was read from `/Users/davidwaring/BrainDrive-Library/accepted/docs`, using these paths relative to that checkout:

- `docs/apps/resume-builder/resume-builder-spec.md`
- `docs/apps/resume-builder/evaluation/resume-builder-evaluation-plan.md`
- `docs/platform/host-chat/host-chat-spec.md`
- `docs/platform/app-platform/braindrive-app-host-spec.md`

Exact quotations:

Resume Builder, Product Behavior and Primary Flow:

> When the owner asks to create a resume, the model writes or updates the Resume Profile. The Profile is the editable source of truth. The owner can edit it directly or ask for changes in chat. Create Resume formats the Profile into a separate Resume. Export PDF produces a downloadable PDF from that Resume.

> 3. **Create and export:** Owner chooses Create Resume; app formats the current Profile; owner reviews the Resume and chooses Export PDF.

Resume Builder, Functional Requirements:

> - [ ] Before rendering marked gaps or missing essentials, name them and let the owner continue with an honest partial resume or return to editing. Essentials are contact information and at least one experience entry; the check uses gap markers and required-section presence, not a readiness score.

Resume Builder, Critical Failure Behavior:

> | Invalid or incomplete Profile | Name the missing item. Let the owner edit the Profile, return to chat, or knowingly create an honest partial render. |

Resume Builder, AC-10.1–10.2:

> - **AC-10.1** — Given an editable Resume Profile exists, when the owner chooses Create Resume, the app creates a distinct formatted Resume from the current Profile.
> - **AC-10.2** — No additional model call occurs, and the Profile remains unchanged.

Evaluation plan, CF-3 (full row):

> | CF-3 | Invalid/incomplete Profile → name the missing item; owner may edit, return, or knowingly render partial | Deterministic incomplete-Profile gate: confirmation names exact items and offers the three choices — E-9 (P1, P5). (The "no readiness score in code" inspection is a Build Gate candidate, recorded here as supporting evidence only.) | ui | confirmation screenshot | G2 | Yes | Covered |

Evaluation plan, APP-6.5 (observation requirement):

> Across every run transcript, no host-origin message is followed by a model-triggered Export or Create: correlate prompt-audit `tool_call` events and audit-sink export/create events with the owner action timeline; every export or render traces to an owner control.

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

The package declares `resume.create` and `resume.export.pdf.request` with `model_exposure: hidden`. The model tool list and model action prompt omit them. Host dispatch now has an explicit owner/model audience: model dispatch still requires available exposure; the authenticated owner endpoint independently validates the owner, declared action, schemas, active session and grants, so hidden actions remain usable by owner buttons. No action-ID policy branch or chat wording is added to host code.

The packaged planner requires independent `owner_confirmed: true` before every Resume definition/document write, including a complete Profile. A complete unconfirmed request throws `resume_create_owner_confirmation_required` without producing a plan. Incomplete requests still return only the named-gap action result unless both owner confirmation and `proceed_with_limitations` are present. That gate writes no Profile or Resume. Existing model render callbacks continue to force confirmation false as defense in depth.

The app-owned Markdown instructions now say that a chat request for a resume reads/writes/updates the Profile and directs the owner to **Create resume**. The model never triggers Create or Export or claims it created a Resume. Existing state reads and host outcome records still ground replies about owner-created artifacts. Conversational behavior stays in Markdown under D373.

The owner gate displays every returned missing-item label as a list before **Proceed with limitations**, explains that the result is an honest partial resume with visible limitations, and offers **Edit the Profile** and **Return to chat**. Those alternatives do not dispatch a second Create or record success. The UI regression covers all three choices with model-hidden Create/Export descriptors.

`builds/typescript/app-platform/lifecycle/fixture-repository.ts` loads `builds/resume_builder/resources/inference-program.js`, packages it as `payload/docker/inference-program.js`, and generates the runtime entrypoint that calls `planResumeAction`. That shipped resource is changed directly; `src/chat-workspace.ts` is kept consistent. The regression imports the resource directly, and the host proof installs the signed fixture produced from it.

Existing immutable installations need a rebuilt signed package plus update/reinstall and the corrected host. A host restart alone does not change installed package bytes. Package version remains 4.2.21; release versioning and frozen archive identity belong to the release preparation.

## Files changed in this review correction

- `builds/resume_builder/resources/inference-program.js` and `src/chat-workspace.ts`: require confirmation for complete-Profile rendering; source action metadata also marks Create/Export hidden.
- `builds/resume_builder/resources/agent-instructions.md`: reserve all Create/Export to owner buttons; chat requests update/read the Profile and direct the owner to Create resume.
- `builds/resume_builder/test/inference-program.test.ts`: test complete Profiles with unconfirmed empty and forged-disposition inputs against both shipped and source planners.
- `builds/typescript/app-platform/lifecycle/fixture-repository.ts`: package Create/Export as model-hidden actions; remove obsolete chat-export wording.
- `builds/typescript/app-platform/mcp-host/resume-host-adapter.ts`: separate authenticated owner dispatch from model-exposure enforcement.
- `builds/typescript/app-platform/mcp-host/self-contained-app-proof.test.ts`: installed-package tools exclude Create/Export; model attempts preserve definitions/Resume/Profile; owner gate and authorized partial/complete creation succeed.
- `builds/typescript/app-platform/mcp-host/live-fixture.integration.test.ts`: align packaged export descriptor assertion; existing owner PDF export still runs through the signed runtime bytes reference.
- `builds/typescript/client_web/src/components/apps/AppChatWorkspace.tsx` and its `.test.tsx`: disclose every missing label and verify each of the three owner choices; hidden model audience does not disable owner header buttons.
- `builds/typescript/app-platform/mcp-host/README.md`: canonical source-mapped dispatch, confirmation, and gate documentation.
- This note. The existing catalog registration already covers it; no catalog/projection change is needed.

## Verification of this review correction

Test-first: the new complete-Profile tests failed against both planners (4 failures, 80 passes), the installed-package proof failed because Create/Export were still exposed (1 failure, 2 passes), and the UI test failed because the named-item gate region was absent. Five later UI tests initially failed after that aborted gate test left mock responses unconsumed; the full file passed once disclosure was implemented. The focused planner and installed-package regressions then passed. A standalone installed-package rerun while the full suite and documentation checks were competing for resources reached the existing 5-second timeout; the isolated final rerun passed without changing timeouts. No dependency or lockfile changes were needed. Sandbox-only signed-runtime integration hit `listen EPERM: operation not permitted 127.0.0.1`; the required integration/full runtime checks use disposable local listeners with sandbox escalation.

| Check | Result |
| --- | --- |
| `builds/resume_builder`: `npm test` | PASS: 9 files, 237 tests, including the four new complete-Profile shipped/source regressions and existing 14 incomplete authorization cases. |
| `builds/resume_builder`: `npm run build` | PASS. |
| `builds/typescript`: `npm run lint`, `npm run build` | PASS. |
| `builds/typescript`: `npm run web:lint`, `npm run web:typecheck`, `npm run web:build` | PASS. Existing unresolved font-path and large-chunk build warnings remain. |
| Focused UI: `client_web`: `npm test -- --run src/components/apps/AppChatWorkspace.test.tsx` | PASS: 35 tests, including names visible before Proceed, Edit without render, and Return without render. |
| `builds/typescript`: `npm run web:test` | PASS: 27 files, 339 tests. Existing jsdom navigation diagnostic remains. |
| `builds/typescript`: `npm test -- --run app-platform/mcp-host --maxWorkers=2` | PASS: 11 files, 96 tests, including signed runtime owner Create and PDF Export integration. |
| Final installed-package regression: `npm test -- --run app-platform/mcp-host/self-contained-app-proof.test.ts` | PASS: 3 tests. |
| `builds/typescript`: `npm test -- --maxWorkers=2` | PASS: 157 files, 1,439 tests. |
| `builds/typescript`: `npm run docs:verify` (runs `docs:test` and `docs:check`) | PASS: 166 tests, 1 Windows-specific skip; 269 scoped candidates, zero diagnostics. |
| Root: `node tools/docs/sync-generated.mjs --check`, `git diff --check` | PASS. |

One new local commit is requested with title `Resume Builder: only the owner's Create resume button builds a resume; name every missing item at the gate`; no push. Existing package version/release qualification limits above remain.

## Still needs live verification

On the frozen Candidate 14 host and rebuilt installed package, repeat the E-6 A10 plain chat request with the six visible gaps. Capture the model tool list excluding Create/Export, unchanged Profile and Resume revision/hash, and absence of a definition/render write. Try complete and incomplete Profiles and forged model requests; verify neither can invoke Create. Capture the owner gate listing every missing-item label before Proceed and all three choices. Then use Create resume and Proceed with limitations as the owner; capture exactly one successful render, preserved visible limitations, unchanged Profile, and the host outcome message before the next turn. Repeat with a complete Profile, cancellation/return-to-editing, all required personas and claimed web/desktop surfaces, and verify zero extra model calls during deterministic rendering. Local tests do not replace CF-3's live UI confirmation screenshot or release qualification evidence. No live owner/provider or Candidate 14 run was performed here.
