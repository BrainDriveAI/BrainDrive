# Resume Builder fix 6: review notes stay in chat

This is a non-authoritative implementation and verification note for Dave J's review before the Candidate 14 freeze. Product authority is Dave W's 2026-10-01 decision: fix the model instructions; preserve the renderer and Resume Template Standard.

## Defect and evidence

Candidate 13's model wrote a `## Profile Review Notes` section into the Resume Profile. The deterministic renderer faithfully included it in the Resume and PDF, including internal commentary such as "not yet ready for a final formatted version."

Diagnostic evidence supplied for this task: `../e9-slice/REPORT.md` lines 17 and 23 (P1 and P5), and `../e6e10-slice/REPORT.md` line 22 (P1 rerun). These are reports in the task's sibling workspaces, not repository files or passing release receipts.

The shipped Agent Instructions require readiness and gap disclosure but did not explicitly place that disclosure only in chat. Inspection of the packaged markdown found no Review Notes section or instruction to record review notes in the Profile. The missing explicit boundary lets model-authored commentary become resume content.

## Governing context and specification basis

Repository context: `AGENTS.md`, `docs/developers/README.md`, the `installed-apps` task route and Resume Builder source mapping in `docs/developers/catalog.json`, `docs/developers/integrations/installed-apps.md`, `docs/developers/verification.md`, and `builds/resume_builder/README.md`.

Accepted documentation was read from `/Users/davidwaring/BrainDrive-Library/accepted/docs`:

- `apps/resume-builder/resume-builder-spec.md`, product definition: "The model conducts the conversation and writes a resume-ready **Resume Profile** when the owner asks." AC-7.2: "The Profile honestly omits missing information or marks it for later input." AC-10.2: "No additional model call occurs, and the Profile remains unchanged."
- `apps/resume-builder/resume-template-standard.md`, section 3: "Any Profile section outside this set renders after Skills in Profile order using the same heading style; prose in the Profile that sits outside any section does **not** render." Section 4: "The renderer performs no summarization, no rewording, no reordering, no capitalization or date-format \"fixes.\""
- `software-factory/build-gate.md`, BG-9: "deterministic outcomes live in code; judgment and language live in the model's instructions"; it names "The D373 boundary (markdown-driven conversation, code for deterministic steps + artifacts)".

The shipped [Profile template](../../resources/resume-profile-template.md) supplies the existing content-only rule quoted in the owner decision: "the finished Profile holds only resume content and any remaining `[gap: ...]` markers, because everything in it flows into the formatted resume." This exact sentence is in the shipped template, not in the accepted docs checked above; the accepted Template Standard supplies the rendering basis.

## Design and files

- [Agent Instructions](../../resources/agent-instructions.md): explicitly forbid writing review, readiness, coaching, or internal notes into the Profile on creation or update. Say those things in chat, including gap disclosure. Name the observed section and readiness comment as examples to avoid.
- [Profile template](../../resources/resume-profile-template.md): reinforce the same rule alongside the existing content-only guidance. No Review Notes section existed to remove. Preserve visible `[gap: ...]` markers for unresolved resume details.
- [Regression test](../../test/chat-workspace.test.ts): load shipped resource markdown, require the chat-only rule in both instructions and template, preserve the gap-marker rules, and reject note headings or positive instructions to store such notes in the Profile.
- `docs/developers/catalog.json`: register this note as internal, non-authoritative evidence.

`builds/typescript/app-platform/lifecycle/fixture-repository.ts` loads these files from `builds/resume_builder/resources/` into `payload/resources/`; Agent Instructions are included at workspace start and the Profile template initializes the Profile document. Editing `src/` would not change these installed resources. No renderer, Template Standard, host behavior, code-side filter, or automatic cleanup is changed. The canonical package README needs no behavior update: its Profile/source and app-owned-prompt boundaries already describe this design.

Judgment call: existing Profiles that already contain Review Notes are not auto-cleaned. Their existing content still renders until the owner reviews and edits it. This fix changes shipped model guidance, not saved owner documents or customized instruction overrides.

## Verification

The new focused regression failed before the markdown change because the chat-only rule was absent, then passed after it was added. Dependencies were initially absent (`vitest: command not found`); both workspaces installed their locked dependencies with offline `npm ci --ignore-scripts`.

Handoff results:

- `builds/resume_builder`: `npm test` — 9 files, 220 tests passed; `npm run build` — passed.
- `builds/typescript`: `npm test -- app-platform/lifecycle/app-storage-documents.test.ts app-platform/mcp-host/live-fixture.integration.test.ts app-inference/installed-program.test.ts` — storage and installed-program checks passed (19 tests). The 10 signed-fixture integration tests initially failed with `listen EPERM: operation not permitted 127.0.0.1` under the sandbox; `npm test -- app-platform/mcp-host/live-fixture.integration.test.ts` rerun outside the sandbox passed all 10.
- `builds/typescript`: `npm run docs:check` — passed, 269 scoped candidates, zero diagnostics; `npm run docs:verify` — passed, 166 documentation tests passed, one skipped, zero failures, plus documentation validation.
- Repository root: `node tools/docs/sync-generated.mjs --check` — passed; `git diff --cached --check` — passed.

## Still needs live verification

Run fresh Candidate 14 conversations with incomplete P1/P5 material and inspect the saved Profile, formatted Resume, and exported PDF. Confirm review/readiness/coaching commentary appears only in chat, no Review Notes section is added, gaps remain visible, and the owner hears the accurate gap count. Include a subsequent chat-driven Profile update. Static regression coverage proves shipped guidance, not model compliance or live PDF behavior. The Candidate 13 diagnostic reports remain diagnostic only.
