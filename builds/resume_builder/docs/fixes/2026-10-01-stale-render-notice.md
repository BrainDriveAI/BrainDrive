# Resume Builder: stale-render notice (AC-8.2)

## Defect and evidence

On Candidate 13, a direct editor save changed the Resume Profile from revision 2 to 3 (target role changed). Your Resume continued showing the prior formatted content with only the static read-only explanation and no notice. A fresh render used the corrected Profile; later chat left the Profile byte-identical.

Diagnostic source (not release evidence): `/private/tmp/claude-501/-Users-davidwaring/12199fa7-2d64-4713-8987-80426680a3d3/scratchpad/e6e10-slice/REPORT.md`, E-6 section. No owner credential or secret files were read.

Review target and baseline: `origin/feature/internet-search-capability` at `2756b32c6be11aca5e6e9476ac4a7f4e356b703d`. Work branch: `fix/rb-stale-render-notice`. Local commit only; no push.

## Spec check

Accepted authority was read through `/Users/davidwaring/BrainDrive-Library/accepted/`, checked out at `f6e926113ff068c6dd837decadbaa1a02a4e4d98`:

- `docs/apps/resume-builder/resume-builder-spec.md`, v0.9.11, AC-8.1: “Given an owner edits the Resume Profile directly, the host supplies the current Profile as the owner’s resume context when they return to chat or choose Create Resume. Create Resume uses that current Profile rather than a stale copy.”
- Same spec, AC-8.2: “The app clearly tells the owner when Profile edits require a new render. It does not silently overwrite the Profile from older chat context.”
- Same spec, AC-10.2: “No additional model call occurs, and the Profile remains unchanged.”
- Same spec, functional checklist: “Keep the saved Resume Profile as the sole editable source of resume content.” and “Create or update the Profile only on clear owner intent; never rewrite it silently.”
- `docs/platform/host-chat/host-chat-spec.md`, AC-9.2: “Then BrainDrive uses the latest saved document as current context” and “And does not rely on stale pre-edit assumptions”.
- `docs/platform/app-platform/braindrive-app-host-spec.md`, APP-4.3: “A document declared read-only is presented as read-only — the owner can tell before trying, and the reason (e.g. deterministically generated) is discoverable.” BD-HOST-CW-10 also requires shared authoritative records and revision lineage rather than divergent presentation-local state.

The specs prescribe neither notice placement nor exact copy. The smallest reading is a notice on Your Resume when the saved source differs from its render, with an explicit Create resume action. The existing read-only explanation remains visible. There is no automatic render, Profile write, or chat prompt from the notice.

`docs/apps/resume-builder/evaluation/resume-builder-evaluation-plan.md`, AC-8.2 row and §3 `overwrite-check` (A3), expect a visible stale-render notice after the edit, a screenshot, unchanged Profile hashes around later chat, and exact notice-string matching. The typed notice has `notice_visible=true`, decoded `notice_text_b64` containing a declared `notice_match_strings` value, and a verified digest. Save/model-turn event timestamps and sequences must prove save precedes the next model turn; the next turn and fresh Resume must contain the declared edited fact. DOM/text and screenshot observations must bind to the same edit case. The plan's sealed capture order explicitly lists save-confirmation → fresh-resume → stale-render-notice; live collection must retain the stale-state observation before re-render and reconcile that capture-order wording without keeping an obsolete notice visible after a successful render. This fix does not implement the separate host-event recording/evaluation producer work.

Repository governing context: `AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json` (installed-apps route and source mappings), `docs/developers/verification.md`, `docs/developers/integrations/installed-apps.md`, `builds/typescript/app-platform/contracts/README.md`, `builds/typescript/app-platform/mcp-host/README.md`, `builds/typescript/app-inference/README.md`, and `builds/resume_builder/README.md`.

## Design and implementation

Create resume already reads the current Profile snapshot and deterministically writes a separate Markdown Resume. Its write now carries optional `derived_from: { document_id, revision_id }` metadata naming that exact Profile snapshot. The generic action-plan/storage boundary preserves this metadata, includes it in idempotency, and restricts action-plan derivation to a declared bound source and a derived document. Markdown and PDF content are unchanged. No new model call is added.

On opening Your Resume, the generic native document view reads the saved Resume and the source named by its existing read-only presentation descriptor. It compares source revision IDs. Existing Candidate 13 renders without lineage use `Profile.updated_at > Resume.updated_at` until the next render supplies exact lineage. This fallback cannot reconstruct a historical source revision and depends on the existing server save timestamps; new renders use exact revision identity even when timestamps are equal. Retained-data reinstall rebinding preserves those content-save timestamps and authors while updating the active installation/grant fields. A per-load generation guard discards superseded document/source successes and failures; selection, session changes, and unmount invalidate outstanding loads.

The visible status copy is:

> Your Resume Profile changed since this document was created. Choose Create resume again to update it.

The button is **Create resume**. It invokes the source descriptor's existing direct render action with owner confirmation and the existing missing-essentials gate. After a successful action, the view reloads the Resume and source and clears the notice only when current. Detection itself only reads. The owner must reopen Your Resume to detect a source edit made on another surface; no background polling is added.

App-specific source/render meaning stays in the app action plan and presentation descriptor; the host uses generic document lineage, titles, and declared render actions. There is no installer, credential, provider, or packaging change.

### Shipped path

Live checking found that `10052e8` added render lineage only to `src/chat-workspace.ts`. The installed development app instead executes `resources/inference-program.js`: `builds/typescript/app-platform/lifecycle/fixture-repository.ts` loads that file through `loadResumeBuilderInferenceProgram`, archives it as `payload/docker/inference-program.js`, and generates `payload/docker/index.js`, which imports `planResumeAction` and invokes it for the private `app.actions.plan` tool. All three modern fixture targets (Docker Linux, desktop Windows, desktop macOS) use that server entrypoint. The shipped module now carries the same Profile revision lineage as the TypeScript planner. The fixture manifest already declares the bound `resume.profile` source and `resume.document` derived document with its read-only source reference; no descriptor change is needed.

Stage-1 `builds/typescript/app-platform/lifecycle/stage1-catalog-source.ts` retrieves digest-bound prebuilt archives and descriptors; the verifier and supervisor execute the selected manifest's packaged entrypoint, without loading app `src/`. Stage-1 tests use archives generated by the fixture builder. Searches of tracked `tools/`, `.github/`, installer assets, and runtime scripts found no separate release `.bdapp` builder in this checkout. `.github/workflows/ci.yml` runs Resume Builder tests and `tsc`; `tsconfig.json` emits `src/` to `dist/`, but that CI job does not create a `.bdapp`. The external release builder and frozen release archive therefore remain unverified; the release owner must confirm the rebuilt archive includes the corrected program.

Package version remains **4.2.21**, unchanged. Existing installations execute retained immutable package bytes and need a rebuilt, signed package plus an explicit update or reinstall; a host restart alone does not replace installed code. A new version is recommended for the immutable release rollout and belongs to the release owner. It is not a technical prerequisite in this checkout: `lifecycle/routes.ts` offers an update for a changed digest at the same version, and `lifecycle/service.ts` permits that update (rejecting an older version or an identical version/digest). Development fixture republishing on host start refreshes the available package only. This source fix does not backfill lineage into existing Resume documents; the next successful Create resume writes it.

## Files changed

- `builds/resume_builder/src/chat-workspace.ts`: bind the deterministic render to its Profile revision.
- `builds/resume_builder/test/chat-workspace.test.ts`: verify lineage, deterministic steps, unchanged source, and no Profile write.
- Shipped-path follow-up: `builds/resume_builder/resources/inference-program.js` now writes the same lineage; `builds/resume_builder/test/inference-program.test.ts` directly exercises this shipped module. The existing TypeScript planner remains consistent and needs no further edit.
- `builds/typescript/app-platform/contracts/app-action-plan.ts` and `app-storage.ts`: additive optional lineage contract.
- Six corresponding generated JSON Schemas under `builds/typescript/app-platform/contracts/schemas/v1/`: regenerate the affected action-plan and document/storage schemas.
- `builds/typescript/app-platform/mcp-host/app-action-plan-executor.ts` and its test: pass lineage through and reject an undeclared source.
- `builds/typescript/app-platform/storage/app-document-store.ts` and `builds/typescript/app-platform/lifecycle/app-storage-documents.test.ts`: persist lineage and bind it to idempotency while preserving the source; review fixes preserve content-save times/authors across retained-data rebinding and test legacy source/render ordering.
- `builds/typescript/client_web/src/api/apps-adapter.ts`: expose optional lineage on a document record.
- `builds/typescript/client_web/src/components/apps/AppChatWorkspace.tsx` and its test: show the notice and direct action, refresh after rendering, and test the real editor/save interaction; review fixes discard superseded document/source responses and add deferred-response plus real-storage reinstall regressions.
- Source-mapped package, contracts, and MCP-host READMEs: document current behavior; the review fixes update the MCP-host README with read invalidation and preserved save metadata.
- `docs/developers/catalog.json`: register this required fix note as an internal, non-authoritative evidence record.
- This fix note.

## Tests

Regression tests were added first. The package test failed for absent lineage; both component cases failed for the missing visible notice before implementation.

Component coverage uses the real Edit/Save controls: notice absent for a matching render; present after changing the saved Profile; old Resume preserved until owner action; absent after fresh render; Profile snapshot unchanged by detection/render; one Profile write attributable only to the editor save; no queued chat/model render request. Both legacy timestamp and exact-revision records are covered; exact revision comparison also detects a changed Profile with an unchanged timestamp.

Original implementation results (commit `10052e8`):

| Check | Result |
| --- | --- |
| `builds/resume_builder`: `npm test`, `npm run build` | PASS: 9 files, 219 tests; TypeScript build exits 0. |
| `builds/typescript`: `npm run web:lint`, `npm run web:typecheck`, `npm run web:test`, `npm run web:build` | PASS: 27 files, 339 tests; lint, typecheck and production build exit 0. |
| `builds/typescript`: focused storage, executor and their contract tests | PASS: 4 files, 25 tests. |
| `builds/typescript`: `npm run lint`, `npm run build` | PASS, exit 0. |
| `builds/typescript`: final `npm test -- --maxWorkers=2` (JSON reporter) | PASS: 157 files, 1,441 tests, zero failures. Synthetic loopback/process tests ran outside the restrictive sandbox. |
| `builds/typescript`: `npm run docs:test`, `npm run docs:check`, final `npm run docs:verify` | PASS: 166 tests passed, 1 existing Windows-specific skip; documentation validation passes with 269 scoped candidates and zero diagnostics. |
| Root: `node tools/docs/sync-generated.mjs --check`, `git diff --check` | PASS. |
| Root: `tools/security/scan-secrets.sh --current` | PASS: zero findings; candidate scope excludes ignored owner credentials/secrets. |
| Schema generation | `npm run contracts:schemas` hit the sandbox's tsx IPC-listen restriction; equivalent `node --import tsx app-platform/contracts/generate-json-schemas.ts` succeeds. Only the six affected schemas changed. |

The first unrestricted full runtime run (`--maxWorkers=4`, alongside the baseline) had 1,437 passed / 4 failed; one failure was the new executor mock's missing audit envelope, corrected before the final checks. The untouched target had 1,436 passed / 3 failed. Common failures were the recovery deadline assertion in `app-platform/mcp-host/data-capability-bridge.test.ts` (line 196) and the 5-second timeout in the Profile/Resume route test in `app-platform/mcp-host/self-contained-app-proof.test.ts`. The fix run also timed out in `resume-domain/resume-data-m6.test.ts`; the baseline also timed out in a different bridge test. Isolated reruns of those three files passed all 22 tests on **both** revisions. The final full fix run passed all 1,441 tests. These were intermittent baseline/timing observations, not remaining failures.

Comparison evidence was collected in a clean detached worktree at the exact target SHA above. JSON reports/logs were written to task-owned `/private/tmp/rb-{fix,baseline}-runtime-results.json`, `/private/tmp/rb-{fix,baseline}-rerun-results.json`, and `/private/tmp/rb-fix-final-runtime-results.json` (temporary local diagnostics, not committed release evidence). The web build's unresolved Montserrat/Questrial font-path and large-chunk warnings also occur on the untouched target's web build; both builds exit 0.

Dependencies were absent in this worktree. Tests used task-local dependency links to preinstalled packages; no dependency manifest/lockfile, owner runtime state, or owner credential file was changed. An initial sandboxed runtime attempt had socket/process restrictions and timeouts; unrestricted synthetic tests supersede it. The documentation check initially required registering this new fix note; the catalog entry resolves that issue.

### Review-fix tests

The adversarial findings were read from `../packets/p38/findings.md`. Five additional regressions were added before the production changes. Against `10052e8`, four workspace cases failed: an older matching source response cleared the newer stale notice; an older failed source read replaced the current view with an error; an older Resume response replaced the selected Profile content; and a legacy Profile edit followed by real retained-data storage rebinding lost its notice. The storage regression also failed because rebinding replaced the save timestamp and author.

The reinstall component test uses the real file-backed document store with a controlled clock and task-owned temporary directory. It saves through the real Edit/Save controls, observes the notice before reinstall, binds a fresh installation/grant, opens a new workspace, and verifies the notice and unchanged content/revision/save metadata. The storage test independently verifies current authority fields, historical save authors/times, legacy source/render timestamp ordering, and the audit timestamp. Deferred-response cases release the older success/failure only after a newer read or document selection and assert that it cannot replace the current view/notice. Existing fresh-render clearing and no extra Profile write/model-action assertions remain in place.

Review-fix results:

| Check | Result |
| --- | --- |
| `builds/resume_builder`: `npm test`, `npm run build` | PASS: 9 files, 219 tests; build exits 0. |
| `builds/typescript`: `npm run web:lint`, `npm run web:typecheck`, `npm run web:test`, `npm run web:build` | PASS: 27 files, 343 tests; lint, typecheck and production build exit 0. |
| `builds/typescript`: `npm test -- app-platform/lifecycle/app-storage-documents.test.ts app-platform/mcp-host/app-action-plan-executor.test.ts app-platform/contracts/app-storage.test.ts app-platform/contracts/app-action-plan.test.ts` | PASS: 4 files, 26 tests. |
| `builds/typescript`: `npm run lint`, `npm run build` | PASS, exit 0. |
| `builds/typescript`: `npm test -- --maxWorkers=2 --reporter=json --outputFile=/private/tmp/rb-review-runtime-results.json` | PASS: 157 files, 1,442 tests, zero failures; synthetic loopback/process tests ran outside the restrictive sandbox. |
| `builds/typescript`: `npm run docs:verify` (runs `docs:test` and `docs:check`), final `npm run docs:check` | PASS: 166 tests passed, 1 existing Windows-specific skip; 269 scoped candidates, zero diagnostics. |
| Root: `node tools/docs/sync-generated.mjs --check`, `git diff --check` | PASS. |
| Root: `tools/security/scan-secrets.sh --current` | PASS: zero findings. |

No schemas or package contracts changed. Lifecycle source mappings need no canonical behavior change: only the colocated storage regression changes in that subtree; the current storage/host behavior is documented in the MCP-host README. Existing font-resolution/large-chunk web build warnings remain. Live release acceptance remains outstanding as described below.

### Shipped-path follow-up tests

Two parameterized regression cases were added before the shipped-program change. Both failed because the `resume.document` write lacked `derived_from`. They import `planResumeAction` directly from `resources/inference-program.js` and assert the exact supplied Profile revision for two different revisions, with an older Resume first in the document list. They also assert the deterministic two-step plan, current Profile content, and unchanged input documents, excluding an extra Profile write or inference step. Both pass after the fix. The existing `src/chat-workspace.ts` lineage regression also passes.

The Resume Builder README already documents the promised lineage behavior, and the host/contract documentation already covers its preservation. This follow-up repairs the shipped implementation to match that behavior; no canonical documentation or schema change is needed. Only the shipped module, its regression test, and this fix note change; no package version or fixture descriptor changes.

Shipped-path follow-up results:

| Check | Result |
| --- | --- |
| `builds/resume_builder`: `npm test`, `npm run build` | PASS: 9 files, 221 tests; build exits 0. Includes the two new shipped-module regressions and the existing source-planner regression. |
| Development archive inspection using `createFixtureRepository` and `readStoredZip` via `node --import tsx --input-type=module` | PASS: archived `payload/docker/inference-program.js` bytes equal the corrected resource; generated server imports its planner; all three targets use that server entrypoint. Task-owned temporary archive root removed. |
| `builds/typescript`: `npm run web:lint`, `npm run web:typecheck`, `npm run web:test`, `npm run web:build` | PASS: 27 files, 343 tests; lint, typecheck and build exit 0. Existing font-resolution/large-chunk warnings remain. |
| `builds/typescript`: `npm test -- app-platform/lifecycle/app-storage-documents.test.ts app-platform/mcp-host/app-action-plan-executor.test.ts app-platform/contracts/app-storage.test.ts app-platform/contracts/app-action-plan.test.ts` | PASS: 4 files, 26 tests. |
| `builds/typescript`: `npm run lint`, `npm run build` | PASS, exit 0. |
| `builds/typescript`: `npm test -- --maxWorkers=2 --reporter=json --outputFile=/private/tmp/rb-shipped-runtime-results.json` | PASS: 157 files, 1,442 tests, zero failures; synthetic socket/process tests ran outside the restrictive sandbox. |
| `builds/typescript`: `npm run docs:verify` (includes `docs:test` and `docs:check`), final `npm run docs:check` | PASS: 166 tests passed, 1 existing Windows-specific skip; 269 scoped candidates, zero diagnostics. |
| `builds/typescript`: `node --import tsx app-platform/contracts/generate-json-schemas.ts` | PASS: exit 0; no generated schema changes. Uses the equivalent command documented above to avoid the tsx CLI IPC restriction. |
| Root: `node tools/docs/sync-generated.mjs --check`, `git diff --check` | PASS. |
| Root: `tools/security/scan-secrets.sh --current` | PASS: zero findings. |

Check logs and the runtime JSON report are task-owned temporary diagnostics under `/private/tmp/rb-shipped-*`, not committed release evidence. No live release acceptance run was performed.

## Still needs live verification

On the frozen Candidate 14 package and host combination, repeat E-6 through the real owner editor on web and claimed desktop platforms: capture the confirmed save, edited Profile revision/hash, notice DOM text/status and screenshot before Create resume, unchanged old Resume, explicit Create resume action (including gap disposition if needed), current fresh Resume, notice disappearance, zero render model calls, and unchanged Profile hashes around rendering and later chat. Check mobile notice/action reachability and capture save/model-turn occurrence/sequence from the accepted event producers. Include all required personas and sealed evidence. Local component/unit tests do not satisfy that release evidence gate. No candidate/live-provider run or real-owner screenshot was performed here.
