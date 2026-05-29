# BrainDrive Memory Architecture Draft 3 Work Log

Date: 2026-05-26
Branch: `feature/memory-architecture-draft-3`

## Source Alignment

- Created this work log to track implementation decisions and drift checks while implementing `/home/hex/Reference/Designs/BrainDrive-MVP/Memory_Architecture/implementation-draft-3.md`.
- Read the Draft 3 implementation plan, the friction notes, and the Draft 3 architecture proposal before editing.
- Checked `/home/hex/Reference/the-architecture/docs/memory-spec.md` and `/home/hex/Reference/the-architecture/docs/customization-spec.md` to keep the implementation in the BrainDrive product layer instead of making generic Memory understand BrainDrive-specific files.
- Confirmed existing unrelated local changes were already present in `.dockerignore`, `builds/typescript/client_web/package.json`, `builds/typescript/client_web/package-lock.json`, and `installer/docker/scripts/release-production.sh`; this work avoids reverting those files.

## Implementation Notes

- Draft 3 is being implemented as BrainDrive product behavior: starter content, context assembly, update planning, transition helpers, UI grouping, and tests.
- Generic Memory path resolution and file tools remain generic except for existing generic guarantees such as path sandboxing and reserved-path protection.
- Owner overlays are optional and created on demand. Starter-pack updates must preserve them.

## Completed Work

- Added `builds/typescript/memory/brain-drive-layout.ts` with deterministic Draft 3 ownership, role, overlay pairing, generated report, and state artifact preservation helpers. This keeps BrainDrive-specific layout interpretation out of generic Memory file tools.
- Added `builds/typescript/memory/brain-drive-layout.test.ts` for overlay pairings, role classification, non-canonical overlay names, generated report archive boundaries, and state artifact preservation.
- Updated `readBootstrapPrompt` in `builds/typescript/config.ts` to prepend `Today's date is YYYY-MM-DD.`, include base/overlay read-order guidance, read root `AGENT.md`, and append `AGENT-user.md` after the base when it exists.
- Added bootstrap prompt tests in `builds/typescript/config.test.ts` to cover date injection, missing overlays, and base-before-overlay ordering.
- Updated Finance project chat context in `builds/typescript/gateway/server.ts` to use Draft 3 Finance paths, base-then-overlay guidance, app/procedure overlay hints, and reference-folder routing instead of the old flat `budget.md`, `rules.md`, and `budgeting/` active paths.
- Moved the saved-budget mutation guard to `documents/finance/budget/budget.md` and added a BrainDrive product-layer safety guard that blocks open-period monthly report archive writes while still allowing `reports/latest.md`.
- Extended starter-pack manifests in `builds/typescript/memory/update-prompting.ts` with Draft 3 ownership, role, overlay path, and managed-base path metadata. Deterministic update planning now preserves existing owner overlays, owner state, sources, and generated reports instead of treating them as ordinary drift.
- Updated the memory update LLM prompt so ambiguous merges receive ownership metadata and are told not to move owner-specific facts, merchant mappings, preferences, goals, plans, todos, or personal context into managed base files.
- Converted fresh Finance initialization and starter-pack templates to the Draft 3 shape: project `AGENT.md`, `spec.md`, `run-interview.md`, `plan.md`, `run-planning.md`, `budget/AGENT.md`, `budget/budget.md`, `budget/budget-rules.md`, `budget/create.md`, `budget/compare.md`, `statements/README.md`, `reports/README.md`, and `reports/latest.md`.
- Removed active Finance starter-pack templates for old `index.md`, flat `budget.md`, flat `rules.md`, and `budgeting/*`.
- Updated `layout.contract.json` to Draft 3 layout version 2 with optional overlay naming rules and Draft 3 Finance file expectations.
- Added `builds/typescript/memory/alpha-draft3-transition.ts` and tests. The transition detects pre-Draft-3 Finance memory, copies saved budget state to `budget/budget.md`, moves owner rules to `budget-rules-user.md`, preserves customized legacy create/compare guidance as overlays, archives replaced old paths under `system/updates/pre-draft3-layout/...`, and writes plan/report/backup artifacts.
- Wired automatic memory updates to run the alpha transition before generating the starter-pack update plan, preventing starter placeholders from being created before legacy owner content is moved.
- Updated Finance statement upload routing in `GatewayProjectService` so statement-like uploads update `documents/finance/statements/README.md` as a source evidence ledger instead of recreating `documents/finance/index.md`.
- Updated the web sidebar to group Draft 3 files by role, hide managed instructions by default, label generated reports and sources, and offer a customize action that opens the matching `-user.md` overlay path.
- Added `builds/typescript/tools/architecture-lint/draft3-memory-lint.ts` and `memory/starter-pack-draft3-layout.test.ts` to catch missing Draft 3 Finance files, stale old Finance template paths, non-canonical overlay names, missing Preservation Rules, and unlabeled generated reports.
- Updated API/client contract documentation for Draft 3 Finance file paths and statement README upload behavior.

## Verification

- `npm test -- memory/brain-drive-layout.test.ts memory/alpha-draft3-transition.test.ts memory/starter-pack-draft3-layout.test.ts memory/init.test.ts memory/update-prompting.test.ts config.test.ts gateway/project-chat-context.test.ts gateway/projects.test.ts` passed.
- `npm run build` passed in `builds/typescript`.
- `npm --prefix client_web run typecheck` passed.
- `npm --prefix client_web run test -- src/components/layout/Sidebar.test.tsx` passed.
- `npm test` passed in `builds/typescript` with 24 test files and 121 tests.
- `npm --prefix client_web run test` passed with 14 test files and 65 tests.
- `npm --prefix client_web run build` passed. Vite emitted the existing large-chunk/font-resolution warnings, but the build completed successfully.

## Drift Checks

- BrainDrive-specific Draft 3 semantics live in product helpers, update planning, transition, context, starter content, and UI behavior; generic Memory path resolution and file tools were not made aware of BrainDrive file meanings.
- Old Finance paths remain only in transition/lint/test references or context warnings that explicitly tell the model not to use them as active paths.
- Owner overlays are optional and are not seeded empty by default.
- Generated reports are labeled and existing generated outputs are not replaced by starter-pack update planning.
