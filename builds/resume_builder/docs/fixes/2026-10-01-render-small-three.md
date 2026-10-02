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


## Review corrections — consistent Resume/PDF text, entry titles, and Projects

This follow-up supersedes the earlier statement that Projects nesting remains outside the change. The owner's review explicitly authorizes retaining a standard `Projects` parent heading and rendering its nested entry titles separately. Projects remains an extra section at its existing position after the standard block, in Profile encounter order alongside other extras. Review Notes and other extra-section classification/placement remain unchanged; the open owner question is not resolved here.

Governing context remains `AGENTS.md`, `docs/developers/README.md`, the `installed-apps` and `verification` routes in `docs/developers/catalog.json`, `docs/developers/integrations/installed-apps.md`, `builds/typescript/app-inference/README.md`, `builds/typescript/app-platform/mcp-host/README.md`, and `docs/developers/verification.md`. Product authority is the accepted Template Standard §2–§6 and the owner's review request. No provider calls or Profile writes were added.

- Shipped `resources/inference-program.js` and source `src/chat-workspace.ts` protect bare URLs, emails, and code spans before pairing emphasis delimiters. Code delimiters are presentation; their contents remain literal. Wrapping assembles words across formatting runs and uses only actual source whitespace. PDF font faces remain regular/bold; italic delimiters produce regular text on both surfaces.
- `client_web/src/components/apps/AppChatWorkspace.tsx` uses `client_web/src/lib/paper-inline-markdown.ts` with the same inline grammar. The paper preview preserves whitespace, uses uppercase only for section headings, and renders deeper entry headings in bold with their original case. PDF entry headings use 10.5pt bold rather than uppercase section styling. Nested pipe-form role headings consume their heading markers before splitting title and metadata.
- Projects retains deeper headings within its parent, including P1's Campus Transit Survey Project, bullets and visible date gap. Empty bullet markers do not become body text or bullet glyphs on either surface.
- Experience detection strips heading emphasis, accepts title/employer content from a substantive entry heading, and removes all gap markers and inline formatting before checking body content. Empty headings and gap-only subtrees still name Experience as missing as well as listing unresolved gaps.

Regression evidence: initial regressions were added before the implementation changes and extended during review. The initial package red run reproduced 14 failures. A final regression recheck against unchanged `bb28414` reproduced 15 package failures (including the added PDF entry-style/empty-bullet assertion), and the paper-view regression also fails against that unchanged component. Two further regressions reproduced code literals being parsed twice during heading/contact normalization; those failed before that correction. Display values now retain their markup until the final inline parse, while classification and field labels use normalized text. The fixed package suite passes 262 tests. Inline and gate regressions compare shipped/source logical text and named gate results rather than opaque IDs or binary PDF identities.

P1/P2 parity tests in `AppChatWorkspace.test.tsx` create the formatted Resume using both planners, mount the actual Your Resume view, and compare its rendered logical text with both PDFs using `pdftotext -layout` when Poppler is available. The portable fallback decodes PDF text commands when Poppler is absent. On this worktree Poppler is installed and all four comparisons pass exact whitespace-normalized equality. Independent assertions require the fixed section order, P1's Projects parent and original-case project title, visible date gap, and absence of empty bullets. Temporary exports are removed by the tests. These are synthetic source-side checks, not a new installed-app persona qualification run.

Platform documentation has no contract impact: package delivery, authority, capability, inference, provider mediation, storage, export transport and receipt boundaries are unchanged. The package README and this fix note document the rendering/readiness corrections; the existing canonical integration pages do not prescribe a different inline grammar or entry style.

### Resumed review and verification

Resumed on 2026-10-01 at `bb28414` on `fix/rb-render-small-three`, retaining the previous run's uncommitted implementation. Inspection against sibling `packets/p69.prompt.md` found coverage for all seven listed defects and the additional P1 Projects finding; no clearly missing item or new feature was identified. The commit includes the new `builds/typescript/client_web/src/lib/paper-inline-markdown.ts` alongside the shipped/source changes and regressions described above.

The owner reports that the interrupted run already passed package tests/build, web lint/typecheck/tests/build, the full runtime suite (1,439 tests on Node 22), and P1/P2 `pdftotext` parity. Those broader checks were not repeated during this resume. Fresh requested checks used Node **22.23.3**:

| Command / working directory | Fresh result |
|---|---|
| `npm test` in `builds/resume_builder` | Exit 0; **10 files / 262 tests passed**. |
| `npm run web:test` in `builds/typescript` | Exit 0; **27 files / 340 tests passed**, including P1/P2 shipped/source PDF-to-Your-Resume parity. Poppler is available, so the tests use `pdftotext -layout`. |
| `npm run web:typecheck` in `builds/typescript` | Exit 0; `tsc --noEmit` passed. |
| `npm run docs:check` in `builds/typescript` | Exit 0; **269 scoped candidates / zero diagnostics**. |
| `git diff --check` at repository root | Exit 0. |

The web suite emits `Not implemented: navigation to another Document` but reports no test failures. Existing live qualification and visual-review limitations remain as recorded above.

### Contact/email and experience review corrections

Follow-up to `c0c761b` on `fix/rb-render-small-three`, 2026-10-01. The four review defects are corrected in the shipped program and source planner, with shared paper/PDF inline behavior. Whole-field emphasis now moves onto the contact value after label-only emphasis is removed, retaining Name/Email content, nested value markup, and code literals until final rendering. A regression also protects separately emphasized labels and values from being mistaken for whole-field emphasis. Experience headings accept unspaced pipes, consistent with the renderer; empty/gap-only field values exclude their labels from substantive-content checks. All gap markers remain named by the existing gate.

`src/inline-markdown.ts` is now the canonical pure grammar. The source PDF renderer and `client_web/src/lib/paper-inline-markdown.ts` consume it directly. `node scripts/sync-inline-markdown.mjs` (from `builds/resume_builder`) embeds its compiled function in the standalone shipped `resources/inference-program.js`; the package suite runs `--check` to reject drift. Leading underscore emphasis is recognized before email content is protected, while intraword underscores, escaped punctuation, URLs, and code literals remain intact. PDF-specific text normalization stays in the PDF adapter.

Tests were added before correcting the defects: the isolated contact run reproduced four lost-field failures; PDF email cases reproduced three literal-delimiter failures; gate cases reproduced the unspaced-pipe false negative and two label-only false positives; paper parser cases reproduced three email-emphasis failures. The separately emphasized label/value overlap found during final review also failed before its correction. Package regressions compare shipped/source render and gate outputs, and the actual paper-view test checks email text and strong styling. Review Notes and extra-section classification/order are untouched and retain existing regression coverage.

Fresh final verification:

| Command / working directory | Result |
|---|---|
| `npm test`, `npm run build` in `builds/resume_builder` | Pass: **11 files / 285 tests**, TypeScript build. |
| `npm run web:typecheck`, `npm run web:test` in `builds/typescript` | Pass: **28 files / 348 tests**, typecheck. |
| `npm run web:build` in `builds/typescript` | Pass; existing unresolved font URL and chunk-size warnings remain. |
| P1/P2 parity within `AppChatWorkspace.test.tsx` | Pass: all four shipped/source PDFs match mounted Your Resume text and heading order after whitespace normalization using **Poppler 26.03.0 `pdftotext -layout`**, with temporary exports removed. |
| `npm run docs:test`, `npm run docs:check`, `npm run docs:verify` in `builds/typescript` | Pass: docs suite **166 passed / 1 skipped / 0 failures**; validation **zero diagnostics**. |
| `node tools/docs/sync-generated.mjs --check`, `git diff --check` at root | Pass. |

The web suite emits its existing jsdom navigation notice without failures. The package README and this note describe the corrections; canonical platform documentation has no additional impact because no package-delivery, host authority, inference, storage, export transport, or receipt contract changed. These are synthetic source-side checks, with the previously recorded installed-app and visual qualification limits still applicable.


## No-content-loss invariant — root parser correction

Follow-up base: `80a264b`, branch `fix/rb-render-small-three`, 2026-10-01. Change authority is the owner's request for a test-first deterministic fuzz invariant over the shipped renderer, its source twin, the client paper grammar and PDF extraction. Governing context remains `AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json` (`installed-apps`, `verification`), `docs/developers/integrations/installed-apps.md`, `builds/typescript/app-inference/README.md`, `builds/typescript/app-platform/mcp-host/README.md`, and `docs/developers/verification.md`.

### Invariant design

`test/render-invariant.test.ts` uses a dependency-free xorshift generator with seed `0x5eed0911` and 2,048 synthetic Profiles. Each fragment carries independently authored Markdown and expected display text; the expected text is not stripped with the production parser. The corpus composes regular/strong section headings, heading and plain pipe entries, commas/dashes, bullets, contact labels and whole-field emphasis with trailing parentheses, URL punctuation and underscores, emails, single/multiple-backtick code, single/double/triple and nested star/underscore emphasis, snake_case, literal C*, gap markers, and malformed/unbalanced delimiter runs. Ambiguous inputs have literal expected text; valid grammar construction avoids treating an ambiguous trailing literal star as an authored closing delimiter.

Each case asserts complete ordered equality with the expected logical text through the client `paper-inline-markdown.ts`, equality of shipped/source Resume Markdown, deterministic generation and repeat Resume/PDF output for each planner, literal URL/email/code payload preservation, and independent real `pdftotext -layout` equality for both PDFs (4,096 extractions). Template presentation is explicit in the oracle: contact labels and structural separators are layout, section headings use uppercase, and bullets use the PDF glyph. The inline payload checks compare exact characters; PDF logical text normalizes layout whitespace, including source spaces replaced by wrapped lines. Code-looking balanced delimiters remain literal when inside code. Poppler is required; this suite has no fallback that silently weakens PDF verification. All temporary PDFs are removed.

The failure reducer removes Profile lines and then character chunks down to individual characters while retaining its failure predicate. Content-loss failures retain the missing payload; residual-marker failures mask authored literals; PDF failures retain paper/extraction inequality. A separate test verifies the reducer. Reduced discoveries remain as named regressions, together with the owner's four review cases. Existing mounted P1/P2 tests verify the actual Your Resume component against all four shipped/source PDFs.

### Findings and correction

The initial test-first run reproduced lost emphasized fields with trailing text, broken emphasis across pipe splits, code pipes treated as structural separators, URL closing markers consumed before punctuation, and the comma-form experience gate false negative. Early generated cases additionally found multi-backtick code broken at pipes, nested URL delimiter tails, ambiguous partial runs relocating a literal star, and an ambiguous Name label dropping its value. Real PDF extraction found a long header clipped at the page edge. Extending the grammar found block-normalization heuristics rewriting code/paired emphasis that resembled dates, bullets or headings. Coverage of plain pipe titles also reproduced renderer-added emphasis turning C* into ambiguous markup. Keeping ambiguous pipe lines intact exposed an export gate that rejected substantive heading-only entries.

The canonical scanner now records matched delimiter source positions and protected code/address positions. Contact values are sliced with complete enclosing emphasis and trailing content, and unclassified/empty/duplicate contact lines are preserved. Pipe splitting uses the same source positions, ignores code/address pipes, and balances enclosing emphasis in each resulting field. If emphasis is unfinished or partially matched, the original pipe line remains intact. Partially consumed delimiter runs and their connected matches render literally. URL protection uses currently open delimiter runs, preserving nested closing syntax before punctuation and preventing earlier closed emphasis from changing later URL payloads. Pipe title styling uses an entry heading instead of injecting more emphasis characters.

Authored multiline block boundaries are preserved. Legacy flattened-input repair protects code, addresses and balanced emphasis with collision-free internal placeholders. Long PDF headers fit within the page width without clipping. Comma-form entry headings satisfy Experience; empty and gap-only headings remain rejected, and a substantive entry heading can be exported without a paragraph body. Source and standalone shipped implementations are paired; `scripts/sync-inline-markdown.mjs --check` rejects grammar drift. No dependency, provider, Profile-write, host authority, inference, persistence or export-transport change is introduced.

Review Notes and extra-section classification/placement are unchanged. Existing section-order and P1/P2 regressions remain the authority for that boundary. Canonical platform documentation has no contract impact: these changes remain app-owned parsing, readiness and artifact rendering. The package README describes the behavior and Poppler test prerequisite.

### Final verification

Fresh checks used Node 22.23.3 and Poppler 26.03.0. The trailing-punctuation corpus also includes Unicode punctuation (curly quotes, ellipsis and dashes); the Unicode quote regression failed before the scanner switched from an ASCII suffix list to the same Unicode punctuation classes used for delimiter flanking.

| Check | Result |
|---|---|
| `npm test` in `builds/resume_builder` | Pass: **12 files / 308 tests**, including the 2,048-case invariant run, 4,096 real PDF extractions, reducer coverage and named regressions. |
| `npm run build` in `builds/resume_builder` | Pass. |
| `npm run web:typecheck`, `npm run web:test`, `npm run web:build` in `builds/typescript` | Pass: **28 files / 348 web tests**, typecheck and production build. |
| P1/P2 mounted Your Resume parity | Pass: all four shipped/source PDFs match the rendered component's whitespace-normalized logical text with real `pdftotext -layout`; section order and Review Notes/extra placement assertions pass. |
| `npm run web:lint` in `builds/typescript` | Pass. |
| `npm run docs:verify` / `npm run docs:check` in `builds/typescript` | Pass: **166 tests / 1 skipped / 0 failures**, **269 candidates / 0 diagnostics**. |
| `node tools/docs/sync-generated.mjs --check`, `node builds/resume_builder/scripts/sync-inline-markdown.mjs --check`, `git diff --check` | Pass. |
| `tools/security/scan-secrets.sh --current` with pinned local Gitleaks 8.30.1 | Pass: zero findings. |

The web build retains its existing unresolved font URL and large-chunk warnings; the web suite retains its jsdom navigation notice without failures. A prior full run passed all invariant cases but failed the existing exact-Markdown title assertion; that assertion now expects an entry heading, and the final full suite passes. No dependencies or lockfiles changed. These are synthetic local verification results, not installed-app or visual qualification; the previously recorded live boundary remains unchanged.

## Round 6

Read-only review `../packets/p77/review.out` reproduced two remaining root defects. Tests were extended first and failed for heading-only experience, repeated standard-section content, the expanded invariant, and long-name typography. Both `src/chat-workspace.ts` and shipped `resources/inference-program.js` now accept substantive role headings without an employer separator, while empty, gap-only and the existing unfilled-entry placeholder remain missing. Repeated Contact, Summary, Experience, Education, Skills and Certifications sections combine their bodies in Profile order before template rendering.

The 2,048-case independent-oracle generator now varies heading-only P3–P5 forms from the accepted evaluation persona documents (`p3-experienced-professional.md`, `p4-recently-laid-off.md`, `p5-sparse-or-messy.md`), repeated Skills/Education, Education entry headings, Projects and Profile Review Notes. Generated heading-only entries have no body; both planners' gates are checked as well as Resume/paper text and 4,096 real PDF extractions. Named regressions retain the freelance and Excel/SQL cases, empty/gap rejection, and PDF name-size assertions against inflated content streams.

Base `2756b32` used fixed 22pt PDF names; this branch introduced shrinking. Long names now wrap in bold at 22pt using the existing width-aware wrapper. Review Notes and extra-section classification/placement are unchanged. Canonical platform documentation has no contract impact: host authority, package delivery, inference and export transport are unchanged. No client_web files were touched.

Verification: `npm test` in `builds/resume_builder` passed **12 files / 311 tests**, including all 2,048 generated Profiles and 4,096 PDF extractions; `npm run build` passed. Focused runtime tests (`app-inference/installed-program.test.ts`, `app-platform/mcp-host/live-fixture.integration.test.ts`, `app-platform/lifecycle/app-storage-documents.test.ts`, `--maxWorkers=2`) passed **3 files / 29 tests** after retrying with loopback access; the initial sandbox run denied fixture listeners with `listen EPERM: operation not permitted 127.0.0.1`. `docs:test` and `docs:verify` passed **166 tests / 1 skipped / 0 failures**; `docs:check` passed **269 candidates / 0 diagnostics**. Generated-doc and inline-grammar sync checks and `git diff --check` passed. Client tests/lint/typecheck were not required because no client files changed. Results are synthetic local verification, not installed-app visual qualification.
