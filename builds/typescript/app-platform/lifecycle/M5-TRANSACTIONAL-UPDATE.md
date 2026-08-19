# Milestone 5 — transactional update, rollback, and revocation

Milestone 5 adds a dormant internal `TransactionalUpdateService`; it adds no owner route, UI, marketplace behavior, uninstall flow, or automatic update activation. The service composes the accepted M2 durable store, M3 verifier/package/grant stores, M4 supervisor adapter, and the Spec 02 opaque lifecycle-data adapter.

## Update authority and ordering

An update requires an owner-supplied operation identity, idempotency key, exact expected package digest, and exact grant decision. Inspection reports semantic-version, capability, and retained-data schema decisions. A capability addition produces `owner_approval_required`; a denied or non-exact grant stops before package execution.

The committed order is:

1. Verify the candidate and exact expected digest.
2. Persist the replacement grant and immutable package reference.
3. Inspect retained data; when the candidate write schema differs, create an opaque snapshot, migrate, and validate schema plus content digest.
4. Start one non-authoritative candidate beside the registered old runtime and pass authenticated readiness.
5. Commit durable `updating`, revoke and stop the old exact runtime, then register the candidate as the sole active runtime.
6. Persist runtime authority and atomically switch active/LKG package pointers with a pending successful-use checkpoint.

The candidate slot never receives dynamic registration or capability-token authority while the old runtime is active. Promotion is rejected until the old runtime is stopped. Normal and compensated outcomes therefore end with exactly one registration/writer or a non-running `failed_recoverable`/`quarantined` state.

## Data and rollback

`ResumeDataLifecycleAdapter` implements the accepted opaque `inspectSchema`, `discoverRetainedData`, `snapshot`, `migrate`, and `restore` interface. Snapshot results expose only opaque identifiers, schema versions, and SHA-256 digests. The current released Resume data schema is version 1; an unavailable transformer fails `incompatible_schema` without deleting the recovery snapshot.

A verified rollback can target only the retained, non-revoked LKG package. When an update changed schema, rollback first creates a forward-recovery snapshot and restores the update's validated pre-migration snapshot. It then applies the same candidate-readiness, old-stop, sole-registration, runtime-authority, and atomic-pointer ordering as update. The prior active becomes the new LKG.

The successful-use checkpoint is a durable active-to-active generation transition. Cleanup runs only after it passes and retains at most active plus one LKG package authority and the one snapshot associated with that pair.

## Revocation behavior

`MonotonicRevocationAuthority` verifies the pinned trust root, authorized release key, detached revocation signature, sequence, and prior-list digest before atomically replacing the last verified cache. Invalid, changed-same-sequence, skipped-chain, and older candidates are rejected without replacing it. Offline or stale status remains explicit: a stale non-match may authorize an already verified local package with a diagnostic, but a cached explicit match always fails `package_revoked`.

Update requires fresh non-revocation authority before the switch. Rollback permits stale offline authority only when it contains no explicit target match. A matching live package is token-revoked, stopped, unregistered, stripped of runtime authority, and durably quarantined under the lifecycle mutation lease.

## Crash and compensation matrix

| Durable boundary | Restart result |
|---|---|
| verified / grant decided / package referenced / data inspected | Candidate authority and temporary grant/reference are removed; old pointer/runtime remain active. |
| snapshot created / migration validated | Exact snapshot digest is restored before old authority can change; restore ambiguity enters non-running `failed_recoverable`. |
| candidate started / ready | Candidate is stopped; its non-authoritative slot is removed; old registration remains. |
| updating committed | Candidate is stopped, the prior pointer is restored, and the exact prior verified package is restarted or reused. |
| old stopped / candidate registered / runtime authority persisted | Candidate authority is contained, the prior pointer/data are restored, and one prior registration is recreated. |
| pointer switched | The candidate active/LKG/checkpoint state is already authoritative; reconciliation marks the journal committed without reverting it. |

`app-lifecycle.m5.test.ts` injects an interruption after every listed update boundary and proves one active pointer, one runtime, and one registration after restart. It also covers same-version/digest rejection, capability widening and denial, migration success/partial/restore failure, explicit rollback, snapshot quota, valid/invalid/older/stale/offline revocation authority, revoked update/LKG/current packages, immediate quarantine, and lease conflicts.

Focused verification from `builds/typescript` is:

```bash
npm run test -- app-lifecycle.m5.test.ts
npm run test -- app-lifecycle memory
```
