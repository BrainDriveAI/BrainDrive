# Installed-app capability control plane

This directory is the Spec 05 capability control plane for named Resume Builder data, export, and protected inference capabilities. It composes the accepted Spec 02 data/operation/export domain, Spec 03 inference broker, and Spec 04 lifecycle grant store; it does not duplicate those policy boundaries and never exposes memory roots, raw filesystem tools, or provider credentials.

## Frozen registry

All entries use capability version `1`, accept at most 262,144 encoded input bytes, and have a maximum 120-second operation deadline.

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
| `resume.artifacts.register` | `app_data` | mutation |
| `resume.export.request` | `app_export` | host-controlled export |
| `resume.operations.read` | `app_data` | read |
| `app.inference.request` | `app_inference` | protected inference |

The original M4 evidence freezes the eleven data/export entries at that milestone. M5 adds the twelfth registry entry while keeping its adapter in the separate [credential-isolated inference boundary](../app-inference/README.md); the data router continues to reject inference.

## Authority and replay boundary

The host derives owner, actor, app, publisher, package digest, grant/revision, revocation generation, installation, connection, view, operation, idempotency, audience, capability, version, and record scope. A token is a short-lived, one-use, in-memory credential bound to those exact claims. It is rejected after expiry, use, installation/connection/view revocation, or any current-grant mismatch.

Sandbox operations resolve authority from the host session; no bearer enters the iframe, bridge messages, browser storage, result projection, or errors. App-server operations use `POST /internal/apps/resume-builder/capabilities`, require a one-use capability bearer, and also require the configured gateway internal-transport header when `BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN` is set. Owner JWT authority is not accepted as a substitute for either gate.

`CapabilityOperationCoordinator` keys work by installation, capability, and idempotency key. Equivalent concurrent requests share one promise and completed equivalent requests reuse the result. A different canonical capability/input digest conflicts before the adapter. The coordinator enforces identity, size, deadline, cancellation, and per-view rate bounds; durable restart reconciliation remains with the accepted Spec 02 operation store.

Lifecycle close revokes view authority, connection close revokes connection authority, and current lifecycle/grant revision and generation are checked again immediately before data routing. The router invokes only the exact Spec 02 named adapter with opaque IDs and safe projections. Export bytes and destination selection stay in the trusted top-level host; the sandbox receives only a safe label/outcome or opaque artifact identity.

See [SPEC-05-M4-VERIFICATION.md](SPEC-05-M4-VERIFICATION.md) for the reproducible evidence matrix.
