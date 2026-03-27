# BrainDrive Docker Production Work Log

## Scope
Implementation tracking for production Docker setup in this repository:
`/home/hex/Project/BrainDrive-Test-01/installer/docker`

## Entries
### 2026-03-27 12:40 ET
- Corrected implementation target to this repository (`BrainDrive-Test-01`).
- Created `installer/docker` directory structure and copied production installer assets into repo-local path.
- Confirmed unrelated pre-existing untracked file outside this scope is left untouched.
- Next: validate shell scripts, PowerShell scripts, and compose configs from this repo location.
### 2026-03-27 12:42 ET
- Validation completed in repo-local path:
  - `bash -n` passed for all shell scripts and `entrypoint.sh`.
  - PowerShell parser checks passed for all `.ps1` scripts.
  - `docker compose config` passed for both `compose.prod.yml` and `compose.local.yml`.

### 2026-03-27 12:43 ET
- Implementation in `/home/hex/Project/BrainDrive-Test-01/installer/docker` is complete.
- Repo status confirms installer assets are now tracked under `installer/` while unrelated untracked file remains untouched.
### 2026-03-27 12:50 ET
- Addressed command path confusion reported during first run.
- Added wrapper scripts so installer commands now work from:
  - repo root: `./scripts/*.sh` / `./scripts/*.ps1`
  - installer root: `./installer/scripts/*.sh` / `./installer/scripts/*.ps1`
  - docker installer dir: existing `./installer/docker/scripts/*`
- Updated `installer/docker/README.md` with explicit supported launch points and command examples.
### 2026-03-27 12:52 ET
- Validated new wrapper scripts:
  - `bash -n` passed for root and installer shell wrappers.
  - PowerShell parser checks passed for root and installer PowerShell wrappers.
- Repo now supports the originally attempted commands (`./scripts/install.sh`) from both repo root and `installer/`.
### 2026-03-27 12:57 ET
- Investigated user-reported install failure from repo root.
- Root causes found:
  - Shell scripts were BOM-encoded (`EF BB BF`), causing shebang parse errors on Bash.
  - Local mode attempted to pull GHCR images (`ghcr.io/...:latest`), which failed without registry access.

### 2026-03-27 13:03 ET
- Fixed installer behavior and build path:
  - `compose.local.yml` now builds from source (`../..` context) using local image tags.
  - `scripts/install.sh` and `scripts/install.ps1` updated so `local` mode builds (`up -d --build`) without image pull.
  - Removed BOM and CRLF from all `.sh` installer scripts; re-applied executable permissions.
  - Updated README to explicitly state local mode builds from repo and requires no registry pull.

### 2026-03-27 13:07 ET
- Local build blocked by existing TypeScript errors in `client_web`.
- Fixed unused state declarations in `builds/typescript/client_web/src/components/settings/SettingsModal.tsx`.

### 2026-03-27 13:11 ET
- App container initially unhealthy due startup error `spawn git ENOENT`.
- Added `git` to runtime image package list in `Dockerfile.app`.
- Corrected MCP entrypoint path to `/app/mcp_release/dist/src/index.js`.

### 2026-03-27 13:15 ET
- Re-ran `./scripts/install.sh local` from repo root successfully.
- Verified stack health:
  - `app` healthy
  - `edge` up on `127.0.0.1:8080`
- Verified HTTP checks:
  - `GET http://127.0.0.1:8080/health` -> `200`
  - `GET http://127.0.0.1:8080/` -> `200`
### 2026-03-27 13:22 ET
- Added non-rebuild lifecycle commands:
  - `scripts/start.sh` / `scripts/start.ps1`
  - `scripts/stop.sh` / `scripts/stop.ps1`
  - plus repo-root and installer-root wrappers for both start/stop.
- Updated README operations section with start/stop usage.

### 2026-03-27 13:24 ET
- Updated upgrade behavior:
  - `upgrade prod`: pull + recreate (existing behavior)
  - `upgrade local`: rebuild + recreate (no registry pull)

### 2026-03-27 13:26 ET
- Validated start/stop scripts:
  - shell syntax checks passed
  - PowerShell parser checks passed
  - runtime smoke: start(local) -> stop(local) -> start(local) successful
### 2026-03-27 13:34 ET
- Addressed `./scripts/start.sh` default-mode confusion that triggered GHCR auth errors.
- Improvements made:
  - Repo-root and installer-root `start`/`stop` wrappers now default to `local` when mode is omitted.
  - Added prod guardrails in docker-level `start` scripts (require real DOMAIN; suggest local mode on failure).
  - Updated README operations section to clarify local defaults and explicit mode usage.
- Validation:
  - Shell and PowerShell parser checks passed for updated start/stop scripts.
  - Runtime smoke passed: `./scripts/stop.sh` then `./scripts/start.sh` (no args) now cleanly manages local stack.
### 2026-03-27 13:44 ET
- Reset runtime state to simulate fresh-clone local user (without recloning repo):
  - Stopped local stack and removed local containers/network.
  - Removed local named volumes `braindrive_memory` and `braindrive_secrets`.
  - Removed local images `braindrive-app:local` and `braindrive-edge:local`.
  - Removed `installer/docker/.env` to force first-run env setup.
- Verification:
  - No `braindrive_local*` containers running.
  - No `braindrive_memory`/`braindrive_secrets` volumes present.
  - `installer/docker/.env` not present.
### 2026-03-27 13:39 ET
- Implemented single-user first-signup flexibility for host/domain variance:
  - Added runtime env flag `PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP` (default false in code).
  - When true, first signup bypasses loopback-only gate.
- Wired installer defaults to `true` in `compose.local.yml` and `compose.prod.yml` for current single-user rollout.
- Updated `.env.example` and README with guidance and hardening note (`set false + bootstrap token`).

### 2026-03-27 13:41 ET
- Validation:
  - `npm run build` passed for `builds/typescript` after gateway change.
  - Fresh local install succeeded.
  - First signup via edge endpoint returned `201`.
  - Second signup attempt returned `409` (single-account enforcement preserved).
### 2026-03-27 13:46 ET
- After validation signup tests, reset local state again for clean user retest:
  - removed local containers/network/volumes
  - removed local images
  - removed `installer/docker/.env`
- Result: environment is back to pre-install first-run state.
### 2026-03-27 13:37 ET
- Added dedicated new-user reset tooling for test cycles:
  - `installer/docker/scripts/reset-new-user.sh`
  - `installer/docker/scripts/reset-new-user.ps1`
  - repo-root and installer-root wrappers for both shell and PowerShell.
- Safety behavior:
  - Interactive confirmation prompt requires typing `RESET`.
  - `--yes` / `-Yes` bypasses prompt.
  - Optional `--fresh-clone` / `-FreshClone` additionally removes local `.env` and local images.
- README updated with reset command usage.
- Validation:
  - Shell + PowerShell syntax checks passed.
  - Runtime smoke: `./scripts/reset-new-user.sh --yes` executed successfully and removed local test state.
### 2026-03-27 13:54 ET
- Added install safety guardrails per request:
  - `install.sh` and `install.ps1` now exit immediately if `.env` already exists.
  - Message explains install is first-run only and points to `start`, `upgrade`, or `reset-new-user --fresh-clone`.
- Updated README to document first-run-only install behavior.
- Validation:
  - Shell and PowerShell syntax checks passed.
  - Behavior check passed: with existing `.env`, `install.sh local` exits with clear warning.
