# Spec 04 Milestone 2 durable lifecycle state

Status: Implemented; source verification is defined below. Native release evidence is not claimed.

This document is the source-adjacent authority for the dormant Milestone 2 persistence kernel in `state-machine.ts`, `durable-store.ts`, `reconciler.ts`, and `diagnostics.ts`. These files do not import package verification, process supervision, gateway routes, fixed MCP services, capability grants, or owner-memory adapters. The feature branch contains pre-existing later-milestone runtime code; that code is not part of this M2 kernel or its focused test.

## State authority

`LifecycleStateMachine` is the only M2 component that creates a lifecycle generation. It parses the current M1 record, enforces the M1 transition table, increments the generation exactly once, clears all runtime authority on `not_installed`, and records a pending operation only for transient states.

```text
not_installed -> staged
staged -> active | not_installed | quarantined | failed_recoverable
active -> disabled | updating | rollback_pending | uninstalling | quarantined | failed_recoverable
disabled -> active | updating | rollback_pending | uninstalling | quarantined | failed_recoverable
updating -> active | disabled | rollback_pending | quarantined | failed_recoverable
rollback_pending -> active | disabled | quarantined | failed_recoverable
uninstalling -> not_installed | failed_recoverable
quarantined -> not_installed
failed_recoverable -> staged | active | disabled | rollback_pending | uninstalling | quarantined
```

All other pairs, including self-transitions, are rejected with `invalid_state_transition`.

## On-disk layout

The constructor receives the dormant `host_app_state` root. It creates only this fixed app namespace:

```text
<host_app_state>/
  apps/ai.braindrive.resume-builder/
    state/lifecycle.json
    journal/<operation-id>.json
    pointers/active.json
    pointers/last-known-good.json
    package-references/<sha256>.json
    locks/mutation.lease.json
    locks/stale-<lease-id>-<evidence-id>.json
```

State, journals, pointers, and package references are version-1 canonical-JSON envelopes with a document-kind/generation checksum. Writes use a same-directory exclusive temporary file, file sync, atomic rename, and directory sync. Package references are immutable and contain only a digest, semantic version, opaque reference ID, and non-path cache key. A missing lifecycle state is synthesized deterministically as generation-0 `not_installed`. Unknown versions, invalid schemas, corrupt JSON, or checksum failures fail closed and leave the evidence in place.

The other M1 storage classes remain separate and are not opened by M2:

| Root reference | M2 disposition |
|---|---|
| `host_app_packages` | Referenced opaquely; no fetch, verification, extraction, execution, or deletion |
| `host_app_staging` | Not opened |
| `host_app_cache` | Not opened |
| `owner_memory` | Not opened or deleted |
| `owner_exports` | Not opened or deleted |
| `host_vault` | Not opened |

## Serialization and replay

One exclusive, expiring lease serializes mutations for the fixed app across store instances and processes. An unexpired lease conflicts. A stale lease is atomically moved to a unique evidence filename before one contender retries acquisition. Every prepared operation binds its operation ID and idempotency key to a canonical input digest. An equivalent retry resumes the same journal or returns its durable terminal result; different input under the same operation ID fails with `idempotency_conflict`; a different mutation cannot prepare while another journal needs reconciliation.

The journal stores the complete prior and proposed records, prior/proposed active and LKG references, completed durability boundaries, pointer-restoration compensation, status, safe error code, and terminal result. No journal field contains a host path, package body, credential, token, owner content, or app output.

## Crash and restart matrix

| Last durable boundary | State authority at restart | Reconciliation |
|---|---|---|
| Before intent | Prior state; no operation exists | No action |
| `intent_persisted` | Prior state | Restore prior pointers; terminal `rolled_back` |
| `package_references_persisted` | Prior state; immutable refs may exist | Preserve refs; restore prior pointers; terminal `rolled_back` |
| `pointers_persisted` | Prior state; pointers may be ahead | Restore prior pointers; terminal `rolled_back` |
| `state_persisted` | Proposed state is authoritative | Reassert refs/pointers; terminal `committed` |
| `result_persisted` | Proposed state and result are terminal | Reuse result; no reconciliation mutation |
| Valid state matches neither journal side | Existing known state is preserved | Terminal `failed_recoverable`; fail closed for operator review |
| Corrupt/unknown state or journal | Authority cannot be proven | Preserve bytes and fail closed; no app execution or deletion |

Recovery never fetches, verifies, extracts, starts, registers, stops, or deletes application or owner data.

## Diagnostics

`AllowlistedLifecycleDiagnostics` validates the strict M1 `LifecycleDiagnosticEventSchema` before invoking its sink. A redacted committed example is:

```json
{
  "diagnostic_version": 1,
  "event_name": "app.lifecycle.transition",
  "correlation_id": "<operation-uuid>",
  "operation_id": "<operation-uuid>",
  "owner_id": "<owner-uuid>",
  "actor_id": "<actor-uuid>",
  "app_id": "ai.braindrive.resume-builder",
  "publisher_id": "ai.braindrive",
  "installation_id": "<installation-uuid>",
  "package_version": "1.0.0",
  "package_digest": "sha256:<digest>",
  "prior_state": "not_installed",
  "target_state": "staged",
  "result_state": "staged",
  "generation": 1,
  "step": "completed",
  "outcome": "completed",
  "error_class": null,
  "error_code": null,
  "recovery": "none"
}
```

The actual schema also requires fixed policy versions, nullable opaque identities, counts, timing, compatibility status, and retry status. Arbitrary additions such as paths, manifests, credentials, tokens, or app/owner content are rejected before serialization.

## Verification

From `builds/typescript`:

```bash
npm run test -- app-lifecycle
npm run test
npm run build
npm run desktop:preflight
```

From the repository root:

```bash
git diff --check
```

The focused M2 suite exhaustively checks the 9-by-9 transition matrix and covers clean restart, atomic rename failure, torn pointers, ENOSPC, EACCES, active/stale leases, concurrent mutation, equivalent/conflicting retries, every journal boundary, missing/unknown/corrupt/checksum-invalid documents, strict diagnostics, and the non-execution import boundary.
