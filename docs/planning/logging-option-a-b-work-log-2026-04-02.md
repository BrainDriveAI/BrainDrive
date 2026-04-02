# Logging Option A+B Implementation Work Log

- Date: 2026-04-02
- Source Plan: `\\wsl$\Ubuntu\home\hex\Reference\Designs\BrainDrive-MVP\Logging\braindrive-logging-research-2026-03-31.md`
- Scope: Implement Option A (support bundle scripts) and Option B (durable JSONL audit sink under Memory) with no architectural drift.

## Log

1. Created this work-log file under `docs/planning` before code changes.
2. Implemented Option B in runtime logger:
   - Extended `builds/typescript/logger.ts` to keep stdout logging and add optional file sink writes under `memory/diagnostics/audit`.
   - Added date-based JSONL files (`YYYY-MM-DD.jsonl`) with size-based rotation (`YYYY-MM-DD.N.jsonl`).
   - Added retention sweep for old audit files based on configurable retention days.
   - Preserved redaction behavior and applied same sanitized payload to both sinks.
3. Wired Option B startup initialization in `builds/typescript/gateway/server.ts`:
   - Initializes file sink after runtime config load (no new component boundary).
   - Added env-driven controls: `PAA_AUDIT_FILE_SINK_ENABLED`, `PAA_AUDIT_MAX_FILE_BYTES`, `PAA_AUDIT_RETENTION_DAYS`.
   - Added startup audit event documenting sink settings.
4. Added Option B tests in `builds/typescript/logger.test.ts`:
   - Sanitized dual-sink write test.
   - Size rotation test.
   - Retention cleanup test.
5. Implemented Option A support bundle scripts:
   - Added `installer/docker/scripts/support-bundle.sh`.
   - Added `installer/docker/scripts/support-bundle.ps1`.
   - Both collect compose logs, metadata, optional health snapshots, and persisted audit JSONL files from memory volume, then redact and archive.
6. Added compose/env plumbing for Option B controls:
   - Updated `compose.local.yml`, `compose.quickstart.yml`, `compose.prod.yml`, `compose.dev.yml` app env sections.
   - Updated `.env.example` with audit sink defaults.
7. Updated docs:
   - Updated `installer/docker/scripts/README.md` with support-bundle script catalog entry.
   - Updated `installer/docker/README.md` operations + notes for support bundles and audit sink behavior.
8. Validation completed:
   - `npm test -- logger.test.ts` passed (3 tests).
   - `npm run build` passed for `builds/typescript`.
   - `bash -n installer/docker/scripts/support-bundle.sh` passed.
   - PowerShell parse check for `support-bundle.ps1` passed.
   - Executed both support-bundle scripts successfully to confirm archive generation.
9. Fixed implementation edge case discovered during validation:
   - Support-bundle scripts now apply permissive permissions (`chmod -R a+rwX`) to copied memory audit files so redaction and cleanup do not fail on host permission differences.
   - Logger rotation now handles single events larger than max file size by writing to a fresh segment file instead of exhausting segment search.
10. Compatibility refinement:
   - Replaced `mapfile` usage in `support-bundle.sh` with a portable `while read` service discovery loop to reduce shell-version compatibility risk.
11. Added secure support-bundle API endpoints (gateway):
   - `POST /support/bundles` (create memory-local support bundle archive).
   - `GET /support/bundles` (list available support bundle archives).
   - `GET /support/bundles/:fileName` (download specific support bundle archive).
   - Security gate: requires authenticated permissions (`administration` + `memory_access`) and additionally enforces `auth_mode=local` (JWT). Endpoints return `403` in `local-owner` mode.
12. Added memory-local support bundle implementation:
   - New module `builds/typescript/memory/support-bundle.ts` creates tar.gz bundles from persisted audit diagnostics under Memory plus runtime metadata.
   - Keeps scope local-first and avoids docker/socket dependencies in app runtime.
13. Added endpoint integration tests in `builds/typescript/gateway/auth-routes.integration.test.ts`:
   - Unauthenticated request denied.
   - Authenticated local JWT create/list/download flow succeeds.
   - `local-owner` mode denied by design.
14. Updated operator documentation:
   - Added root `README.md` quick usage entries for support-bundle script and support-bundle API endpoints.
   - Updated `installer/docker/README.md` notes to document endpoint auth-mode restriction.
15. Additional resilience improvement:
   - Logger file sink now self-recovers from missing audit directory (`ENOENT`) by recreating the sink directory and retrying write once.
16. Validation for endpoint changes:
   - `npm test -- gateway/auth-routes.integration.test.ts` passed.
   - `npm test -- logger.test.ts` passed.
   - `npm run build` passed.
