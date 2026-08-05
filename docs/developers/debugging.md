# Safe debugging and failure evidence

<!-- catalog-contract:start safe-debugging -->
> **Document contract**
> - Purpose: Classify development failures, collect minimum safe evidence, and recover without damaging owner or pre-existing state.
> - Audience: First-time contributors, Recurring contributors, Maintainers, Security researchers, AI coding agents, Verification agents and human reviewers.
> - Status: Current on `dev`; Milestone 2.
> - Owner role: documentation-maintainers.
> - Expected outcome: A contributor identifies the failing layer and supplies sanitized, reproducible evidence with bounded recovery.
> - Prerequisites: Authorization for the environment and data under test; Applicable setup guide.
> - Parent: [docs/developers/README.md](./README.md).
> - Adjacent topics: [Change verification](./verification.md); [Native TypeScript and web development](./setup/native.md); [Docker development with hot reload](./setup/docker-development.md); [Tauri desktop development](./setup/tauri-desktop.md); [Repository security](../repository-security.md).
> - Keywords: `safe debugging`, `failure classification`, `sanitized evidence`, `recovery`.
> - Sources: [`builds/typescript/scripts/dev-runtime.mjs`](../../builds/typescript/scripts/dev-runtime.mjs); [`installer/docker/compose.dev.yml`](../../installer/docker/compose.dev.yml); [`builds/typescript/src-tauri/src/main.rs`](../../builds/typescript/src-tauri/src/main.rs).
> - Tests: [`tools/docs/test/developer-journeys.test.mjs`](../../tools/docs/test/developer-journeys.test.mjs); [`tools/docs/test/evidence-harness.test.mjs`](../../tools/docs/test/evidence-harness.test.mjs).
<!-- catalog-contract:end safe-debugging -->

Start at the first failed observable. Do not jump from “the app does not work” to provider, memory, or auth conclusions. Preserve the starting state and distinguish a basic startup failure from later integration behavior.

## Failure classification

| Class | Typical observable | Safe first check | Bounded next step |
|---|---|---|---|
| Prerequisite | Executable, daemon, compiler, WebView, or display missing | Record command existence and version only | Install the documented prerequisite or move to a supported environment |
| Dependency | `npm ci`, registry, lockfile, image pull, or Cargo dependency fails | Record exit and package/image step without credentials or private registry URLs | Check network/proxy and lockfile; do not hand-edit generated dependencies |
| Port conflict | Bind reports address in use | Record port and sanitized process/container identity | Stop only a process you own or use a documented override; never kill an unidentified listener |
| Build/typecheck | TypeScript, lint, Vite, Rust compile, or link fails | Record command, first actionable diagnostic, and affected path | Fix source/config; rerun focused then broader check |
| Startup/health | MCP, gateway, Compose health, Vite, or desktop readiness times out | Identify the first unhealthy service | Inspect only that service's bounded sanitized output |
| Provider | Shell is ready but a model/provider request fails | Record provider profile name, failure category, and whether the check was authorized | Validate provider configuration separately; do not expose credentials |
| Authentication | Local signup/login/session or managed boundary fails | Record mode, endpoint category, status code, and synthetic account state | Follow auth source/tests; never include session tokens or owner identifiers |
| Migration/data | Import, export, restore, history, or file behavior fails | Stop before retrying; record target class and backup/rollback state | Use an isolated fixture or authorized recovery procedure; do not experiment on owner data |

## Minimum sanitized evidence

Collect only what another contributor needs to reproduce the failing class:

- candidate revision and dirty/clean scope without diff contents unrelated to the task;
- OS, architecture, and relevant tool versions;
- selected deployment/install/auth mode without private environment values;
- exact command and working directory;
- expected result and first failed observable;
- exit code, test counts, or sanitized service state;
- interventions, prior state, cleanup, and remaining risk.

Prefer structured status and focused test output over full logs. Replace owner names, hostnames, addresses, repository URLs, and filesystem roots with descriptive placeholders. Keep raw evidence in an authorized restricted system when policy requires it; public records contain only sanitized summaries.

## Do not collect

- `.env` contents, environment dumps, vault/key files, provider credentials, session or transport tokens;
- ignored owner memory, backups, desktop owner data, private planning paths, or unrestricted support bundles;
- full HTTP headers, request bodies, chat content, account identifiers, or provider payloads;
- private hostnames, network identifiers, production details, signing material, or vulnerability reproduction secrets;
- destructive “cleanup” output that was not explicitly authorized.

Do not run `env`, `set`, broad recursive searches, or raw container-log collection as a first diagnostic. Query the exact non-sensitive fact instead—for example, whether a prerequisite command exists or whether a named service is healthy.

## Journey-specific order

### Native

Check MCP startup order, then gateway health, then Vite binding. The supervisor prefixes child output and shuts children down on `SIGINT`/`SIGTERM`. A later provider error is outside the startup baseline.

### Docker dev

Check Docker/Compose availability, resolved service state, app health, then web state. `docker compose ps` is safer than broad logs. If logs are necessary, bound them to the failing service and time window, review locally, and copy only a redacted excerpt.

### Tauri desktop

Run preflight separately. Then distinguish Vite, Rust compile/link, graphical display, embedded MCP, embedded gateway, desktop transport handoff, and window readiness. After runtime readiness, verify that the frontend recognized Tauri and changed `/api` requests from the Vite proxy to the dynamic gateway returned by `get_runtime_status`. Record only the state transition and success/failure category—never the desktop transport credential or full runtime-status payload. A native window plus healthy embedded services is not sufficient if client requests still reach Vite's proxy. Use task-specific desktop data/log roots for controlled evidence rather than opening existing owner logs.

## Recovery tiers

- Tier A recovery corrects source, config, or prerequisites and reruns a safe check.
- Tier B recovery stops task-owned processes/containers and removes only explicit task-owned temporary state.
- Tier C recovery includes reset, volume deletion, restore/import, production/managed changes, provider credentials, or release operations. It requires separate authority and a rollback plan.

If ownership, target, or rollback is unclear, stop. A blocker is more accurate than a destructive guess.
