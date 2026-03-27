# BrainDrive MVP Production Docker Plan (Lean User Setup)

## Why this plan
Current Docker is development-first (5 services, local builds, dev web server). Production should feel install-and-run for users with safe defaults and low maintenance.

## Target outcomes
- One install path for Linux/macOS/WSL and one for Windows PowerShell.
- No local `docker build` required for end users (pull versioned images).
- One public entrypoint (HTTPS) and minimal exposed ports.
- Persistent user data and secrets across upgrades.
- Upgrade/backup/restore commands that are copy-paste simple.

## Recommended production shape
### Services (final target)
1. `braindrive-app`
- Runs gateway API and serves built web assets.
- Runs MCP memory/auth/project internally via a supervisor (single container from user perspective).
- Exposes only internal app port (`8787`) to Docker network.

2. `braindrive-edge` (Caddy)
- Terminates TLS.
- Routes `/api/*` and SSE to `braindrive-app:8787`.
- Serves same host/domain for web + API to avoid CORS complexity.
- Exposes `80` and `443` to host.

### Volumes
- `braindrive_memory` -> `/data/memory`
- `braindrive_secrets` -> `/run/paa-secrets`
- Optional: `braindrive_backups` -> `/data/backups`

### Networking
- Internal Docker network for app/edge.
- Only edge service has host-published ports.

## What users run
1. `cd installer/docker`
2. `cp .env.example .env` (or `Copy-Item .env.example .env` on Windows)
3. Fill required env values (`DOMAIN`, `PAA_SECRETS_MASTER_KEY_B64`, optional bootstrap token).
4. `docker compose -f compose.prod.yml up -d`
5. Open `https://<DOMAIN>`

## Installer/docker contents
- `README.md` - quick start, upgrade, backup, restore.
- `compose.prod.yml` - default production stack.
- `compose.local.yml` - optional no-domain profile (local-only, no TLS).
- `.env.example` - required and optional env vars.
- `Caddyfile` - TLS + reverse-proxy rules.
- `Dockerfile.app` - multi-stage build for runtime + web static artifacts.
- `entrypoint.sh` - startup checks and first-run initialization.
- `scripts/install.sh` and `scripts/install.ps1` - guided setup.
- `scripts/upgrade.sh` and `scripts/upgrade.ps1` - pull + restart safely.
- `scripts/backup.sh` and `scripts/restore.sh` - volume-level backups.

## Runtime behavior
1. Container starts and validates critical env vars.
2. Ensures memory/secrets folders exist.
3. Initializes secrets key material if missing.
4. Starts internal MCP services.
5. Starts gateway server.
6. Gateway serves API and static web from same origin.
7. Health checks gate startup (`/health` for app, edge proxy check).

## Production-hardening defaults
- `NODE_ENV=production` everywhere.
- Read-only root filesystem where feasible.
- Drop Linux capabilities and run non-root user in app image.
- `restart: unless-stopped`.
- Log rotation via Docker logging options.
- Resource limits (`cpus`, `memory`) documented and configurable.
- Healthchecks and dependency conditions enabled.

## Phased implementation plan
### Phase 1 (quick win, lowest risk)
- Replace Vite dev container with built static assets.
- Move to prebuilt versioned images.
- Add `compose.prod.yml`, `.env.example`, and install scripts.
- Keep MCP as separate containers internally for now.

### Phase 2 (leaner runtime)
- Consolidate MCP memory/auth/project into a single `braindrive-app` container with process supervision.
- Keep same external behavior and endpoints.
- Add stronger startup orchestration and graceful shutdown.

### Phase 3 (operations polish)
- Add automated image tagging strategy (`vX.Y.Z`, `latest`).
- Add backup/restore helpers and documented disaster-recovery flow.
- Add zero-downtime-ish upgrade procedure for single-node installs.

## Acceptance criteria
- Fresh machine setup to running app in <10 minutes.
- User runs <= 3 commands for first install.
- No host path mounts required by default (named volumes only).
- Upgrade keeps user memory and secrets intact.
- `docker compose ps` shows healthy stack after reboot.

## Risks and mitigations
- Risk: process-supervisor complexity in single app container.
- Mitigation: ship Phase 1 first, then consolidate in Phase 2.

- Risk: TLS/domain friction for non-technical users.
- Mitigation: provide `compose.local.yml` profile for local LAN/testing.

- Risk: secret-key loss makes encrypted secrets unreadable.
- Mitigation: force explicit backup step and startup warning if missing backup.

## Suggested first implementation ticket slice
1. Create `installer/docker/compose.prod.yml`, `.env.example`, and `README.md`.
2. Build production web artifacts and serve from gateway.
3. Publish first versioned images and switch compose to `image:` references.
4. Add install + upgrade scripts for Bash and PowerShell.
