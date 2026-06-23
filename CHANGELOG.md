## [26.06.23] - 2026-06-23

### Added
- Starter-pack projects now include stronger baseline interview and planning guidance across Career, Finance, Fitness, Relationships, New Project, and Your Agent templates. (`#148`)
- Starter-pack templates now include richer baseline artifacts, including project `AGENT.md`, `spec.md`, `plan.md`, and interview/planning runbooks where applicable. (`#148`)
- Project chat context now has gateway handling and regression coverage so conversations stay attached to the correct project and reset cleanly when needed. (`#148`)
- File upload flows now include transient provider retry handling, PDF fallback behavior, single-file retry replay, owner-safe upload receipts/errors, and upload lifecycle events. (`#148`)

### Changed
- BrainDrive now uses canonical root agent instructions in `AGENTS.md`, with `CLAUDE.md` and `GEMINI.md` resolving to the same guidance. (`6e7d03ed`)
- BrainDrive Models now uses the `braindrive-models-default` alias in provider config, fallback preferences, starter-pack preferences, and related tests. (`6e7d03ed`)
- OpenRouter defaults now use GLM 5.2 for direct OpenRouter, starter-pack OpenRouter preferences, and memory fallback defaults. (`#162`)
- Starter-pack advisors now point owners to product surfaces like Your Goals, Your Plan, Your Profile, and Your Todos in the sidebar instead of exposing internal filenames or paths. (`#161`)
- Starter-pack interview behavior now emphasizes one-question pacing, missing-context prompts, concrete owner phrasing, vague-answer handling, safety/risk anchors, and plan approval boundaries. (`#148`)
- Your Agent starter routing now directs snapshots and outputs to owning pages with clearer manual fallback behavior. (`#148`)
- New Project starter guidance now gives clearer placement and created-page handling. (`#148`)
- Dependabot npm version-update PRs now target the `dev` integration branch before `main`. (`#150`)
- MCP release development dependencies were updated for newer `tsx` and `vitest` patch releases. (`#158`)
- TypeScript workspace development dependencies were updated for newer Tauri CLI, `tsx`, and `vitest` patch releases. (`#159`)
- Client web dependencies were updated across AI SDK, Tauri API, Lucide, Radix UI, React, React Router, Playwright, Tailwind/Vite tooling, Happy DOM, shadcn, and Vite. (`#160`)

### Fixed
- Starter-pack generated artifacts preserve more owner-specific anchors for vague, risky, or incomplete Career, Fitness, Finance, and Relationships interviews. (`#148`)
- Provider timeout and upload conversion failures now surface more actionable errors during starter and document workflows. (`#148`)
- Starter-pack Finance navigation labels now align with the baseline target and sidebar product language. (`#148`)
- Root agent-instruction duplication was resolved by replacing the old singular `AGENT.md` root file with canonical `AGENTS.md`. (`6e7d03ed`)
- The duplicate seeded Your Agent sidebar project was removed while preserving the root BrainDrive+1 agent entry. (`1983f746`)

### Removed
- Removed the redundant project-page sidebar upload button while keeping the composer upload path intact. (`a1d4faf7`)
- Removed the numeric advanced-file count from the project sidebar toggle while preserving advanced section behavior. (`5a6f1ccc`)
- Removed the legacy seeded Your Agent starter project from the starter-pack project seed list. (`1983f746`)

## [26.05.25] - 2026-05-25

### Added
- Users can upload project documents in common formats and get richer finance budget context from saved supporting files. (`#118`)
- The app now includes a native Tauri desktop installer with desktop runtime support and current mainline features. (`#119`)
- Desktop users can enable Browser Access to use the local web UI and gateway API from a browser with configurable access controls. (`#124`)

### Changed
- Finance and Fitness starter projects now use more focused executable prompts for budgeting and health document workflows. (`#123`)
- The client web React build plugin was updated for newer Vite compatibility and reduced build tooling overhead. (`#117`)
- MCP release development dependencies were updated to improve test tooling, TypeScript execution, and Node compatibility. (`#114`)
- Client web dependencies were updated to bring in newer UI, routing, testing, and build tooling improvements. (`#126`)
- TypeScript workspace development dependencies were updated to improve runtime loading, testing stability, and Node type coverage. (`#125`)

### Fixed
- Local development startup is more reliable, memory exports avoid unwanted artifacts, and first-run installs route new users to registration. (`#122`)

### Removed
- No user-facing removals this week.

## [26.05.11] - 2026-05-11

### Added
- No user-facing additions this week.

### Changed
- Renamed the managed hosting tier to BrainDrive Concierge and updated credits labeling across the app. (`#107`)
- Refined BrainDrive Concierge account and top-up wording, layout, and fee messaging for clearer managed-mode billing. (`#109`)
- Updated MCP release validation dependencies to improve compatibility and reliability. (`#103`)
- Updated TypeScript validation dependencies to improve compatibility and reliability. (`#104`)
- Updated MCP release development type definitions to keep Node.js tooling current. (`#110`)
- Updated TypeScript development type definitions to keep Node.js tooling current. (`#111`)
- Refreshed client web dependencies to bring in framework, styling, icon, and build tooling improvements. (`#112`)

### Fixed
- No user-facing fixes this week.

### Removed
- No user-facing removals this week.

## [26.05.04] - 2026-05-04

### Added
- Starter-pack memory updates can now be detected, planned, applied, and reported automatically during startup. (`#102`)

### Changed
- No user-facing changes this week.

### Fixed
- Mobile chat now stays at the start of new assistant replies instead of jumping past them. (`#100`)
- Managed-mode relogin no longer falls back to the local login screen, and the credits top-up prompt is easier to find. (`#101`)

### Removed
- No user-facing removals this week.

## [26.04.27] - 2026-04-27

### Added
- A new public agent onboarding guide was added to help contributors and coding agents get started faster. (`#56`)

### Changed
- The weekly release notes were refreshed to keep the published changelog current. (`#84`)
- Automated dependency update policy was reorganized by workspace and semantic version level for more predictable maintenance updates. (`#85`)
- Client web dependencies were updated to newer non-major versions to improve compatibility and keep the frontend stack current. (`#86`)
- The public roadmap was reorganized to accurately reflect what is shipped, in progress, and planned next. (`#87`)
- The latest weekly changelog entry was expanded to include newly merged work. (`#88`)
- Updated MCP release test tooling to Vitest 4.1.5 to keep development and CI behavior current. (`#94`)
- Upgraded TypeScript build test tooling to Vitest 4.1.5 for newer test framework behavior and fixes. (`#95`)
- Upgraded the web client icon library to lucide-react 1.11.0 to align with the latest icon package updates. (`#98`)
- Updated the web client build toolchain from Vite 7 to Vite 8 for current bundler and dev-server behavior. (`#97`)
- Updated core web client dependencies to newer non-major versions for improved compatibility and stability. (`#96`)

### Fixed
- Startup now remains stable when saved preferences contain unknown keys, and outdated entries are cleaned up automatically. (`#63`)
- Dependency vulnerabilities were remediated across packages to improve security and reduce exposure to known issues. (`#64`)
- Billing and managed account flows were hardened to block untrusted URLs and strengthen default security boundaries. (`#89`)
- Managed credits purchase routes now work out of the box again without requiring environment configuration changes. (`#90`)
- Improved first-run installation reliability by retrying transient Docker image pull failures and guiding users to resume safely if retries are exhausted. (`#93`)
- Provider credential and settings updates now take effect immediately, onboarding correctly flags missing setup, and chat shows clearer multi-line provider error guidance. (`#99`)

### Removed
- Removed the deprecated quickstart installation path and standardized install mode and location reporting across the app. (`#92`)

## [26.04.20] - 2026-04-20

### Added
- Prompt-driven onboarding todo seed for new users, including starter `me/todo.md` and base AGENT guidance updates. (`#55`)
- Automated production release runbook script with date-based version defaults (`installer/docker/scripts/release-production.sh`). (`#58`)
- Monday preflight release gate script for production image builds (`preflight-production-build.sh`). (`#62`)
- Dependabot configuration to automate dependency update PRs. (`#64`)
- Public **`AGENT.md`** boot file added at repository root. (`#56`)

### Changed
- Settings modal copy rewritten for clearer onboarding/setup guidance, including improved restore instructions. (`#50`)
- Chat experience updated with persistent activity indicator during file writes and improved post-interview flow/templates. (`#51`)
- Product image release-manifest signing/verification flow and docs refined for Docker release builds. (`#52`)
- Installer defaults now prefer `local` mode while preserving `quickstart` as a legacy alias across scripts, docs, and config surfaces. (`#57`)
- `.gitignore` now ignores local `.codex` workspace artifacts. (`#54`)
- Dependabot policy now groups npm updates by workspace and semver level (non-major vs major) to reduce one-off PR noise. (`#85`)
- `client_web` dependency bundle updated (grouped non-major): `@ai-sdk/react`, `react`, `react-dom`, `react-router-dom`, `@playwright/test`, `@tailwindcss/vite`, `jsdom`, `shadcn`, and `tailwindcss`. (`#86`)
- `ROADMAP.md` Phase 2 reorganized to reflect shipped state more accurately. (`#87`)

### Fixed
- BrainDrive managed Haiku model ID alignment with LiteLLM alias across adapters and starter defaults. (`#53`)
- BrainDrive API key validation before vault persistence, including clearer validation errors and post-update balance refresh behavior. (`#59`)
- Managed-mode starter pack no longer hardcodes `provider_base_urls`. (`#61`)
- SettingsModal TypeScript build blockers resolved in release preflight updates. (`#62`)
- Config loading now tolerates unknown preference keys and prunes stale preference entries (with tests). (`#63`)
- npm dependency vulnerabilities remediated across runtime/client/release packages. (`#64`)
- Client web test expectations updated for current Settings/Chat UI labels and streaming typing-indicator behavior. (`#86`)

### Removed
- No user-facing removals this week.

## [26.04.13] - 2026-04-13

### Added
- End-to-end **Memory Backup** capability: backup settings, `Save Now`, restore, scheduler (`after_changes`/`hourly`/`daily`), gateway routes, UI tab, docs, and tests. (`#41`)
- **Managed billing improvements**: credit top-up checkout flow and `/account/topup` gateway proxy support. (`#38`)
- **Managed session heartbeat** (periodic ping) to reduce idle stop risk for active users. (`#38`)
- **Required Terms of Service / Privacy Policy acceptance** checkbox on signup (submit disabled until accepted). (`#49`)
- New public **`ROADMAP.md`** plus README roadmap link and expanded developer-path docs. (direct commits `1c9a137`, `ea8500d`, `810230a`)
- Shared browser-open helpers for installer lifecycle scripts (`browser-helper.sh` / `browser-helper.ps1`). (`#47`)

### Changed
- Docker **`local` mode now uses prebuilt images** (no source build path), and startup update checks now run for `quickstart|prod|local`. (`#47`)
- Upgrade flow for `local` aligned to image-based pull/restart behavior. (`#47`)
- Default Anthropic model references changed from **Claude Sonnet 4.6** to **Claude Haiku 4.5** across adapter config, memory defaults, starter pack, and UI copy. (`#47`)
- Ollama defaults updated for Docker-host setups (`http://host.docker.internal:11434/v1`), with improved Settings URL-help UX and blank-model handling. (`#43`)
- Managed account usage UI aligned to LiteLLM spend/budget fields and top-up availability states. (`#38`)
- Package metadata/version artifacts moved to **26.4.8** in runtime + client package files. (`8ddd715`)
- `.gitignore` updated to ignore `docs/Security/`. (`5548171`)

### Fixed
- Context-window overflow handling: actionable recovery UX, near-limit warnings, and gateway-side compaction/summarization to prevent chat crash loops. (`#46`)
- Plus One sidebar flicker on chat-completion refresh and redundant active-project fetch churn. (`#44`)
- Managed logout/session behavior: logout now routes through gateway logout endpoint; managed 401 now redirects to `/login`. (`#38`)
- macOS installer compatibility issues (`cp -a`/`sed -i` portability), plus Apple Silicon default platform fallback handling for image modes. (`#42`, `0597c14`)
- Chat markdown rendering now strips leaked tool-call XML artifacts (`tool_call`, `function_calls`, `invoke`, `parameter`, including namespaced variants). (`#38`, `#40`)

### Removed
- Chat **write-approval cards** removed; default write flow shifted to auto-approve behavior. (`#45`)
- Outdated Monday operator checklist file and related installer README reference removed. (`#36`, `ae587f2`)
- `docs/planning/logging-option-a-b-work-log-2026-04-02.md` removed. (`#36`)
