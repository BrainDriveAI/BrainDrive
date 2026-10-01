# Resume Builder product fix 5 — PDF emphasis, experience gate, and standard section order

Revision-bound diagnostic fix note, 2026-10-01. Base: `2756b32`, branch `fix/rb-render-small-three`. This records implementation evidence, not candidate qualification or acceptance.

## Governing context

Repository authority: `AGENTS.md`; routing: `docs/developers/README.md`, `docs/developers/catalog.json` (`installed-apps`, `verification`); canonical platform context: `docs/developers/integrations/installed-apps.md`, `builds/typescript/app-inference/README.md`, `builds/typescript/app-platform/mcp-host/README.md`; checks: `docs/developers/verification.md`.

Accepted product authority is in the separate BrainDrive Library accepted checkout, under `docs/apps/resume-builder/`: `resume-builder-spec.md` v0.9.11, `resume-template-standard.md` v1.0, and `evaluation/resume-builder-evaluation-plan.md` v1.0-rc24. The current work order requests A/B/C spec checks before implementation; uncovered behavior must remain unchanged.

## Findings and spec verdicts

Candidate 13 diagnostics: sibling `e9-slice/REPORT.md` lines 12–38 and `e6e10-slice/REPORT.md` line 22. These are diagnostic observations, not release evidence. The E-9 report actually executed P1/P5; the P2 fixture here uses the sibling E-5 P2 Profile snapshot rather than claiming P2 ran in E-9.

**A — covered and fixed.** Export PDF printed literal emphasis delimiters around dates such as `*September 2025–Present*` and `*June 2024–Present*`.

- AC-11.2: “The PDF preserves the Resume’s logical content and order.”
- AC-11.3: “Every character in the formatted Resume renders in the PDF, or the export refuses with a message naming the characters it cannot render; silent omission is a failure.”
- Template Standard §1: “a plain-text extraction of the PDF must reproduce the logical content and order of the rendered resume exactly”.
- Template Standard §6: “PDF text extraction reproduces the logical content and order exactly”. Markdown emphasis delimiters describe presentation; they are not characters of the formatted body.
- Evaluation AC-11.2 checks “parse-back text + heading order equal to formatted Resume”; AC-11.3 compares `pdftotext` output character-for-character against the formatted Resume (whitespace-normalized).

**B — spec gap; deliberately left unchanged.** The Profile's `## Profile Review Notes` appears in the Resume/PDF, including internal readiness advice. No accepted AC excludes these sections; the bound format contract instead includes them:

- AC-9.1: “with standard resume headings, as defined by the Resume Template Standard.”
- AC-9.2 requires passing “every item of the Resume Template Standard §6 acceptance checklist on the rendered Resume and PDF”.
- Template Standard §3: “Any Profile section outside this set renders after Skills in Profile order using the same heading style”.
- Template Standard §6: “No content appears that is not in the Profile; nothing in the Profile's sections is missing”.
- The shipped Profile template explicitly says the finished Profile contains only resume content and gaps because everything flows into the resume.

The exact question is recorded outside the product repository in sibling `packets/p63/spec-gap.md`: should the accepted standard exclude structurally identified review/internal sections, which heading names or metadata identify them (including nested content), and how should other extra sections remain preserved? Filtering on a phrase or heading without that authority would violate the current fidelity requirement. The requested commit subject names all three findings; it is not a claim that B was fixed.

**C — covered and fixed.** The gate falsely names Experience as missing despite usable `###` role entries under `## Experience` (P1 volunteer/barista and P2 operations/customer-support shapes).

- AC-10.1: “Given an editable Resume Profile exists, when the owner chooses Create Resume, the app creates a distinct formatted Resume from the current Profile.”
- AC-10.2: “No additional model call occurs, and the Profile remains unchanged.”
- Spec incomplete-Profile requirement: “Essentials are contact information and at least one experience entry; the check uses gap markers and required-section presence, not a readiness score.”
- Spec failure behavior: “Name the missing item. Let the owner edit the Profile, return to chat, or knowingly create an honest partial render.”
- Evaluation CF-3: “Invalid/incomplete Profile → name the missing item; owner may edit, return, or knowingly render partial”; the method requires “confirmation names exact items”. A present Experience subtree must not be listed as missing. P1's actual gap markers still require confirmation; P2 can create directly.

**Section order and missing headings — covered; fixed in the AC-9.1 follow-up below.** AC-9.1 binds Template Standard §3: “Order is fixed”, with Professional Summary, Experience, Education, Skills, Certifications after the header, and §6: “Sections appear in standard order; no empty sections, no resolved-none sections”. The Experience and Education headings are required when those sections contain content. Evaluation AC-9.1 checks Template Standard §2–§3, and AC-9.2 checks §6 on both surfaces. The initial PDF/gate change left the renderer's separate treatment of every nested heading as a top-level section unchanged; the follow-up corrects that parsing for recognized standard sections.

## Design and files

- `resources/inference-program.js`: the shipped runtime copied into `payload/docker/inference-program.js` by `builds/typescript/app-platform/lifecycle/fixture-repository.ts`. PDF inline parsing pairs star/underscore emphasis delimiters, including nested and triple delimiters, using flanking and ambiguous-run rules. Strong text remains bold; italics use plain text within the existing regular/bold font set. Escaped and unpaired literal stars/underscores remain visible, including `C*` and intraword underscores. No fonts or dependencies added.
- `src/chat-workspace.ts`: identical readiness and emphasis behavior for the source API.
- Required-section detection retains its matching section's heading depth across deeper entry headings and ends at a sibling/ancestor section. Empty and gap-only entry bodies remain missing; adjacent Education/Skills cannot satisfy Experience. No Profile content, gap markers, renderer section ordering, or note sections are rewritten.
- `test/inference-program.test.ts`: regressions import the shipped module, exercise PDF text commands and named gate items, nested emphasis, escape/literal preservation, and empty experience boundaries.
- `test/fixtures/p1-experience-profile.txt`, `p2-experience-profile.txt`: synthetic evaluation-persona Profile content, preserving the app-written headings/entries without host records or identifiers.
- `README.md`: links this note and describes the changes. Platform integration documentation has no impact: app authority, packaging, inference, capability, provider, persistence and host contracts are unchanged.

## Verification

Initial test-first run: 9 failures / 72 passes (seven emphasis cases plus the P1/P2 gate false positives). Additional nested/literal cases were added during iteration. Final checks and outcomes:

| Command / check | Result |
|---|---|
| `npm test` in `builds/resume_builder` | Pass: 9 files, 238 tests (including 19 new regressions). |
| `npm run build` in `builds/resume_builder` | Pass. |
| `npm run lint`, `npm run build` in `builds/typescript` | Both pass. |
| `npm test -- --maxWorkers=2 app-inference/installed-program.test.ts app-platform/mcp-host/live-fixture.integration.test.ts app-platform/lifecycle/app-storage-documents.test.ts` in `builds/typescript` | Pass: 3 files, 29 tests with loopback access. Initial sandbox run had 10 fixture failures from `listen EPERM: operation not permitted 127.0.0.1`; same checks reran successfully outside that restriction. |
| Local shipped/source PDF check using `pdftotext -layout` | Pass: exact whitespace-normalized expected text for italic, strong, underscore, nested emphasis and literal `C*`/`snake_case`; same logical output from both modules. P1/P2 missing-item and rendered-content projections also match between shipped/source modules. |
| `pdfinfo`, `pdffonts` on that local sample | One US Letter page; regular and bold CID TrueType fonts embedded with Unicode maps. |
| `npm run docs:check` in `builds/typescript` | Pass: 269 candidates, zero diagnostics after catalog registration. |
| `node tools/docs/sync-generated.mjs --check` at root | Pass. |

The initial documentation verification ran while the new fixture inventory was being corrected; its two inventory-related assertion failures passed on a focused rerun. Markdown fixture inventory would require a new disposition policy, so the fixtures are UTF-8 `.txt` files containing the unchanged Markdown shapes. Only the revision-bound fix note needed a catalog entry. Final full runtime: `npm test -- --maxWorkers=2` in `builds/typescript` passed, 157 files / 1,439 tests (exit 0). The known `data-capability-bridge.test.ts:196` base failure did not recur. The initial sandboxed full run was stopped after confirming loopback fixture failures, then this complete run executed with loopback access.

Final documentation: `npm run docs:verify` in `builds/typescript` passed (exit 0): 166 tests passed, one skipped, zero failures; `docs:check` passed with 269 candidates and zero diagnostics. Generated projection check and `git diff --check` also pass.

Dependency setup: the worktree initially had no dependencies (`vitest: command not found`). Offline install lacked a cached tarball (`ENOTCACHED`). Local dependency trees were copied into ignored worktree `node_modules` directories; no lockfile or dependency declarations changed.

## Still needs live

Reinstall/repackage this exact candidate and rerun the real Create Resume and Export PDF controls with P1/P2 Profiles. Check gate items, unchanged Profile, deterministic repeat render, `pdftotext` parity, and a standard PDF reader's visual layout with fonts and page geometry. Local PDF extraction is supporting evidence only; no calibrated reviewer or Candidate 14 qualification has run here. B requires the accepted spec ruling. The section-order/headings correction has the local evidence below; this does not establish the full AC-9.2 visual checklist.

## AC-9.1 follow-up — standard section order and headings

Follow-up base: `4d2a9ff`, branch `fix/rb-render-small-three`, 2026-10-01. Change authority: the owner's explicit request to fix section order/headings in the shipped renderer while retaining unknown/extra Profile handling. Governing context and catalog routes are the same as above. Diagnostic trigger: sibling `e9-slice/REPORT.md` line 17 reports Summary, Skills, Certifications, Experience, Education, Projects, with no Experience/Education headings.

### Bound specification

Accepted authority remains `docs/apps/resume-builder/resume-builder-spec.md` and `docs/apps/resume-builder/resume-template-standard.md` in the separate BrainDrive Library accepted checkout, rather than the package's abbreviated advanced-workspace guidance.

- AC-9.1: “Given an owner chooses Create Resume, the app uses one conservative, single-column, reverse-chronological format with standard resume headings, as defined by the Resume Template Standard.”
- Template Standard §3: “Order is fixed”: Header (without a section heading), Professional Summary, Experience, Education, Skills, Certifications. “Sections render **only when they contain content** (only-when-filled).” Skills preserves the Profile structure, “grouped headings or flat list”.
- Template Standard §6: “Sections appear in standard order; no empty sections, no resolved-none sections” and “PDF text extraction reproduces the logical content and order exactly”.
- Template Standard §3 also says: “Any Profile section outside this set renders after Skills in Profile order using the same heading style”. The owner explicitly excluded extra-section handling from this follow-up; its current placement rule remains unchanged, including Review Notes.

### Design and tests

The existing renderer already appends the recognized sections in fixed order with standard headings. Its parser instead split every heading at depths 2–6 into independent sections, leaving Experience/Education empty when their content began with a depth-3 entry. The fix tracks the current section's heading depth and keeps deeper entry/group headings and their content inside a recognized standard section. Sibling/ancestor headings still end that section. The same narrow change is in `resources/inference-program.js` (the shipped package payload) and `src/chat-workspace.ts` (source API).

No changes to readiness gating, model calls, Profile writes, entry formatting, or extra-section classification/placement. Extras still follow the standard block, including Certifications when present, in their existing encounter order; nested headings in extras still use their existing flattening rule. In P1 this retains the existing extra heading `Campus Transit Survey Project`, Additional Information, and Profile Review Notes. Resolving Projects/Review Notes composition remains outside this change.

`test/template-standard.test.ts` imports the shipped planner and checks source parity. Six regressions cover P1/P2 standard heading order and nested Experience/Education content, deterministic repeat rendering without a Profile write, reversed standard-section input order, alias-to-standard headings, grouped Skills at depths 3/4, empty Education omission, and unchanged extra-section order/nesting. Existing fixtures remain unchanged. Test-first run before implementation: **5 failures / 1 pass**, reproducing the missing headings, misplaced entries, and grouped-Skills defect; after implementation: **6 passes**.

### Follow-up verification

- `npm test` in `builds/resume_builder`: **10 files / 244 tests pass**.
- `npm run build` in `builds/resume_builder`: **pass**.
- Existing PDF parity method, `pdftotext -layout`, run locally on P1/P2 exports from both shipped and built source planners: **all four PDFs pass exact whitespace-normalized logical-text equality and ordered heading checks**. Markdown presentation delimiters are removed, headings use the PDF's uppercase presentation, and bullets use the PDF bullet glyph in the expected logical text. Shipped/source logical output matches; repeat Create Resume is identical.
- Focused runtime command: `npm test -- --maxWorkers=2 app-inference/installed-program.test.ts app-platform/mcp-host/live-fixture.integration.test.ts app-platform/lifecycle/app-storage-documents.test.ts`: **3 files / 29 tests pass** with loopback access. The sandbox attempt had 10 failures from `listen EPERM: operation not permitted 127.0.0.1`; the complete focused suite passed on rerun outside that restriction. A sandboxed full run was stopped after the same fixture restriction was confirmed.

- Full runtime command, `npm test -- --maxWorkers=2` in `builds/typescript`: **157 files / 1,439 tests pass**, exit 0 with loopback access.
- `npm run docs:verify` in `builds/typescript`: **166 tests pass / 1 skipped / 0 failures**, exit 0; its `docs:check` reports **269 scoped candidates / 0 diagnostics**. The explicit `npm run docs:check` after the documentation update also passes.
- `node tools/docs/sync-generated.mjs --check` and `git diff --check`: **pass**.

The package README now describes the fixed standard-section behavior. No platform documentation changes are needed: package delivery, host authority, capability contracts, provider mediation, storage, and export boundaries are unchanged.
