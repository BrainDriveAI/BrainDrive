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
