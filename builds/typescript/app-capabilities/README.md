# Installed-app capability control plane

This directory is the generic capability control plane used by installed apps. It enforces named authority, lifecycle grants, operation identity, confirmation, schema validation, and safe host services without placing app-specific workflow or inference policy in BrainDrive core. Resume Builder and Brief Builder are installed consumers; each owns its action semantics, data model, inference programs, prompts, reducers, and owner workflow inside its signed package and never receives memory roots, raw filesystem tools, or provider credentials.

## Frozen registry

All entries use capability version `1`, accept at most 262,144 encoded input bytes, have a maximum 120-second operation deadline, and now carry host-owned input/result schema IDs, rate bounds, confirmation class, audit projection, retry/idempotency policy, and owning component. Each descriptor is immutable. These reviewed definitions remain separate from package manifests; a manifest request cannot add a descriptor or executable handler.

Spec 08 Milestone 4 adds an app-neutral registry and dispatcher keyed by exact `(app_id, name, version)`. A request runs only when the host has independently registered its input schema, result schema, handler, limits, confirmation projection, audit projection, and retry/idempotency policy, and when the verified manifest request and current app/install/package grant agree. Native app-chat model-session actions use this dispatcher and treat action ids as app-owned opaque semantics; the V1 model-session contract executes actions with exactly one declared host capability. The model-visible tool validates the app-declared `action_input` schema, then the dispatcher validates the translated capability input and adapter result against the reviewed host registration before returning. The Resume list below remains an explicit adapter inventory rather than package-authored executable authority.

| Capability | Audience | Effect |
| --- | --- | --- |
| `career.context.read` | `app_data` | read |
| `career.facts.read` | `app_data` | read |
| `career.facts.propose` | `app_data` | mutation |
| `career.facts.confirm` | `app_data` | mutation with owner confirmation |
| `resume.definitions.read` | `app_data` | read |
| `resume.definitions.write` | `app_data` | mutation with owner confirmation for approval |
| `resume.jobs.read` | `app_data` | read |
| `resume.jobs.write` | `app_data` | mutation |
| `resume.artifacts.register` | `app_data` | compatibility artifact registration |
| `resume.export.request` | `app_export` | compatibility export request |
| `resume.operations.read` | `app_data` | read |
| `app.inference.request` | `app_inference` | protected inference |

The original M4 evidence freezes the eleven data/export entries at that milestone. M5 adds the twelfth registry entry while keeping its adapter in the separate [credential-isolated inference boundary](../app-inference/README.md); the data router continues to reject inference.

## Authority and replay boundary

The host derives owner, actor, app, publisher, package digest, grant/revision, revocation generation, installation, connection, view, operation, idempotency, audience, capability, version, and record scope. A token is a short-lived, one-use, in-memory credential bound to those exact claims. It is rejected after expiry, use, installation/connection/view revocation, or any current-grant mismatch.

Sandbox operations resolve authority from the host session; no bearer enters the iframe, bridge messages, browser storage, result projection, or errors. App-server operations use `POST /internal/apps/:appKey/capabilities`, resolve the registered app route before body or state work, require a one-use capability bearer, and also require the configured gateway internal-transport header when `BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN` is set. Owner JWT authority is not accepted as a substitute for either gate.

Capability operation and dispatcher keys include app plus installation, capability, and idempotency identity. Equivalent concurrent requests share one promise only within that authority; the same IDs in another app are independent. A different canonical capability/input digest conflicts before the adapter. The coordinator enforces identity, size, deadline, cancellation, and per-view rate bounds; ambiguous downstream outcomes are retained instead of replayed, while durable restart reconciliation remains with the accepted Spec 02 operation store.

`artifact-export.ts` is the app-neutral export mediation service used behind reviewed host adapters. It validates generic artifact metadata before registration, checks export bytes against the declared digest and safe media type, requires host owner confirmation before preparation, rejects unsafe destination labels, and records content-safe receipts after the host-owned save boundary reports a terminal outcome. Registration, export preparation, and receipt finalization each use app/install-scoped operation plus idempotency identity; equal retries replay the prior safe projection, changed input conflicts, and cancellation prevents late artifact creation. Apps own exported bytes, labels, source identities, media types, and retention declarations; BrainDrive owns destination mediation, overwrite confirmation, receipt projection, and audit.

Spec 10 adds a typed Resume recovery reconciliation contract without changing coordinator result shapes. The initial `500 ms` boundary is display-only. Authoritative reads occur at elapsed `625`, `750`, `1,000`, `1,500`, `2,500`, `4,500`, and `8,500 ms`, then use backoff capped at `5,000 ms`; one scoped not-found remains pending. The caller still rejects and aborts at the exact `120,000 ms` host maximum, while typed lifecycle inspection retains the scoped operation identity as pending until adapter work actually settles. A terminal not-saved decision then requires lifecycle settlement plus final operation/workspace readback. Equal retries cannot start a second adapter during that interval, and a late committed lifecycle remains replayable.

The package reaches that lifecycle through its already granted `resume.operations.read` capability by sending `{ queried_operation_id, reconciliation: "resume_recovery_v1" }`. The strict `recovery_reconciliation` projection supplies `lifecycle_state`, `host_operation_settled`, and the operation readback consumed directly by the shared reconciliation decision. A current-process lifecycle without a matching scoped binding remains unsettled. After a new process has initialized the store and reconciled every retained transaction, absence of both a durable operation and a current-process binding is projected as `quiesced_restart_no_operation`; only that explicit restart proof permits final no-commit classification. Legacy operation-read input is unchanged.

Lifecycle close revokes view authority, connection close revokes connection authority, and current lifecycle/grant revision and generation are checked again immediately before data routing. The router invokes only the exact reviewed adapter for the selected app/capability/version with opaque IDs and safe projections. Export destination selection stays in the trusted top-level host; the sandbox receives only a safe label/outcome or opaque artifact identity.

See [SPEC-05-M4-VERIFICATION.md](SPEC-05-M4-VERIFICATION.md) for the reproducible evidence matrix.

Brief Builder separately registers `brief.records.read`, `brief.records.write`, and host-confirmed `brief.approvals.confirm` against its own owner-data service. It requests the existing protected transport capability `app.inference.request`; no Resume or Career capability is renamed to serve the Brief domain.
