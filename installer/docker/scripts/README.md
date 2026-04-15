# Installer Docker Scripts Reference

## Canonical Location

- Canonical script directory: `installer/docker/scripts`
- Canonical repo-root invocation style (shell): `./installer/docker/scripts/<name>.sh`
- Canonical repo-root invocation style (PowerShell): `.\installer\docker\scripts\<name>.ps1`
- All lifecycle and release scripts are implemented only in this directory.

## Scope and Intent

- This is the canonical operational reference for installer lifecycle and release scripts.
- Use this file as the source of truth for script behavior, arguments, and environment variables.

## Prerequisites

- Baseline for lifecycle scripts: Docker with Compose plugin (`docker compose`).
- For remote metadata/update flows: `curl` (shell) or `Invoke-WebRequest` (PowerShell).
- For signed-manifest flows: `cosign` (or auto-install via upgrade script where enabled).
- For manifest parsing in shell upgrade flow: `node` or `python3`.

## File Inventory (Kept)

- `backup.sh`
- `backup.ps1`
- `browser-helper.sh`
- `browser-helper.ps1`
- `build-release-images.sh`
- `build-release-images.ps1`
- `check-update.sh`
- `check-update.ps1`
- `fetch-release-metadata.sh`
- `fetch-release-metadata.ps1`
- `generate-release-manifest.sh`
- `generate-release-manifest.ps1`
- `install.sh`
- `install.ps1`
- `migration-export.sh`
- `migration-export.ps1`
- `migration-import.sh`
- `migration-import.ps1`
- `migration-smoke.sh`
- `migration-smoke.ps1`
- `publish-release-images.sh`
- `publish-release-images.ps1`
- `reset-new-user.sh`
- `reset-new-user.ps1`
- `restore.sh`
- `restore.ps1`
- `sign-release-manifest.sh`
- `sign-release-manifest.ps1`
- `smoke-test-release.sh`
- `smoke-test-release.ps1`
- `start.sh`
- `start.ps1`
- `stop.sh`
- `stop.ps1`
- `support-bundle.sh`
- `support-bundle.ps1`
- `upgrade.sh`
- `upgrade.ps1`
- `verify-release-manifest.sh`
- `verify-release-manifest.ps1`

## Mode Map

- `quickstart` -> `compose.quickstart.yml`
- `prod` -> `compose.prod.yml`
- `local` -> `compose.local.yml`
- `dev` -> `compose.dev.yml`

Notes:
- `install/start/stop` support `dev`.
- `check-update/upgrade` support `quickstart|prod|local`.

## Script Catalog

### install (`install.sh`, `install.ps1`)

What it does:
- First-run setup only.
- Creates `.env` from `.env.example`.
- Generates `PAA_SECRETS_MASTER_KEY_B64` if missing.
- Starts stack according to mode.
- In `prod`, validates `DOMAIN` and digest-ref pairing (`BRAINDRIVE_APP_REF` and `BRAINDRIVE_EDGE_REF`).

Usage:
- Shell: `./installer/docker/scripts/install.sh [quickstart|prod|local|dev]`
- PowerShell: `.\installer\docker\scripts\install.ps1 [-Mode quickstart|prod|local|dev]`

Arguments:
- `Mode` (default: `quickstart`)

Key behavior:
- Fails if `.env` already exists (protects existing account/secrets state).
- `dev` builds images.
- `quickstart`, `prod`, and `local` pull images.
- On Apple Silicon macOS, shell install defaults quickstart/prod/local pulls to `linux/amd64` unless `BRAINDRIVE_DOCKER_PLATFORM` is set.
- Always prints the access URL and attempts a best-effort browser auto-open on the host.

Env/config touched:
- Reads: `DOMAIN`, `BRAINDRIVE_APP_REF`, `BRAINDRIVE_EDGE_REF`, `BRAINDRIVE_DOCKER_PLATFORM`, `BRAINDRIVE_LOCAL_BIND_HOST`, `BRAINDRIVE_DEV_BIND_HOST`, `BRAINDRIVE_DEV_PORT`
- Writes: `.env`, `PAA_SECRETS_MASTER_KEY_B64` when missing

### start (`start.sh`, `start.ps1`)

What it does:
- Starts services for selected mode.
- Runs startup update policy check for `quickstart`, `prod`, and `local` before `docker compose up -d`.
- Creates required volumes in `dev` mode.

Usage:
- Shell: `./installer/docker/scripts/start.sh [quickstart|prod|local|dev]`
- PowerShell: `.\installer\docker\scripts\start.ps1 [-Mode quickstart|prod|local|dev]`

Arguments:
- `Mode` (default: `quickstart`)

Key behavior:
- `prod` requires `.env` and real `DOMAIN`.
- If `check-update` returns fail-closed errors, startup halts.
- Always prints the access URL and attempts a best-effort browser auto-open on the host.

Env/config read:
- `BRAINDRIVE_LOCAL_BIND_HOST`, `BRAINDRIVE_DEV_BIND_HOST`, `BRAINDRIVE_DEV_PORT`, `DOMAIN`, `BRAINDRIVE_DOCKER_PLATFORM`

### stop (`stop.sh`, `stop.ps1`)

What it does:
- Stops containers for selected compose stack and prints `docker compose ps`.

Usage:
- Shell: `./installer/docker/scripts/stop.sh [quickstart|prod|local|dev]`
- PowerShell: `.\installer\docker\scripts\stop.ps1 [-Mode quickstart|prod|local|dev]`

Arguments:
- `Mode` (default: `quickstart`)

### upgrade (`upgrade.sh`, `upgrade.ps1`)

What it does:
- Performs upgrade flow for `quickstart|prod|local`.
- Fetches remote metadata, resolves target refs, validates signatures (if required), then pulls and restarts.

Usage:
- Shell: `./installer/docker/scripts/upgrade.sh [quickstart|prod|local]`
- PowerShell: `.\installer\docker\scripts\upgrade.ps1 [-Mode quickstart|prod|local]`

Arguments:
- `Mode` (default: `quickstart`)

Important behavior:
- Supports dry-run check mode via `BRAINDRIVE_UPGRADE_DRY_RUN=true`.
- After non-dry-run completion, prints the access URL and attempts a best-effort browser auto-open on the host.
- Dry-run emits machine-readable fields:
- `CHECK_MODE=dry-run`
- `CHECK_TARGET_APP_REF`, `CHECK_TARGET_EDGE_REF`
- `CHECK_CURRENT_APP_REF`, `CHECK_CURRENT_EDGE_REF`
- `CHECK_RESOLVED_VERSION`
- `CHECK_UPDATE_AVAILABLE=true|false`
- Dry-run exit codes:
- `0` no update needed
- `10` update available

Key env vars:
- `BRAINDRIVE_UPGRADE_DRY_RUN`
- `BRAINDRIVE_APP_REF`, `BRAINDRIVE_EDGE_REF`
- `BRAINDRIVE_DOCKER_PLATFORM`
- `BRAINDRIVE_APP_IMAGE`, `BRAINDRIVE_EDGE_IMAGE`, `BRAINDRIVE_TAG`
- `BRAINDRIVE_RELEASE_MANIFEST`, `BRAINDRIVE_RELEASE_CHANNEL`, `BRAINDRIVE_RELEASE_VERSION`
- `BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE`
- `BRAINDRIVE_RELEASE_MANIFEST_SIG`, `BRAINDRIVE_RELEASE_PUBLIC_KEY`
- `BRAINDRIVE_COSIGN_BIN`, `BRAINDRIVE_AUTO_INSTALL_COSIGN`, `BRAINDRIVE_COSIGN_VERSION`, `BRAINDRIVE_COSIGN_BIN_DIR`
- `BRAINDRIVE_LAST_APPLIED_APP_REF`, `BRAINDRIVE_LAST_APPLIED_EDGE_REF` (dry-run fallback)

### check-update (`check-update.sh`, `check-update.ps1`)

What it does:
- Startup policy gate for upgrades.
- Applies update policy using precedence:
- Runtime env overrides
- Persistent config (`/data/memory/system/config/app-config.json`)
- `.env`
- Defaults
- Uses state tracking and lock to avoid concurrent checks.

Usage:
- Shell: `./installer/docker/scripts/check-update.sh [quickstart|prod|local]`
- PowerShell: `.\installer\docker\scripts\check-update.ps1 [-Mode quickstart|prod|local]`

Arguments:
- `Mode` (default: `quickstart`)

Policies supported:
- `auto-apply`
- `check-only`
- `windowed-apply`

Fail modes:
- `fail-open`
- `fail-closed`

Exit codes:
- `0` no update/disabled/deferred/fail-open continue
- `10` update available but deferred
- `20` update applied successfully
- `40` dry-run check failed in fail-closed mode
- `50` auto-apply failed in fail-closed mode

Key env vars:
- `BRAINDRIVE_STARTUP_UPDATE_CHECK`
- `BRAINDRIVE_UPDATES_ENABLED`
- `BRAINDRIVE_UPDATES_POLICY`
- `BRAINDRIVE_UPDATES_FAIL_MODE`
- `BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES`
- `BRAINDRIVE_UPDATES_WINDOW_ENABLED`
- `BRAINDRIVE_UPDATES_WINDOW_TIMEZONE`
- `BRAINDRIVE_UPDATES_WINDOW_DAYS`
- `BRAINDRIVE_UPDATES_WINDOW_START`
- `BRAINDRIVE_UPDATES_WINDOW_END`
- `BRAINDRIVE_UPGRADE_DRY_RUN` (used internally during check)

### fetch-release-metadata (`fetch-release-metadata.sh`, `fetch-release-metadata.ps1`)

What it does:
- Downloads release metadata files (manifest, signature, public key) from configured remote URLs.

Usage:
- Shell: `./installer/docker/scripts/fetch-release-metadata.sh`
- PowerShell: `.\installer\docker\scripts\fetch-release-metadata.ps1`

Arguments:
- None

Behavior:
- If all URLs missing, script exits successfully with skip message.
- If some URLs are set but not all three, script fails.

Required URL trio (set together):
- `BRAINDRIVE_RELEASE_MANIFEST_URL`
- `BRAINDRIVE_RELEASE_MANIFEST_SIG_URL`
- `BRAINDRIVE_RELEASE_PUBLIC_KEY_URL`

Optional destination path vars:
- `BRAINDRIVE_RELEASE_MANIFEST` (default `./release-cache/releases.json`)
- `BRAINDRIVE_RELEASE_MANIFEST_SIG` (default `./release-cache/releases.json.sig`)
- `BRAINDRIVE_RELEASE_PUBLIC_KEY` (default `./release-cache/cosign.pub`)

### backup (`backup.sh`, `backup.ps1`)

What it does:
- Creates tar.gz backups for `braindrive_memory` and `braindrive_secrets` volumes.

Usage:
- Shell: `./installer/docker/scripts/backup.sh [backup-dir]`
- PowerShell: `.\installer\docker\scripts\backup.ps1 [-BackupDir <path>]`

Arguments:
- Shell positional `backup-dir` (default: `installer/docker/backups`)
- PowerShell `-BackupDir` (default: `<current working directory>\backups`)

Output:
- `<volume>_<YYYYMMDD_HHMMSS>.tar.gz`

### migration-export (`migration-export.sh`, `migration-export.ps1`)

What it does:
- Calls the same Gateway API export endpoint used by the app (`GET /api/export`).
- Produces a migration archive `.tar.gz` for import into another instance.

Usage:
- Shell: `./installer/docker/scripts/migration-export.sh [output-file] [base-url]`
- PowerShell: `.\installer\docker\scripts\migration-export.ps1 [-OutputFile <path>] [-BaseUrl <url>] [-Mode dev|local|quickstart|prod]`

Authentication:
- Uses `BRAINDRIVE_MIGRATION_ACCESS_TOKEN` when set.
- Else logs in via `BRAINDRIVE_MIGRATION_IDENTIFIER` and `BRAINDRIVE_MIGRATION_PASSWORD`.
- Else falls back to local-owner headers (for `auth_mode=local-owner` only).

### migration-import (`migration-import.sh`, `migration-import.ps1`)

What it does:
- Calls the same Gateway API import endpoint used by the app (`POST /api/migration/import`).
- Restores memory + included secrets from a migration archive without container restart.

Usage:
- Shell: `./installer/docker/scripts/migration-import.sh <archive-file> [base-url]`
- PowerShell: `.\installer\docker\scripts\migration-import.ps1 -ArchiveFile <path> [-BaseUrl <url>] [-Mode dev|local|quickstart|prod]`

Authentication:
- Same credential resolution as `migration-export`.

### migration-smoke (`migration-smoke.sh`, `migration-smoke.ps1`)

What it does:
- Runs export then immediate import through Gateway API to verify migration path end-to-end.

Usage:
- Shell: `./installer/docker/scripts/migration-smoke.sh [mode] [base-url]`
- PowerShell: `.\installer\docker\scripts\migration-smoke.ps1 [-Mode dev|local|quickstart|prod] [-BaseUrl <url>]`

### support-bundle (`support-bundle.sh`, `support-bundle.ps1`)

What it does:
- Collects support diagnostics into a user-shareable archive.
- Captures docker compose logs (`--since <window>`) for stack services.
- Captures runtime metadata (mode, compose file, versions, compose state).
- Attempts optional health endpoint snapshots.
- Copies persisted audit JSONL files from `braindrive_memory:/diagnostics/audit` when present.
- Redacts common secret patterns before packaging.

Usage:
- Shell: `./installer/docker/scripts/support-bundle.sh [quickstart|prod|local|dev] [since-window] [output-dir]`
- PowerShell: `.\installer\docker\scripts\support-bundle.ps1 [-Mode quickstart|prod|local|dev] [-SinceWindow 24h] [-OutputDir <path>] [-SkipHealth]`

Arguments:
- `Mode` (default: `quickstart`)
- `SinceWindow` (default: `24h`)
- `OutputDir` (default: `installer/docker/support-bundles`)

Optional behavior:
- Shell health snapshots can be disabled with `BRAINDRIVE_SUPPORT_BUNDLE_SKIP_HEALTH=true`

### restore (`restore.sh`, `restore.ps1`)

What it does:
- Restores one volume (`memory` or `secrets`) from backup archive.
- Brings selected stack down, restores volume contents, and starts stack again.
- After completion, prints the access URL and attempts a best-effort browser auto-open on the host.

Usage:
- Shell: `./installer/docker/scripts/restore.sh <memory|secrets> <backup-file> [quickstart|prod|local]`
- PowerShell: `.\installer\docker\scripts\restore.ps1 -Target <memory|secrets> -BackupFile <path> [-Mode quickstart|prod|local]`

Arguments:
- `Target`: `memory` or `secrets`
- `BackupFile`: required path to `.tar.gz`
- `Mode`: `quickstart`, `prod`, or `local` (default `prod`)

### reset-new-user (`reset-new-user.sh`, `reset-new-user.ps1`)

What it does:
- Resets local new-user test state.
- Runs `docker compose -f compose.local.yml down -v --remove-orphans`.
- Optional fresh-clone cleanup removes `.env` and local images.

Usage:
- Shell: `./installer/docker/scripts/reset-new-user.sh [--yes|-y] [--fresh-clone] [--help|-h]`
- PowerShell: `.\installer\docker\scripts\reset-new-user.ps1 [-Yes] [-FreshClone]`

Options:
- `--yes` / `-Yes`: skip confirmation prompt
- `--fresh-clone` / `-FreshClone`: also remove `.env` and remove local images best effort
- `--help` / `-h`: print usage and exit (shell script)

### build-release-images (`build-release-images.sh`, `build-release-images.ps1`)

What it does:
- Builds release images from repo root using `installer/docker/Dockerfile.app` and `installer/docker/Dockerfile.edge`.

Usage:
- Shell: `./installer/docker/scripts/build-release-images.sh <version>`
- PowerShell: `.\installer\docker\scripts\build-release-images.ps1 -Version <version>`

Arguments:
- `Version`: required tag (for example `v0.1.0`)

Env vars:
- `REPO_ROOT` (shell only override)
- `REGISTRY` (default `ghcr.io/braindrive-ai`)
- `APP_IMAGE` (default `${REGISTRY}/braindrive-app`)
- `EDGE_IMAGE` (default `${REGISTRY}/braindrive-edge`)

### publish-release-images (`publish-release-images.sh`, `publish-release-images.ps1`)

What it does:
- Pushes tagged images.
- Resolves digests via `docker buildx imagetools inspect`.
- Prints digest-pinned refs (`APP_REF=...@sha256:...`, `EDGE_REF=...@sha256:...`).

Usage:
- Shell: `./installer/docker/scripts/publish-release-images.sh <version>`
- PowerShell: `.\installer\docker\scripts\publish-release-images.ps1 -Version <version>`

Arguments:
- `Version`: required tag

Env vars:
- `REGISTRY` (default `ghcr.io/braindrive-ai`)
- `APP_IMAGE` (default `${REGISTRY}/braindrive-app`)
- `EDGE_IMAGE` (default `${REGISTRY}/braindrive-edge`)

### generate-release-manifest (`generate-release-manifest.sh`, `generate-release-manifest.ps1`)

What it does:
- Generates `releases.json` payload describing channel->version and digest refs.
- Supports unsigned placeholder or signed payload fields based on env vars.

Usage:
- Shell: `./installer/docker/scripts/generate-release-manifest.sh <version> <app-ref> <edge-ref> [channel] [output-path]`
- PowerShell: `.\installer\docker\scripts\generate-release-manifest.ps1 -Version <version> -AppRef <app-ref> -EdgeRef <edge-ref> [-Channel stable] [-Output .\releases.json]`

Arguments:
- `Version`, `AppRef`, `EdgeRef` required
- `Channel` optional (default `stable`)
- `Output` optional

Optional signing metadata env vars:
- `MANIFEST_SIGNATURE_ALGORITHM`
- `MANIFEST_SIGNATURE_KEY_ID`
- `MANIFEST_SIGNATURE_VALUE`

### sign-release-manifest (`sign-release-manifest.sh`, `sign-release-manifest.ps1`)

What it does:
- Signs manifest with cosign key-pair flow and writes detached signature file.

Usage:
- Shell: `./installer/docker/scripts/sign-release-manifest.sh [manifest-path] [signature-path]`
- PowerShell: `.\installer\docker\scripts\sign-release-manifest.ps1 [-ManifestPath .\releases.json] [-SignaturePath .\releases.json.sig]`

Arguments:
- `ManifestPath` optional (default `./releases.json`)
- `SignaturePath` optional (default `./releases.json.sig`)

Env vars:
- `COSIGN_KEY_PATH` (default `./cosign.key`)
- `COSIGN_PASSWORD` (recommended in non-interactive/CI flows for encrypted keys)
- `BRAINDRIVE_COSIGN_BIN` (optional explicit cosign binary path)
- `BRAINDRIVE_AUTO_INSTALL_COSIGN` (shell script only; default `true`)
- `BRAINDRIVE_COSIGN_VERSION` (shell script only; optional version pin, default `latest`)
- `BRAINDRIVE_COSIGN_BIN_DIR` (shell script only; optional auto-install target dir, default `$HOME/.local/bin`)

### verify-release-manifest (`verify-release-manifest.sh`, `verify-release-manifest.ps1`)

What it does:
- Verifies detached manifest signature using cosign public key.

Usage:
- Shell: `./installer/docker/scripts/verify-release-manifest.sh [manifest-path] [signature-path] [public-key-path]`
- PowerShell: `.\installer\docker\scripts\verify-release-manifest.ps1 [-ManifestPath .\releases.json] [-SignaturePath .\releases.json.sig] [-PublicKeyPath .\cosign.pub]`

Arguments:
- `ManifestPath` optional
- `SignaturePath` optional
- `PublicKeyPath` optional

Env vars:
- `BRAINDRIVE_COSIGN_BIN` (optional explicit cosign binary path)
- `BRAINDRIVE_AUTO_INSTALL_COSIGN` (shell script only; default `true`)
- `BRAINDRIVE_COSIGN_VERSION` (shell script only; optional version pin, default `latest`)
- `BRAINDRIVE_COSIGN_BIN_DIR` (shell script only; optional auto-install target dir, default `$HOME/.local/bin`)

### smoke-test-release (`smoke-test-release.sh`, `smoke-test-release.ps1`)

What it does:
- Performs basic HTTP health check against deployed base URL.

Usage:
- Shell: `./installer/docker/scripts/smoke-test-release.sh <base-url>`
- PowerShell: `.\installer\docker\scripts\smoke-test-release.ps1 -BaseUrl <base-url>`

Arguments:
- `BaseUrl` required

Behavior:
- Requests `<base-url>/health` and fails on non-success.

## Operational Notes

- Most scripts `cd` to `installer/docker` internally before running compose operations.
- If running from repo root, canonical invocation should remain explicit (`./installer/docker/scripts/...`) to avoid ambiguity.
- `start` in `quickstart/prod/local` is update-policy aware through `check-update`.
- `check-update` and `upgrade` form a contract via dry-run fields and exit codes.
