# APP-2.2: BrainDrive logo in installed-app workspace navigation

Non-authoritative implementation and verification record for packet p108. Source base: `7940a4b`, branch `fix/rb-app-sidebar-logo`. This is shared host client work; no app package change is required.

## Governing context

- `AGENTS.md`, `docs/AGENTS.md`
- `docs/developers/README.md`, `docs/developers/catalog.json` (`installed-apps` task route), `docs/developers/verification.md`
- `docs/developers/integrations/installed-apps.md`
- `builds/typescript/client_web/README.md`
- `builds/typescript/app-platform/contracts/app-registry.ts`
- `builds/typescript/app-platform/mcp-host/README.md`
- `builds/typescript/app-inference/README.md`
- Native `Sidebar.tsx` and workspace, AppsPage, and AppShell sources and colocated tests under `builds/typescript/client_web/src/components/`

## Change

The workspace navigation now starts with the native logo image, accessible home button, sizing, spacing, and hover classes. Back to Apps remains immediately below. The mobile drawer close control sits beside the logo and only dismisses navigation.

Home uses the existing workspace close handler to mark intentional departure, dismiss mobile navigation, cancel pending cleanup, and close the active session. AppsPage clears its selected workspace before AppShell selects the root agent. Late session failures cannot renew the departed workspace. Native Sidebar source remains unchanged.

Changed files: `AppChatWorkspace.tsx`, `AppsPage.tsx`, and `AppShell.tsx`, their colocated tests, the canonical MCP host README, the catalog evidence classification, and this note. The catalog addition does not change documentation routes or generated contracts.

## Verification

Dependencies were absent initially (`vitest: command not found`); runtime and web dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund` using existing lockfiles. Test-first regressions then produced 4 expected failures and 2 passes (91 unrelated tests skipped). After implementation, all 108 tests across AppChatWorkspace, AppsPage, AppShell, and Sidebar passed.

| Command (from `builds/typescript` unless stated) | Result |
| --- | --- |
| `npm --prefix client_web run test -- src/components/apps/AppChatWorkspace.test.tsx src/components/apps/AppsPage.test.tsx src/components/layout/AppShell.test.tsx src/components/layout/Sidebar.test.tsx` | PASS: 4 files, 108 tests. |
| `npm run web:test` | PASS: 28 files, 380 tests; jsdom emitted its navigation diagnostic. |
| `npm run test -- --maxWorkers=2` (local networking allowed, final run alone) | PASS: 157 files, 1,476 tests. |
| `npm run web:typecheck`, `npm run web:lint`, `npm run web:build` | PASS, exit 0. Build reported unresolved font paths and a large chunk warning. |
| `npm run docs:test`, `npm run docs:check`, `npm run docs:verify` | PASS: each documentation test run had 166 passes and one Windows-specific skip; validation had 275 scoped candidates and zero diagnostics. |
| Root: `node tools/docs/sync-generated.mjs --check`, `git diff --check` | PASS. |
| Root: `tools/security/scan-secrets.sh --current` | PASS: zero findings. |

The initial sandboxed full runtime run failed with loopback `listen EPERM` (55 failed, 1,421 passed, 3 errors). With local networking allowed, the full run had 1,475 passes and one failure in `data-capability-bridge.test.ts`: a deadline reconciliation read observed pending rather than cancelled. That test and its runtime implementation are unchanged by this fix. A focused rerun of that file passed all 3 tests. The final full runtime run executed alone with local networking allowed and passed all 1,476 tests in 157 files.

Visual inspection used temporary HTML captured from the actual tested React navigation DOM and the built CSS, rendered in Chromium at 1200×900 and 390×844. Native and app desktop logos both loaded at 28 px height and 16 px inset; the mobile logo and dismiss control align in the top row, with Back to Apps below. This static rendering checks appearance only; interaction behavior is covered by component tests. The temporary capture test was removed before handoff. No live native desktop or release acceptance claim is made. No push.
