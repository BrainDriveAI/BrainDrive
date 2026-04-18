# BrainDrive TypeScript Build (MVP)

This build is trimmed for local MVP onboarding with OpenRouter.

Primary command:

    bash ./scripts/new-user-setup.sh

Security note:

1. Set `PAA_AUTH_BOOTSTRAP_TOKEN` for internet-exposed deployments before first signup.

Web UI:

1. http://127.0.0.1:5073

Compose services:

1. mcp-memory
2. mcp-auth
3. mcp-project
4. paa-runtime
5. paa-web

Gateway update routes:

1. `GET /api/updates/status`
2. `GET /api/updates/session` (admin auth required)
3. `POST /api/updates/conversation/start` (admin auth required)
4. `POST /api/updates/code` (admin auth required)
5. `POST /api/updates/restart` (admin auth required)

When host-level execution is unavailable, `/api/updates/code` and `/api/updates/restart` return the canonical fallback command:

1. `./installer/docker/scripts/upgrade.sh local`
2. `./installer/docker/scripts/upgrade.sh prod`

Startup resume behavior:

1. Gateway inspects `memory/system/updates/session.json` after startup readiness.
2. Non-terminal sessions resume deterministically; `restart_pending` advances to migration resume.
3. Critical readiness failures terminalize the session (`failed` or `rolled_back`) and stop migration.
