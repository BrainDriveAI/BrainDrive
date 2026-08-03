# BrainDrive Production Docker Installer

This directory contains the production-oriented Docker setup for BrainDrive.

Developer orientation: use the [developer index](../../docs/developers/README.md), [repository map](../../docs/developers/repository-map.md), and [Docker architecture boundary](../../docs/developers/architecture/README.md#docker-and-installer). This page remains the source-adjacent operational authority for Docker dev, local, and prod modes.

## Supported launch points

The scripts exist only under `installer/docker/scripts/`. Use one of these truthful forms:

- Repository root: `./installer/docker/scripts/<script>.sh` or `.\installer\docker\scripts\<script>.ps1`.
- `installer/docker/`: `./scripts/<script>.sh` or `.\scripts\<script>.ps1`.

There is no repository-root `scripts/` directory and no `installer/scripts/` directory. The [scripts README](scripts/README.md) owns exact arguments and side effects.

## GitHub Bootstrap (No Clone)
For non-technical users, publish and use the bootstrap scripts from this repo:
- `installer/bootstrap/install.sh`
- `installer/bootstrap/install.ps1`
- `installer/bootstrap/update.sh`
- `installer/bootstrap/update.ps1`

Recommended command examples:
- macOS/Linux:
  - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/install.sh | bash`
- Windows PowerShell:
  - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/install.ps1 | iex`

Quick update commands:
- macOS/Linux:
  - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/update.sh | bash`
- Windows PowerShell:
  - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/update.ps1 | iex`

Bootstrap behavior:
1. Downloads an installer archive and `SHA256SUMS` from the pinned release tag.
2. Verifies the archive checksum before extraction.
3. Installs or refreshes local installer files under `~/.braindrive/installer/docker`.
4. Runs installer in `local` mode by default (no domain required, pulls published images).
5. `prod` is supported as an explicit mode override.

Optional bootstrap overrides:
- `BRAINDRIVE_BOOTSTRAP_REPO` (default: `BrainDriveAI/BrainDrive`)
- `BRAINDRIVE_BOOTSTRAP_RELEASE_TAG` (default: release tag embedded in the script)
- `BRAINDRIVE_BOOTSTRAP_ARCHIVE_NAME` (default: `braindrive-installer-<release-tag>.tar.gz`)
- `BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL` (full custom tarball URL)
- `BRAINDRIVE_BOOTSTRAP_SHA256SUMS_URL` (full custom checksum-list URL)
- `BRAINDRIVE_INSTALL_ROOT` (default: `~/.braindrive`)
- `BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH=true` (force re-download and refresh)

## Local Quick Start (Open-WebUI style)
For a one-line, no-clone install that does not require DNS/TLS setup:
1. macOS/Linux:
   - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/install.sh | bash`
2. Windows PowerShell:
   - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/install.ps1 | iex`
3. Open:
   - `http://127.0.0.1:8080`

This mode uses prebuilt images and `compose.local.yml`.
Lifecycle scripts now always print the access URL and attempt a best-effort browser auto-open on the host.

## Production Bootstrap
For real public HTTPS deployments:
1. macOS/Linux:
   - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/install.sh | bash -s -- prod`
2. Windows PowerShell:
   - `$env:BRAINDRIVE_BOOTSTRAP_MODE='prod'; irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/install.ps1 | iex`
3. Set `DOMAIN` in `~/.braindrive/installer/docker/.env` before first production run.

Production install, start, and upgrade generate `PAA_AUTH_BOOTSTRAP_TOKEN` when it is missing and force `PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP=false`. The token is stored in `.env` and is never printed by the lifecycle scripts. On the first account-creation screen, copy the `PAA_AUTH_BOOTSTRAP_TOKEN` value from the production installer `.env` into the **Bootstrap token** field. Treat it like a password and do not share it or include it in logs.

## What users run (production)

Use the pinned [production bootstrap](#production-bootstrap) above for the normal no-clone production journey. This Milestone 2 developer guide does not validate or authorize a clone-based production first run. The lifecycle scripts still exist only at the [supported launch points](#supported-launch-points), and `install` remains first-run only: if `.env` already exists, it exits to protect account and secrets state.

## Local image mode
For local runs on prebuilt images (stable-style HTTP on localhost):
1. Run the first-install command from a supported launch point; it creates the protected `.env` itself:
   - Repository root: `./installer/docker/scripts/install.sh local`
   - Docker installer directory: `./scripts/install.sh local`
2. Open `http://127.0.0.1:8080` (default bind).
3. Optional LAN access: set `BRAINDRIVE_LOCAL_BIND_HOST=0.0.0.0` in `.env`, then restart/start local mode and open `http://<this-machine-ip>:8080` from another device on your network.

Local mode uses prebuilt images (same image/ref controls as local/prod) and does require registry pull access.
First signup defaults to loopback-only in this installer profile. Complete owner signup from the host before enabling LAN access.

## Developer hot-reload mode

The canonical developer journey, prerequisites, provider-independent baseline, failure classes, and cleanup contract are in [Docker development with hot reload](../../docs/developers/setup/docker-development.md). This overview owns only mode distinctions and operator context.

For an existing initialized installation:

1. From the repository root, run `./installer/docker/scripts/start.sh dev`.
2. Or from `installer/docker/`, run `./scripts/start.sh dev`.
3. Open the printed dev URL.

How dev mode works:
- Backend runs with `tsx watch` against mounted source.
- Web client runs Vite dev server with HMR.
- API calls proxy from Vite to backend (`/api` -> app service).
- Runtime memory is a host bind mount from `PAA_LIBRARY_HOST_PATH` (defaulting to the repository development memory fixture); secrets use the external `braindrive_secrets` volume. The app and web dependency trees use separate named volumes.
- App startup recursively changes ownership of the active memory bind, secrets/dependency state, and temporary home to `BRAINDRIVE_DEV_HOST_UID` / `BRAINDRIVE_DEV_HOST_GID` (default `1000`). Authorize the exact bind target and UID/GID before starting. Both containers run `npm install` from bind-mounted workspaces, so review package metadata and lockfiles after a recreate.
- Compose creates or reuses `braindrive_dev_default`; only Vite is host-bound, and its `/api` route proxies to the internal app.
- Startup update checks are not used in dev mode.

Optional LAN access for dev UI:
- Set `BRAINDRIVE_DEV_BIND_HOST=0.0.0.0` in `.env`, restart dev mode, then open `http://<this-machine-ip>:5073`.
- This exposes the non-TLS Vite shell and proxied gateway API to the LAN. Use only on a trusted network after checking local-auth state; it is not production/public exposure guidance.

If file watching is unreliable (WSL/network mounts), enable polling in `.env`:
- `BRAINDRIVE_DEV_CHOKIDAR_POLLING=true`
- `BRAINDRIVE_DEV_WATCHPACK_POLLING=true`

## Files
- `compose.prod.yml`: production stack (app + edge, TLS via Caddy).
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
- Optional platform override (local/prod image modes):
  - `BRAINDRIVE_DOCKER_PLATFORM=linux/amd64`

Optional (recommended for production): pin immutable image refs by digest in `.env`:
- `BRAINDRIVE_APP_REF=ghcr.io/braindriveai/braindrive-app@sha256:<digest>`
- `BRAINDRIVE_EDGE_REF=ghcr.io/braindriveai/braindrive-edge@sha256:<digest>`

If you set one `*_REF`, set both.
When refs are set, compose uses them instead of `BRAINDRIVE_*_IMAGE + BRAINDRIVE_TAG`.
On Apple Silicon macOS, shell scripts automatically default local/prod image runs to
`linux/amd64` when no explicit platform override is set.

Signed manifest-driven digest resolution (for first installs and upgrades):
- `BRAINDRIVE_RELEASE_MANIFEST=./release-cache/releases.json`
- `BRAINDRIVE_RELEASE_MANIFEST_SIG=./release-cache/releases.json.sig`
- `BRAINDRIVE_RELEASE_PUBLIC_KEY=./release-cache/cosign.pub`
- `BRAINDRIVE_RELEASE_MANIFEST_URL=https://github.com/BrainDriveAI/BrainDrive/releases/latest/download/releases.json`
- `BRAINDRIVE_RELEASE_MANIFEST_SIG_URL=https://github.com/BrainDriveAI/BrainDrive/releases/latest/download/releases.json.sig`
- `BRAINDRIVE_RELEASE_PUBLIC_KEY_URL=https://github.com/BrainDriveAI/BrainDrive/releases/latest/download/cosign.pub`
- `BRAINDRIVE_RELEASE_CHANNEL=stable`
- `BRAINDRIVE_RELEASE_VERSION=` (optional explicit version override)
- `BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE=true`
- `BRAINDRIVE_AUTO_INSTALL_COSIGN=true` (auto-download the pinned, checksummed cosign binary if missing)
- `BRAINDRIVE_COSIGN_VERSION=v3.0.6` (the only auto-installable version; use `BRAINDRIVE_COSIGN_BIN` for another version)
- `BRAINDRIVE_COSIGN_BIN_DIR=` (optional install location override)
- `BRAINDRIVE_COSIGN_BIN=` (optional explicit cosign binary path)

If refs are not set and a manifest is configured, install and upgrade scripts resolve
`BRAINDRIVE_APP_REF` and `BRAINDRIVE_EDGE_REF` from the manifest.
If signature verification is required, both paths run `cosign verify-blob` before any image pull.
If `cosign` is missing, the scripts auto-install pinned v3.0.6 by default and verify its embedded platform checksum before execution.
Current helper scripts use key-pair signature verification (trusted public key) without transparency log lookup.
Install and upgrade auto-fetch metadata from configured release URLs into local `release-cache` so normal users do not need manual `.env` edits for each release.
Start in local/prod now runs startup update policy checks before compose up. Settings are resolved in this order: runtime env override, persistent `/data/memory/system/config/app-config.json`, `.env`, then defaults.
Lifecycle scripts that start/restart services (`install`, `start`, `upgrade`, `restore`) always print the URL and attempt browser auto-open; if auto-open fails, users can still use the printed URL.

## Operations

The relative commands in this section use `installer/docker/` as their working directory. From the repository root, prefix them with `./installer/docker/` as shown under [supported launch points](#supported-launch-points).
- Start (local): `./scripts/start.sh local`
  - Runs startup update check first (policy-driven), then starts containers.
- Stop (local): `./scripts/stop.sh local`
- Upgrade (local): `./scripts/upgrade.sh local`
- Start (developer hot reload): `./scripts/start.sh dev`
- Stop (developer hot reload): `./scripts/stop.sh dev`
- Upgrade (prod): `./scripts/upgrade.sh prod`
- Check update now (without start):
  - `./scripts/check-update.sh local`
  - `./scripts/check-update.sh prod`
- Fetch remote metadata now (optional manual run, also done automatically in prod/local upgrade):
  - `./scripts/fetch-release-metadata.sh`
- Upgrade with explicit refs (one-shot, without editing `.env`):
  - `BRAINDRIVE_APP_REF=ghcr.io/braindriveai/braindrive-app@sha256:<digest> BRAINDRIVE_EDGE_REF=ghcr.io/braindriveai/braindrive-edge@sha256:<digest> ./scripts/upgrade.sh`
- Backup: `./scripts/backup.sh`
- Migration export (same method as app UI): `./scripts/migration-export.sh [output-file] [base-url]`
- Migration import (same method as app UI): `./scripts/migration-import.sh <archive-file> [base-url]`
- Migration smoke test (export + import roundtrip): `./scripts/migration-smoke.sh [dev|local|prod] [base-url]`
- Support bundle (logs + metadata + audit JSONL): `./scripts/support-bundle.sh [local|prod|dev] [24h]`
- Restore:
  - Local: `./scripts/restore.sh memory <backup-file> local`
  - Prod: `./scripts/restore.sh memory <backup-file> prod`
- Reset new-user test state (with confirmation): `./scripts/reset-new-user.sh`
  - Add `--yes` to skip prompt
  - Add `--fresh-clone` to also remove local `.env` and local images
- Windows equivalents:
  - Start local: `./scripts/start.ps1 local`
    - Runs startup update check first (policy-driven), then starts containers.
  - Stop local: `./scripts/stop.ps1 local`
  - Start developer hot reload: `./scripts/start.ps1 dev`
  - Stop developer hot reload: `./scripts/stop.ps1 dev`
  - Install: `./scripts/install.ps1`
  - Upgrade: `./scripts/upgrade.ps1`
  - Check update now:
    - `./scripts/check-update.ps1 -Mode local`
    - `./scripts/check-update.ps1 -Mode prod`
  - Fetch remote metadata now (optional manual run, also done automatically in prod/local upgrade):
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
    - `./scripts/support-bundle.ps1 -Mode local -SinceWindow 24h`
  - Restore:
    - Local: `./scripts/restore.ps1 -Target memory -BackupFile <backup-file> -Mode local`
    - Prod: `./scripts/restore.ps1 -Target memory -BackupFile <backup-file> -Mode prod`
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
- The current `cosign.pub` SHA-256 (`c92a784be74b30f8e754e3025a11a7c69b44d620c8f0e21331b46e1772b179b6`) is embedded in bootstrap and installer trust helpers. Key rotation requires a reviewed code release that updates this fingerprint.
- For non-interactive signing (CI, no TTY), set `COSIGN_PASSWORD` when using an encrypted `cosign.key`.
- Shell release-sign/verify scripts support `BRAINDRIVE_COSIGN_BIN`. Automatic installation is restricted to cosign v3.0.6 and verifies an embedded platform SHA-256 before execution.

## Notes
- Local/prod data is persisted in named volumes `braindrive_memory` and `braindrive_secrets`. Docker dev uses the explicit bind/named-volume map in [Developer hot-reload mode](#developer-hot-reload-mode).
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
- Production requires `PAA_AUTH_BOOTSTRAP_TOKEN` and does not allow unrestricted first signup. Lifecycle scripts also add this protection to existing production `.env` files before start or upgrade.
