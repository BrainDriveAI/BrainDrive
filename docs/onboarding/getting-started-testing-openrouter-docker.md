# Getting Started: Testing OpenRouter + Docker + Memory Backup

This guide walks through a local BrainDrive test run with OpenRouter and validates Memory Backup end to end.

## Prerequisites

1. Docker Desktop (or Docker Engine + Compose) is installed.
2. BrainDrive local stack is installed and running.
3. You have an OpenRouter API key.
4. You have a git repository for memory backups and a PAT that can push to that repository.

## 1) Start BrainDrive

From repo root:

```bash
./installer/docker/scripts/start.sh local
```

Open:

- `http://127.0.0.1:8080`

## 2) Configure OpenRouter Credential

In BrainDrive UI:

1. Open `Settings`.
2. Set provider credentials for OpenRouter.
3. Save settings and verify chat responses are working.

## 3) Configure Memory Backup

In BrainDrive UI, open `Settings -> Memory Backup` and set:

1. `Repository URL`: HTTPS git URL (for example `https://github.com/<org>/<repo>.git`)
2. `Git Token (PAT/Classic)`: token with repo push access
3. `Frequency`: choose one (`Manual`, `After changes`, `Every hour`, `Every day`)

Click `Save Backup Settings`.

## 4) Validate Manual Backup

1. Click `Save Now`.
2. Confirm UI fields update:
   - `Last successful save`
   - `Status = success`
3. Confirm backup branch exists remotely:
   - `braindrive-memory-backup`

## 5) Validate Scheduled Modes

### After changes

1. Set frequency to `After changes`.
2. Make a memory change (send a message, create/edit a memory document, etc.).
3. Wait roughly 1-2 minutes.
4. Confirm `Last successful save` advances.

### Every hour / Every day

1. Set frequency to `Every hour` or `Every day`.
2. Leave service running past interval window.
3. Confirm next backup attempt updates status fields.

## 6) Validate Restore (Memory-Only)

1. Ensure at least one backup exists in `braindrive-memory-backup` branch.
2. Mutate a known memory file/content locally (for example, update a memory note).
3. Click `Restore from Backup Repo` and confirm prompt.
4. Verify memory content returns to backup state.

Expected restore behavior:

1. Restore applies memory snapshot only.
2. Secrets are not restored from git backup.
3. Runtime/adapter config is not changed by restore.

## PAT Scope Guidance (GitHub Classic)

Use minimum required scope:

1. Private repo: `repo`
2. Public repo only: `public_repo`

## Troubleshooting

1. `Authentication failed for the backup repository`
   - PAT invalid/expired, missing scope, or missing push permission.
2. `Backup repository was not found or is not accessible`
   - Bad repository URL or insufficient repository access.
3. `Unable to reach the backup repository URL`
   - Network/DNS/proxy issue, or incorrect URL host/path.
4. `Backup branch is not available in the configured repository` (restore)
   - Run `Save Now` first to create/sync backup branch.
5. `memory_backup.repository_url must use https://`
   - SSH URLs are unsupported; use HTTPS URL.
