# BrainDrive Production Docker Installer

This directory contains the production-oriented Docker setup for BrainDrive.

## Supported launch points
You can run installer commands from any of these directories:
- Repo root (e.g. `./scripts/install.sh local`)
- Installer root (e.g. `./installer/scripts/install.sh local`)
- This directory (e.g. `./scripts/install.sh local`)

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
3. Open `http://127.0.0.1:8080` (default bind).
4. Optional LAN access: set `BRAINDRIVE_LOCAL_BIND_HOST=0.0.0.0` in `.env`, then restart/start local mode and open `http://<this-machine-ip>:8080` from another device on your network.

Local mode builds images from this repo (`Dockerfile.app` + `Dockerfile.edge`) and does not require registry pull access.
By default, first signup is allowed from any host/IP in this installer profile (`PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP=true`).

## Files
- `compose.prod.yml`: production stack (app + edge, TLS via Caddy).
- `compose.local.yml`: local stack (HTTP on `${BRAINDRIVE_LOCAL_BIND_HOST:-127.0.0.1}:8080`; set `0.0.0.0` for LAN access).
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

Optional (recommended for production): pin immutable image refs by digest in `.env`:
- `BRAINDRIVE_APP_REF=ghcr.io/braindrive-ai/braindrive-app@sha256:<digest>`
- `BRAINDRIVE_EDGE_REF=ghcr.io/braindrive-ai/braindrive-edge@sha256:<digest>`

If you set one `*_REF`, set both.
When refs are set, compose uses them instead of `BRAINDRIVE_*_IMAGE + BRAINDRIVE_TAG`.

Optional manifest-driven digest resolution (for upgrades):
- `BRAINDRIVE_RELEASE_MANIFEST=./releases.json`
- `BRAINDRIVE_RELEASE_MANIFEST_SIG=./releases.json.sig`
- `BRAINDRIVE_RELEASE_PUBLIC_KEY=./cosign.pub`
- `BRAINDRIVE_RELEASE_CHANNEL=stable`
- `BRAINDRIVE_RELEASE_VERSION=` (optional explicit version override)
- `BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE=true`

If refs are not set and a manifest is configured, upgrade scripts resolve
`BRAINDRIVE_APP_REF` and `BRAINDRIVE_EDGE_REF` from the manifest.
If signature verification is required, upgrade scripts run `cosign verify-blob` before apply.

## Operations
- Start (no rebuild): `./scripts/start.sh local`
- Stop: `./scripts/stop.sh local`
- Repo-root and installer-root wrappers default to `local` when mode is omitted.
- Upgrade: `./scripts/upgrade.sh`
- Upgrade with explicit refs (one-shot, without editing `.env`):
  - `BRAINDRIVE_APP_REF=ghcr.io/braindrive-ai/braindrive-app@sha256:<digest> BRAINDRIVE_EDGE_REF=ghcr.io/braindrive-ai/braindrive-edge@sha256:<digest> ./scripts/upgrade.sh`
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
    - One-shot refs:
      - `$env:BRAINDRIVE_APP_REF='ghcr.io/braindrive-ai/braindrive-app@sha256:<digest>'; $env:BRAINDRIVE_EDGE_REF='ghcr.io/braindrive-ai/braindrive-edge@sha256:<digest>'; ./scripts/upgrade.ps1`
  - Backup: `./scripts/backup.ps1`
  - Restore: `./scripts/restore.ps1 -Target memory -BackupFile <backup-file>`
  - Reset new-user state: `./scripts/reset-new-user.ps1` (supports `-Yes` and `-FreshClone`)

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
- Keep a secure backup of `PAA_SECRETS_MASTER_KEY_B64`. Losing it may make encrypted secrets unreadable.
- To enforce stricter first-account protection, set `PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP=false` and use `PAA_AUTH_BOOTSTRAP_TOKEN`.
