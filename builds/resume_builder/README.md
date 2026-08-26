# Resume Builder package and sandboxed owner surface

This separately buildable package implements Resume Builder 5.0.0 as a model-led product on BrainDrive's native message list and composer. The model decides how to interview, what matters, whether enough has been shared, whether a follow-up is useful, how context resolves ambiguity, and how to select, organize, write, and revise resume content. There is no host-owned field checklist, readiness score, association heuristic, scripted next-question engine, or extraction phase in the primary conversation.

The app's portable workspace resources live in [`resources/workspace/`](resources/workspace/): its `AGENT.md`, interview guide, editable Profile template, and Resume template. A host mounts those declared resources into an owner-scoped app workspace without changing their content; the host, not the app, decides how to display them and how to provide normal chat, identity, and authorized context.

`resume_dialogue` is one compact response/action contract. It returns natural assistant text plus zero or more bounded actions: cite owner messages and create a useful fact, update an existing fact by copied record identity and revision, save a complete resume version supported by durable fact revisions or same-turn fact actions, or request an export. The model can read the bounded transcript and current editable resume state in its context. It has no filesystem, credential, provider-selection, permission, approval, or direct storage authority.

The host is a thin durable substrate. It enforces authentication and grants, strict data shapes, exact quoted source membership, referenced-record and optimistic-revision existence, atomic transcript/fact/version persistence, deterministic rendering/export, and explicit owner approval for consequential actions. Those bright-line checks do not decide meaning, completeness, relevance, ambiguity, association, wording, or readiness. When an action cannot execute mechanically, the host returns a concise factual tool result to the model; the model decides how to continue. Every accepted user/assistant turn is append-only durable transcript provenance with stable source revisions, while facts and resume definitions retain normal revision history and direct editing.

A malformed model draft structure may use the existing fact-only deterministic fallback. That fallback formats only durable facts into a valid version and never supplies narrative judgment. Genuine provider, transport, or wholly unreadable outcomes write no inferred fact and appear as ordinary non-blocking assistant messages in the visible thread; history remains visible, the composer stays available, and retry is secondary and inline.

The resource uses only the MCP Apps bridge. A zero-data launch requests a genuine model welcome and first question; returning owners resume from durable visible turns. The compact right review rail remains visible and honestly empty until actions persist information, then shows it with direct correction controls. The full ledger, draft, history, approval, rendering, and export workspace remains behind deliberate Review.

## Conversation product contract

The native BrainDrive message thread and composer are the sole primary intake surface. The main chat has no Pause or uncertainty buttons, field form, host checklist, progress counters, scripted topic sequence, per-turn confirmation, or app-authored gap question. Clarifications and digressions stay conversational. The model may propose no action for a useful turn, may save sourced facts while continuing, or may decide that the user's request and current state support a complete resume version.

The rail remains visible on first launch and describes its empty state honestly. It is not a progress dashboard. Full evidence, correction history, and resume versions open only through deliberate Review. A model may describe a draft as prepared for saving only when its same response contains the matching save action; visible saved state and progress are host-authored after atomic acceptance. Invalid actions are rejected independently where possible, and factual tool results are supplied to the next model turn rather than converted into host-generated clarification. Genuine provider/transport or wholly unreadable outcomes preserve and durably display both the owner message and recovery reply in sequence, keep prior history and the composer visible, and expose retry only as a secondary inline action.

Returning sessions do not ask the model to invent an opening continuation from an old assistant turn. They display durable history and leave the composer ready; only a genuinely empty thread requests a model welcome.

## Deliberate supporting workspace

The existing strategy, tailoring, craft review, approval, history, rendering, export, and Career-publication paths remain available from the full Review workspace for compatibility. They are not prerequisites, hidden interview intelligence, or the primary model-led drafting path. The model-led save action creates an editable, versioned general draft directly; later owner approval and export still use the established consequential-action controls.

Before approval, the resource requests and persists a score-free C1–C7/T1–T3 product craft report over the current proposal and its exact strategy/target context. The surface renders the domain's typed state, copy, findings, and allowed actions without translating a raw verdict. Blocking findings precede secondary guidance. Run review, bounded repair, add evidence, manual revision, owner approval, prior-version retention, and exit remain separate controls; only `product_craft_passed` exposes approval. The repaired successor is never auto-approved and must be reviewed again. Missing, stale, failing, incomplete, and evidence-limited review states cannot create ordinary owner approval.

Tailoring has a second materiality check after generation. A separate targeted resume is created only when each supported planned change causes an observable, useful wording or ordering difference. Punctuation, capitalization, or whitespace alone finalize the saved target analysis through the honest `no_material_resume_change` route; the surface keeps the general resume and creates no targeted definition or variant.

Spec 07 Milestone 5 returns the host-produced Career summary v2 after approval. Its deterministic operation identity makes response-loss retry idempotent, and the journal projects only the exact approved revision, narrow quality label, and current product-craft report revision when applicable. The gateway separately publishes unchanged approved-resume Markdown plus validated optional quality metadata. Career's normal read-only document viewer displays that metadata outside the Markdown body; publication or parity failure falls back to the latest verifiable prior approval without changing approved data or prior Career content.

Spec 07 Milestone 6 separates that independent review from the one final owner approval. The proposal surface consolidates current evidence coverage, strategy, target-fit, craft findings, intentional omissions, and unresolved uncertainty without a score or prediction. Preview consumes a strict host parity result and disables only representations that failed independent reconstruction; verified clean text remains selectable when safe and the approved source stays unchanged. Host dialogs expose screen-reader names/descriptions, initial focus, Tab containment, Escape cancellation, and focus restoration. Semantic interaction diagnostics require zero redundant confirmations, zero non-fact dialogs, at most one grouped fact confirmation per submission, and one final approval. The numeric release threshold remains blocked on `RB7-OQ-2`; this implementation does not invent one.

Spec 06 Milestone 2 exact-slot recovery remains available inside the deliberate supporting workspace. The primary chat has no Pause/Continue controls. Supporting edits display `Saved` only for the host-acknowledged digest; response loss and CAS conflict preserve local text and expose bounded recovery controls. Browser storage is not used, and unsent content remains outside fact provenance.

Version 4.0.0 now activates the Spec 06 Milestone 4 remembered-detail flow in addition to the Milestone 3 job-evidence interview. A returning owner can select a saved job, use an exact job-label match, choose general career context, or correct a saved fact. Ambiguous and missing matches write nothing. Exact duplicate information records the owner action without a second confirmation or regenerated resume. Confirmed changes generate one proposed general successor from the exact current fact snapshot; failure keeps the fact and approved source safe for retry.

The general proposal shows derived added, removed, corrected, and reworded statement effects. Tailored variants based on the approved source are shown as based on older evidence and are rebuilt only after an explicit owner action. Approved source and tailored records remain immutable, and Career Markdown changes only after the new general proposal is approved.

Spec 06 Milestone 5 makes History an accessible, read-only comparison surface. It lists historical proposal, approved, and retired revisions with owner-visible title, kind, job target, status, date, and version; limits checkbox selection to exactly two; and sends those exact revision IDs and expected revisions through `resume.definitions.read`. Results identify added, removed, changed, moved, evidence-reference changed, and unchanged statements with text semantics independent of color. Unchanged statements are collapsed by default and expose `aria-expanded`; result focus moves to the comparison heading; labels, live selection status, keyboard controls, responsive single-column layout, and overflow wrapping support screen readers, supported mobile widths, and 200% zoom. Unrelated or incompatible selections show a safe unavailable state and never substitute another version. The comparison path invokes neither inference nor any write capability.

Spec 06 Milestone 6 activates grounded natural-language revision for an exact approved general or targeted resume. The owner first chooses the whole resume, a section, or a statement; the exact request is persisted before classification or drafting. Presentation-only requests proceed to a bounded draft, factual or mixed requests require a distinct host confirmation first, and ambiguous requests stop for clarification without creating a proposal. Every proposal is a new immutable revision linked to the exact source definition and generating request, keeps unchanged statement identities stable, and must pass deterministic support and scope validation. Accept, owner Edit, Reject, and Regenerate are separate host-confirmed outcomes; accepting a proposal does not approve or publish it. A failed or cancelled generation keeps the durable request and approved source safe for bounded retry.

Spec 06 Milestone 7 makes clean text the always-available approved-resume recovery surface. Preview labels the exact immutable version, keeps a selectable read-only UTF-8 representation visible if PDF generation fails, and offers host-confirmed Copy, `.txt`, and PDF actions without receiving a destination path. Guidance is optional and read-only: five neutral categories cite only visible evidence labels, ask no more than three optional questions, and provide no score, ranking, prediction, guarantee, or inferred competence. Malformed or unavailable model output falls back to the same deterministic finding projection.

After a general resume is approved, BrainDrive exposes the latest approved version in Career as the read-only `General Resume` Markdown document. This uses the gateway's generic app-published document provider, not Resume Builder-specific Career UI. The host derives and refreshes the document path/content from the authoritative approved definition; the sandbox receives no project filesystem access and drafts cannot replace the published version.

The dialogue chooses the next useful question from the visible conversation and confirmed state; it does not march through a scripted topic form. It can cover contact details, direction, employment, role-linked evidence, education, credentials, skills, projects, leadership, volunteering, and links as relevant. Owners can defer or express uncertainty in natural language. Follow-ups may seek useful outcomes without requiring metrics and never invent information. The deliberate Review workspace remains the place to inspect gaps, correct facts, and access later approval, preview, export, and history paths.

It intentionally has no independent provider adapter, credential access, owner filesystem authority, production lifecycle process, Docker service, or desktop sidecar. Provider execution stays inside BrainDrive's host broker. `RUNTIME_ENABLED` remains `false` for this package process, and it exposes no `start`, `dev`, or execution script; the installed signed fixture runtime is supervised by the app platform.

## Governing sources and evaluation contract

This product contract was selected through `AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json`, `docs/developers/verification.md`, `builds/typescript/app-platform/contracts/README.md`, `builds/typescript/resume-domain/README.md`, and `builds/typescript/resume-inference/README.md`. Executable authority lives in `resources/main.html`, the dialogue result/context schemas and policy, the client mediator, the resume domain service/store, and their closest tests.

The handoff evaluation measures outcomes and bright-line safety rather than field completion. It must demonstrate a truthful first-run welcome; natural clarification and digression with no forced write; multiple roles and education when the model judges them useful; exact-source fact actions; model-decided draft timing; an actual editable resume version without an app checklist; correction and revision history; reopen persistence; deliberate review; export confirmation when supported; and inline provider failure that preserves visible history and the composer. Negative cases include malformed actions, nonexistent references, stale revisions, invalid quotes, atomic rollback, malformed draft fallback, and no host-execution claim before accepted action. Synthetic fixtures cover deterministic boundaries only; a credential-backed Docker conversation through draft and review remains required before owner dogfooding.

Commands:

```bash
npm run test
npm run build
```

Before a dogfood handoff, run the combined deterministic, host, resource, and isolated-browser evaluation from `builds/typescript`:

```bash
npm run resume:eval
```

When an owner credential is configured in that environment, add the controlled live-provider conformance gate:

```bash
BRAINDRIVE_RESUME_EVAL_LIVE=1 npm run resume:eval
```

For a controlled browser journey against an already running Docker development app, provide the disposable local test login through `BRAINDRIVE_E2E_IDENTIFIER` and `BRAINDRIVE_E2E_PASSWORD`, set `BRAINDRIVE_E2E_BASE_URL`, and run with `BRAINDRIVE_RESUME_EVAL_LIVE_BROWSER=1`. The browser gate uses the configured provider and must reach an actual draft and deliberate review; it is opt-in so ordinary test runs never consume owner credentials or provider capacity.

Synthetic fixtures prove workflow and safety only. At least one controlled live-provider interview through visible draft/review is required before asking an owner to test a new dialogue build.
