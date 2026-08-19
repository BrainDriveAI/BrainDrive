# Spec 04 Milestone 6 — owner lifecycle evidence

Milestone 6 exposes the trusted lifecycle through the direct Apps surface and adds selective, restart-safe uninstall plus fresh reinstall. It does not add marketplace, silent-update, retained-data deletion, release packaging, or M7 runtime claims.

## Route and binding contract

| Surface | Contract |
|---|---|
| Catalog/status/inspection | `GET /apps`, `GET /apps/resume-builder`, `/status`, and `/inspect` return the same owner-safe app projection. |
| Mutations | Install, reinstall, disable, enable, update, rollback, uninstall, and recover require owner administration. |
| Exact identity | Every mutation carries `operation_id`, `idempotency_key`, and `expected_generation`; installed-state actions also carry the current `installation_id`. |
| Safe conflicts | Cross-owner/cross-install requests return 403 before mutation; stale generation and idempotency conflicts return stable 409 codes. |
| Operations | Operation reads/cancellation bind both operation and installation identity. DTOs expose progress/result/recovery, never tokens, host paths, raw package metadata, or owner content. |

The response projection contains app/publisher/installation/package identity; trust and revocation status; installed/available version; source label; host/protocol/data-schema compatibility; requested/granted capabilities; exact retention classes; progress; safe recovery; and generation.

## Selective uninstall and reinstall

The uninstall journal applies this order:

1. stop runtime and registration, then revoke session/token authority;
2. revoke the installation grant and clean only bounded transient owner-data state;
3. persist cleanup targets, then clear executable/grant references;
4. delete only validated runtime-root descendants, retaining a package root when another package record references it;
5. retain career data, Resume/job history, artifact metadata, owner exports, completed lifecycle evidence, and a minimal path-free tombstone;
6. commit `not_installed`.

Missing files are accepted. A locked-file or partial-deletion failure leaves `uninstalling` plus the durable journal; initialization resumes the remaining cleanup before committing. Reinstall reruns source/package/revocation/compatibility verification and creates new installation, grant, and operation identities. Retained Resume data is inspected or migrated only through the opaque owner-data adapter.

## Executable evidence

- `app-lifecycle.m6.test.ts`: disk removal/retention, retained-data and export hash equality, grant/token/runtime removal, restart after partial deletion, shared-root preservation, fresh reinstall identities, and support-bundle forbidden-field scan.
- `routes.integration.test.ts`: missing authority, denied administration, cross-owner rejection, safe catalog/status/inspect DTOs, exact installation/generation binding, stable conflict, idempotent replay, explicit capability approval, and uninstall confirmation.
- `client_web/src/api/apps-adapter.test.ts`: exact request binding and authoritative refresh after ambiguous transport completion.
- `client_web/src/components/apps/AppsPage.test.tsx`: identity/trust/source/compatibility/capability/retention copy, progress/quarantine/recovery states, duplicate suppression, destructive confirmation, Escape/Tab focus behavior, responsive layout, and launch-focus restoration.
- AppShell/Sidebar and full web suites preserve the single direct Apps entry and existing Settings/chat composition.

Support bundles rewrite audit JSONL through a metadata allowlist and add `metadata/lifecycle-diagnostics.jsonl`. Lifecycle projections preserve operation/install/state/decision/deletion/retention/error classes while dropping paths, credentials, tokens, raw metadata, messages, and content.
