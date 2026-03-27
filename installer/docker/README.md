# BrainDrive Production Docker Installer

This directory contains the production-oriented Docker setup described in `production-docker-plan.md`.

## Supported launch points
You can run installer commands from any of these directories:
- Repo root: `/home/hex/Project/BrainDrive-Test-01`
- Installer root: `/home/hex/Project/BrainDrive-Test-01/installer`
- Docker installer dir: `/home/hex/Project/BrainDrive-Test-01/installer/docker`

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

## Local no-domain mode
For local smoke testing without TLS/domain setup:
1. Prepare `installer/docker/.env` (as shown above).
2. Run local mode from any supported launch point:
   - Repo root: `./scripts/install.sh local`
   - Installer root: `./scripts/install.sh local`
   - Docker installer dir: `./scripts/install.sh local`
3. Open `http://127.0.0.1:8080`

Local mode builds images from this repo (`Dockerfile.app` + `Dockerfile.edge`) and does not require registry pull access.
By default, first signup is allowed from any host/IP in this installer profile (`PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP=true`).

## Files
- `compose.prod.yml`: production stack (app + edge, TLS via Caddy).
- `compose.local.yml`: local-only stack (HTTP on 127.0.0.1:8080).
- `.env.example`: required/optional runtime values.
- `Caddyfile`: production routing and TLS.
- `Caddyfile.local`: local HTTP routing.
- `Dockerfile.app`: production app image pipeline (gateway + MCP in one container).
- `Dockerfile.edge`: production edge image pipeline (static web assets + Caddy).
- `entrypoint.sh`: app startup orchestration for MCP + gateway.
- `scripts/*`: install, upgrade, backup, and restore helpers.

## Image publishing flow (maintainer)
These Dockerfiles assume build context is repository root containing `builds/` and `installer/docker/`.

Build and tag:
```bash
docker build -f installer/docker/Dockerfile.app -t ghcr.io/braindrive-ai/braindrive-app:v0.1.0 .
docker build -f installer/docker/Dockerfile.edge -t ghcr.io/braindrive-ai/braindrive-edge:v0.1.0 .
```

Push:
```bash
docker push ghcr.io/braindrive-ai/braindrive-app:v0.1.0
docker push ghcr.io/braindrive-ai/braindrive-edge:v0.1.0
```

Then set in `.env`:
- `BRAINDRIVE_TAG=v0.1.0`

## Operations
- Start (no rebuild): `./scripts/start.sh local`
- Stop: `./scripts/stop.sh local`
- Repo-root and installer-root wrappers default to `local` when mode is omitted.
- Upgrade: `./scripts/upgrade.sh`
- Backup: `./scripts/backup.sh`
- Restore: `./scripts/restore.sh memory <backup-file>` or `./scripts/restore.sh secrets <backup-file>`
- Reset new-user test state (with confirmation): `./scripts/reset-new-user.sh`
  - Add `--yes` to skip prompt
  - Add `--fresh-clone` to also remove local `.env` and local images
- Windows equivalents:
  - Start: `./scripts/start.ps1 local`
  - Stop: `./scripts/stop.ps1 local`
  - Install: `./scripts/install.ps1`
  - Upgrade: `./scripts/upgrade.ps1`
  - Backup: `./scripts/backup.ps1`
  - Restore: `./scripts/restore.ps1 -Target memory -BackupFile <backup-file>`
  - Reset new-user state: `./scripts/reset-new-user.ps1` (supports `-Yes` and `-FreshClone`)

## Notes
- Data is persisted in named volumes: `braindrive_memory` and `braindrive_secrets`.
- Keep a secure backup of `PAA_SECRETS_MASTER_KEY_B64`. Losing it may make encrypted secrets unreadable.
- To enforce stricter first-account protection, set `PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP=false` and use `PAA_AUTH_BOOTSTRAP_TOKEN`.
