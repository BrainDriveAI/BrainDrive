# BrainDrive Production Docker Installer

This directory contains the production-oriented Docker setup for BrainDrive.

## Supported launch points
You can run installer commands from any of these directories:
- Repo root (e.g. `./scripts/install.sh local` or `./scripts/start.sh dev`)
- Installer root (e.g. `./installer/scripts/install.sh local` or `./installer/scripts/start.sh dev`)
- This directory (e.g. `./scripts/install.sh local` or `./scripts/start.sh dev`)

## GitHub Bootstrap (No Clone)
For non-technical users, publish and use the bootstrap scripts from this repo:
- `installer/bootstrap/install.sh`
- `installer/bootstrap/install.ps1`
- `installer/bootstrap/update.sh`
- `installer/bootstrap/update.ps1`

Recommended command examples:
- macOS/Linux:
  - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.sh | bash`
- Windows PowerShell:
  - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.ps1 | iex`

Quick update commands:
- macOS/Linux:
  - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/update.sh | bash`
- Windows PowerShell:
  - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/update.ps1 | iex`

Bootstrap behavior:
1. Downloads installer files from GitHub (`codeload` tarball by default).
2. Installs or refreshes local installer files under `~/.braindrive/installer/docker`.
3. Runs installer in `quickstart` mode by default (no domain required, pulls published images).
4. `prod` and `local` are supported as explicit mode overrides.

Optional bootstrap overrides:
- `BRAINDRIVE_BOOTSTRAP_REPO` (default: `BrainDriveAI/BrainDrive`)
- `BRAINDRIVE_BOOTSTRAP_REF` (default: `main`, can be version tag)
- `BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL` (full custom tarball URL)
- `BRAINDRIVE_INSTALL_ROOT` (default: `~/.braindrive`)
- `BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH=true` (force re-download and refresh)

## Quickstart (Open-WebUI style)
For a one-line, no-clone install that does not require DNS/TLS setup:
1. macOS/Linux:
   - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.sh | bash`
2. Windows PowerShell:
   - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.ps1 | iex`
3. Open:
   - `http://127.0.0.1:8080`

This mode uses prebuilt images and `compose.quickstart.yml`.

## Production Bootstrap
For real public HTTPS deployments:
1. macOS/Linux:
   - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.sh | bash -s -- prod`
2. Windows PowerShell:
   - `$env:BRAINDRIVE_BOOTSTRAP_MODE='prod'; irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.ps1 | iex`
3. Set `DOMAIN` in `~/.braindrive/installer/docker/.env` before first production run.

## What users run (production)
1. From repo root:
   - `cp installer/docker/.env.example installer/docker/.env`
   - `./scripts/install.sh` (Linux/macOS/WSL) or `./scripts/install.ps1` (Windows)
2. From `installer/`:
   - `cp docker/.env.example docker/.env`
   - `./scripts/install.sh` or `./scripts/install.ps1`
3. From `installer/docker/`:
   - `cp .env.example .env`
   - `./scripts/install.sh` or `./scripts/install.ps1`
4. Set `DOMAIN` and `PAA_SECRETS_MASTER_KEY_B64` in `installer/docker/.env` (script can auto-generate the key if missing).
5. Open `https://<DOMAIN>`

`install` is first-run only. If `.env` already exists, install exits to avoid accidental account/secrets invalidation.

## Local source-build mode
For local smoke testing from source (builds images from this repo):
1. Prepare `installer/docker/.env` (as shown above).
2. Run local mode from any supported launch point:
   - Repo root: `./scripts/install.sh local`
   - Installer root: `./scripts/install.sh local`
   - Docker installer dir: `./scripts/install.sh local`
3. Open `http://127.0.0.1:8080` (default bind).
4. Optional LAN access: set `BRAINDRIVE_LOCAL_BIND_HOST=0.0.0.0` in `.env`, then restart/start local mode and open `http://<this-machine-ip>:8080` from another device on your network.

Local mode builds images from this repo (`Dockerfile.app` + `Dockerfile.edge`) and does not require registry pull access.
By default, first signup is allowed from any host/IP in this installer profile (`PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP=true`).

## Developer hot-reload mode
For day-to-day development with fast feedback loops:
1. Prepare `installer/docker/.env` (run install once if needed to generate secrets key).
2. Start dev mode:
   - Repo root: `./scripts/start.sh dev`
   - Installer root: `./scripts/start.sh dev`
   - Docker installer dir: `./scripts/start.sh dev`
3. Open `http://127.0.0.1:5073` (default bind).

How dev mode works:
- Backend runs with `tsx watch` against mounted source.
- Web client runs Vite dev server with HMR.
- API calls proxy from Vite to backend (`/api` -> app service).
- Shared memory/secrets volumes are reused (`braindrive_memory`, `braindrive_secrets`).
- Startup update checks are not used in dev mode.

Optional LAN access for dev UI:
- Set `BRAINDRIVE_DEV_BIND_HOST=0.0.0.0` in `.env`, restart dev mode, then open `http://<this-machine-ip>:5073`.

If file watching is unreliable (WSL/network mounts), enable polling in `.env`:
- `BRAINDRIVE_DEV_CHOKIDAR_POLLING=true`
- `BRAINDRIVE_DEV_WATCHPACK_POLLING=true`

## Files
- `compose.prod.yml`: production stack (app + edge, TLS via Caddy).
- `compose.quickstart.yml`: image-based local HTTP stack (no DNS/TLS requirement).
- `compose.local.yml`: local stack (HTTP on `${BRAINDRIVE_LOCAL_BIND_HOST:-127.0.0.1}:8080`; set `0.0.0.0` for LAN access).
- `compose.dev.yml`: developer hot-reload stack (Vite UI on `${BRAINDRIVE_DEV_BIND_HOST:-127.0.0.1}:${BRAINDRIVE_DEV_PORT:-5073}`).
- `.env.example`: required/optional runtime values.
- `Caddyfile`: production routing and TLS.
- `Caddyfile.local`: local HTTP routing.
- `Dockerfile.app`: production app image pipeline (gateway + MCP in one container).
- `Dockerfile.edge`: production edge image pipeline (static web assets + Caddy).
- `entrypoint.sh`: app startup orchestration for MCP + gateway.
- `scripts/*`: install, upgrade, backup, restore, and startup update-check helpers.

## Image publishing flow (maintainer)
These Dockerfiles assume build context is repository root containing `builds/` and `installer/docker/`.

Build and tag:
```bash
docker build -f installer/docker/Dockerfile.app -t ghcr.io/braindriveai/braindrive-app:v0.1.0 .
docker build -f installer/docker/Dockerfile.edge -t ghcr.io/braindriveai/braindrive-edge:v0.1.0 .
```

Push:
```bash
docker push ghcr.io/braindriveai/braindrive-app:v0.1.0
docker push ghcr.io/braindriveai/braindrive-edge:v0.1.0
```

Then set in `.env`:
- `BRAINDRIVE_TAG=v0.1.0`

Optional (recommended for production): pin immutable image refs by digest in `.env`:
- `BRAINDRIVE_APP_REF=ghcr.io/braindriveai/braindrive-app@sha256:<digest>`
- `BRAINDRIVE_EDGE_REF=ghcr.io/braindriveai/braindrive-edge@sha256:<digest>`

If you set one `*_REF`, set both.
When refs are set, compose uses them instead of `BRAINDRIVE_*_IMAGE + BRAINDRIVE_TAG`.

Optional manifest-driven digest resolution (for upgrades):
- `BRAINDRIVE_RELEASE_MANIFEST=./release-cache/releases.json`
- `BRAINDRIVE_RELEASE_MANIFEST_SIG=./release-cache/releases.json.sig`
- `BRAINDRIVE_RELEASE_PUBLIC_KEY=./release-cache/cosign.pub`
- `BRAINDRIVE_RELEASE_MANIFEST_URL=https://github.com/BrainDriveAI/BrainDrive/releases/latest/download/releases.json`
- `BRAINDRIVE_RELEASE_MANIFEST_SIG_URL=https://github.com/BrainDriveAI/BrainDrive/releases/latest/download/releases.json.sig`
- `BRAINDRIVE_RELEASE_PUBLIC_KEY_URL=https://github.com/BrainDriveAI/BrainDrive/releases/latest/download/cosign.pub`
- `BRAINDRIVE_RELEASE_CHANNEL=stable`
- `BRAINDRIVE_RELEASE_VERSION=` (optional explicit version override)
- `BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE=true`
- `BRAINDRIVE_AUTO_INSTALL_COSIGN=true` (auto-download cosign if missing)
- `BRAINDRIVE_COSIGN_VERSION=latest` (optional version override)
- `BRAINDRIVE_COSIGN_BIN_DIR=` (optional install location override)
- `BRAINDRIVE_COSIGN_BIN=` (optional explicit cosign binary path)

If refs are not set and a manifest is configured, upgrade scripts resolve
`BRAINDRIVE_APP_REF` and `BRAINDRIVE_EDGE_REF` from the manifest.
If signature verification is required, upgrade scripts run `cosign verify-blob` before apply.
If `cosign` is missing, upgrade scripts now auto-install it by default (`BRAINDRIVE_AUTO_INSTALL_COSIGN=true`).
Current helper scripts use key-pair signature verification (trusted public key) without transparency log lookup.
Upgrade now auto-fetches metadata from configured release URLs into local `release-cache` so normal users do not need manual `.env` edits for each update.
Start in quickstart/prod now runs startup update policy checks before compose up. Settings are resolved in this order: runtime env override, persistent `/data/memory/system/config/app-config.json`, `.env`, then defaults.

## Operations
- Start (quickstart): `./scripts/start.sh quickstart`
  - Runs startup update check first (policy-driven), then starts containers.
- Stop (quickstart): `./scripts/stop.sh quickstart`
- Upgrade (quickstart): `./scripts/upgrade.sh quickstart`
- Start (source-build local): `./scripts/start.sh local`
- Stop (source-build local): `./scripts/stop.sh local`
- Start (developer hot reload): `./scripts/start.sh dev`
- Stop (developer hot reload): `./scripts/stop.sh dev`
- Upgrade (prod): `./scripts/upgrade.sh prod`
- Check update now (without start):
  - `./scripts/check-update.sh quickstart`
  - `./scripts/check-update.sh prod`
- Fetch remote metadata now (optional manual run, also done automatically in prod/quickstart upgrade):
  - `./scripts/fetch-release-metadata.sh`
- Upgrade with explicit refs (one-shot, without editing `.env`):
  - `BRAINDRIVE_APP_REF=ghcr.io/braindriveai/braindrive-app@sha256:<digest> BRAINDRIVE_EDGE_REF=ghcr.io/braindriveai/braindrive-edge@sha256:<digest> ./scripts/upgrade.sh`
- Backup: `./scripts/backup.sh`
- Migration export (same method as app UI): `./scripts/migration-export.sh [output-file] [base-url]`
- Migration import (same method as app UI): `./scripts/migration-import.sh <archive-file> [base-url]`
- Migration smoke test (export + import roundtrip): `./scripts/migration-smoke.sh [dev|local|quickstart|prod] [base-url]`
- Support bundle (logs + metadata + audit JSONL): `./scripts/support-bundle.sh [quickstart|prod|local|dev] [24h]`
- Restore:
  - Quickstart: `./scripts/restore.sh memory <backup-file> quickstart`
  - Prod: `./scripts/restore.sh memory <backup-file> prod`
  - Local: `./scripts/restore.sh memory <backup-file> local`
- Reset new-user test state (with confirmation): `./scripts/reset-new-user.sh`
  - Add `--yes` to skip prompt
  - Add `--fresh-clone` to also remove local `.env` and local images
- Windows equivalents:
  - Start quickstart: `./scripts/start.ps1 quickstart`
    - Runs startup update check first (policy-driven), then starts containers.
  - Stop quickstart: `./scripts/stop.ps1 quickstart`
  - Start local source-build: `./scripts/start.ps1 local`
  - Stop local source-build: `./scripts/stop.ps1 local`
  - Start developer hot reload: `./scripts/start.ps1 dev`
  - Stop developer hot reload: `./scripts/stop.ps1 dev`
  - Install: `./scripts/install.ps1`
  - Upgrade: `./scripts/upgrade.ps1`
  - Check update now:
    - `./scripts/check-update.ps1 -Mode quickstart`
    - `./scripts/check-update.ps1 -Mode prod`
  - Fetch remote metadata now (optional manual run, also done automatically in prod/quickstart upgrade):
    - `./scripts/fetch-release-metadata.ps1`
    - One-shot refs:
      - `$env:BRAINDRIVE_APP_REF='ghcr.io/braindriveai/braindrive-app@sha256:<digest>'; $env:BRAINDRIVE_EDGE_REF='ghcr.io/braindriveai/braindrive-edge@sha256:<digest>'; ./scripts/upgrade.ps1`
  - Backup: `./scripts/backup.ps1`
  - Migration export (same method as app UI):
    - `./scripts/migration-export.ps1 -Mode dev`
  - Migration import (same method as app UI):
    - `./scripts/migration-import.ps1 -ArchiveFile <archive-file> -Mode dev`
  - Migration smoke test:
    - `./scripts/migration-smoke.ps1 -Mode dev`
  - Support bundle (logs + metadata + audit JSONL):
    - `./scripts/support-bundle.ps1 -Mode quickstart -SinceWindow 24h`
  - Restore:
    - Quickstart: `./scripts/restore.ps1 -Target memory -BackupFile <backup-file> -Mode quickstart`
    - Prod: `./scripts/restore.ps1 -Target memory -BackupFile <backup-file> -Mode prod`
    - Local: `./scripts/restore.ps1 -Target memory -BackupFile <backup-file> -Mode local`
  - Reset new-user state: `./scripts/reset-new-user.ps1` (supports `-Yes` and `-FreshClone`)

## Memory Backup Setup (Operator Notes)

Memory backup configuration is managed in the app UI:

1. Open BrainDrive at `http://127.0.0.1:8080` (or your production URL).
2. Open **Settings -> Memory Backup**.
3. Set `Repository URL` to an HTTPS git URL (example: `https://github.com/<org>/<repo>.git`).
4. Set `Git Token (PAT/Classic)` and choose frequency:
   - `Manual`
   - `After changes`
   - `Every hour`
   - `Every day`
5. Click `Save Backup Settings`, then click `Save Now` to verify first push.
6. Confirm status fields in UI:
   - `Last successful save`
   - `Status` (`success`/`failed`) and error message if present

Validation rules and safety:

1. SSH remotes are intentionally unsupported for MVP (`git@...` / `ssh://...` rejected).
2. Embedded credentials in URL are rejected (`https://user:pass@...`).
3. Token is stored as vault secret reference; token plaintext is never returned in settings payload.

### Restore Semantics (Memory-Only)

`Restore from Backup Repo` restores memory files only.

1. Restores memory snapshot from fixed backup branch `braindrive-memory-backup`.
2. Uses staging + rollback safety so partial apply is avoided on failure.
3. Does **not** restore secrets from git backup.
4. Does **not** change runtime/adapter config.

### PAT Scope Guidance (GitHub MVP)

Use minimum required scope for pushes to your target repository:

1. Private repository: `repo`
2. Public repository only: `public_repo`

### Troubleshooting Common Backup Failures

1. `Authentication failed for the backup repository`
   - Verify PAT is valid and not expired.
   - Verify PAT scope includes required repo write access.
   - Verify the token owner has push permission to target repo.
2. `Backup repository was not found or is not accessible`
   - Confirm repository URL and visibility.
   - Confirm token owner can access that repository.
3. `Unable to reach the backup repository URL`
   - Verify URL host/path, DNS, outbound network, and proxy/firewall settings.
4. `Backup branch is not available in the configured repository` (restore)
   - Run `Save Now` first to create/sync backup branch.
5. `memory_backup.repository_url must use https://`
   - Replace SSH URL with HTTPS URL.

For a complete local validation flow, see:

- `docs/onboarding/getting-started-testing-openrouter-docker.md`

## Release helper scripts (maintainer)
These are in `installer/docker/scripts` and intended for release operations.

- Build images:
  - `./scripts/build-release-images.sh v0.1.0`
  - `./scripts/build-release-images.ps1 -Version v0.1.0`
- Push images and print digest refs:
  - `./scripts/publish-release-images.sh v0.1.0`
  - `./scripts/publish-release-images.ps1 -Version v0.1.0`
- Generate `releases.json` payload:
  - `./scripts/generate-release-manifest.sh v0.1.0 <app-ref> <edge-ref> stable ./releases.json`
  - `./scripts/generate-release-manifest.ps1 -Version v0.1.0 -AppRef <app-ref> -EdgeRef <edge-ref> -Channel stable -Output .\\releases.json`
- Sign manifest (`releases.json.sig`):
  - `./scripts/sign-release-manifest.sh ./releases.json ./releases.json.sig`
  - `./scripts/sign-release-manifest.ps1 -ManifestPath .\\releases.json -SignaturePath .\\releases.json.sig`
- Verify manifest signature:
  - `./scripts/verify-release-manifest.sh ./releases.json ./releases.json.sig ./cosign.pub`
  - `./scripts/verify-release-manifest.ps1 -ManifestPath .\\releases.json -SignaturePath .\\releases.json.sig -PublicKeyPath .\\cosign.pub`
- Smoke test:
  - `./scripts/smoke-test-release.sh https://<DOMAIN>`
  - `./scripts/smoke-test-release.ps1 -BaseUrl https://<DOMAIN>`

Cosign key setup (one-time per release signing identity):
- Generate key pair:
  - `cosign generate-key-pair`
- Keep `cosign.key` private in CI/secrets manager.
- Distribute `cosign.pub` as the trusted updater verification key.

## Notes
- Data is persisted in named volumes: `braindrive_memory` and `braindrive_secrets`.
- Structured audit logs are persisted to `memory/diagnostics/audit/YYYY-MM-DD(.N).jsonl` while still emitting to stdout.
- Audit retention/rotation env knobs:
  - `PAA_AUDIT_FILE_SINK_ENABLED` (default `true`)
  - `PAA_AUDIT_MAX_FILE_BYTES` (default `5242880`)
  - `PAA_AUDIT_RETENTION_DAYS` (default `14`)
- Support bundle API endpoints are enabled only in `auth_mode=local` (JWT) and return `403` in `local-owner` mode:
  - `POST /api/support/bundles`
  - `GET /api/support/bundles`
  - `GET /api/support/bundles/:fileName`
- Keep a secure backup of `PAA_SECRETS_MASTER_KEY_B64`. Losing it may make encrypted secrets unreadable.
- To enforce stricter first-account protection, set `PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP=false` and use `PAA_AUTH_BOOTSTRAP_TOKEN`.
