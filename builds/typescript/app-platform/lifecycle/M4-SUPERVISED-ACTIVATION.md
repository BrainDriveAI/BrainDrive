# Milestone 4 supervised activation contract

This document records the corrective Spec 04 Milestone 4 implementation for REQ-012–REQ-014, REQ-021, REQ-026, and REQ-034–REQ-038. The behavioral authority is the accepted Spec 04 packaging/lifecycle specification and implementation plan; the runtime authority is the accepted Spec 05 supervisor implementation already present in this directory.

## Contract and bindings

- `InstalledAppSupervisorAdapter` implements supervisor protocol version 1 over the existing `ProcessAppSupervisor`. It does not create another process owner or transport.
- `createSupervisedRuntimeBinding` is shared by Docker and packaged desktop. It enforces `container` plus `container_internal` for `docker_linux_x64`, and `packaged_node` plus authenticated `loopback` for `desktop_windows_x64`.
- Docker development already enables the app platform with a dedicated `/data/app-platform` volume and no Docker socket or published installed-app port.
- Packaged desktop already selects `desktop_windows_x64`, uses the Tauri platform-data root, binds the gateway to loopback, and contains descendant processes with the existing Windows process-tree ownership code.
- The corrective M4 kernel adds no public route. The branch's older lifecycle/gateway surface remains unchanged pending the accepted later integration boundary.
- Fixed memory/auth/project MCP configuration and discovery remain unchanged. Installed-app registration is held only by the adapter's dynamic registry and requires a matching live runtime, endpoint token generation, authenticated health result, endpoint port, and connection identity.

## Action ordering

Install activation:

1. Resolve and verify signed source, descriptor, archive, inventory, compatibility, and revocation evidence.
2. Promote verified bytes to immutable storage and persist the exact owner grant.
3. Start the target-bound runtime with only the five contract environment keys.
4. Require authenticated JSON health `{ "status": "ok" }` before the bounded deadline.
5. Dynamically register the exact runtime/endpoint/connection identity.
6. Persist opaque runtime authority.
7. Commit the M2 active pointer.

Disable:

1. Acquire the M2 mutation lease and prepare `disabled` intent.
2. Revoke installation/operation token authority and rotate the generation.
3. Stop the exact runtime; a stale runtime ID is ambiguous and cannot affect a different generation.
4. Remove dynamic registration and reconcile observed runtime identities until zero authority is acknowledged.
5. Remove the opaque runtime-authority record.
6. Commit `disabled`.

Re-enable:

1. Prepare `active` intent while the committed state remains `disabled`.
2. Revalidate signed source, signature, archive, compatibility, and revocation evidence.
3. Require the verified digest to equal the committed digest and re-hash stored immutable content against the signed inventory.
4. Require the exact installation/digest grant to be present, unexpired, and not revoked.
5. Start, await authenticated readiness, dynamically register, and persist opaque authority.
6. Commit `active`. Any failure contains the exact started runtime, removes registration/authority, reconciles the journal, and leaves the lifecycle non-active.

## Durable and secret boundary

`RuntimeAuthorityStore` writes strict version-1 JSON with mode `0600` below `host-app-state/runtime-authority`. The record contains app ID, installation ID, package version/digest, grant ID, runtime identity/generations, registration ID, connection ID, and timestamp. It contains no endpoint address, bearer token, header, command line, argument, environment, entrypoint, package/cache path, or app output.

The child receives only:

- `BRAINDRIVE_APP_CONNECTION_TOKEN`
- `BRAINDRIVE_APP_ID`
- `BRAINDRIVE_INSTALLATION_ID`
- `BRAINDRIVE_PACKAGE_DIGEST`
- `BRAINDRIVE_ENDPOINT_BIND`

The connection token exists only in supervisor memory, rotates on stop/restart, and is never included in audit events. Audit output is allowlisted to identities, action/outcome, health/restart metadata, and stable error codes.

## Reconciliation matrix

| Durable intent and observation | Result |
|---|---|
| `active`; exact runtime and matching registration survive | Adopt exactly that runtime |
| `active`; authority missing, stale, or lost after host restart | Revoke/cleanup to zero, remove authority, commit `failed_recoverable` |
| Non-active; any observed runtime or registration | Revoke/cleanup to zero and retain non-active intent |
| Stale runtime ID while a newer generation is live | Return ambiguous; do not stop or untrack the newer generation |
| Stop timeout or adapter disconnect | Return ambiguous and never claim containment |
| Child exits early or health is malformed | Bounded readiness failure, stop exact runtime, never register |
| Unexpected crash | Existing supervisor uses bounded 1/2/4-second retries and stops after three attempts |

M4 chooses the allowed safe restart outcome of no runtime when durable authority cannot be proven. It never guesses a surviving process identity.

## Verification and environment limits

`app-lifecycle.m4.test.ts` runs the same real-process activation/disable/re-enable assertions for Docker and packaged-Windows target bindings, plus fake-contract, token/path isolation, failure, and reconciliation cases. `supervisor.test.ts` owns real crash/restart-budget evidence. The fixed MCP regression asserts that the new adapter is absent from static discovery/configuration.

Linux CI can execute the Node process and semantic packaged-Windows binding, Rust unit tests, desktop build checks, and Compose validation. It cannot establish native Windows packaged process-containment ground truth or a controlled live Docker lifecycle run; those remain explicit later release-environment evidence rather than fabricated M4 claims.

Update, rollback, revocation-feed enforcement, uninstall/reinstall, public API/UI, Resume domain behavior, marketplace behavior, and inference behavior are not implemented by this corrective M4 kernel.
