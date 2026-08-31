# Spec 05 Milestone 4 verification

This record maps the implemented named-capability control plane to M4-AC1 through M4-AC7. The accepted Specs 02 and 04 remain authority for durable owner data, operations, export receipts, lifecycle grants, and uninstall retention.

## Grant, token, and scope matrix

| Call path | Audience | Credential placement | Exact bindings checked | Revocation boundary |
| --- | --- | --- | --- | --- |
| Sandbox data read/write | `app_data` | Host session only; no iframe bearer | owner/actor/app/publisher/package/grant revision/install/connection/view/operation/idempotency/capability/version/record scopes | lifecycle, connection, view, expiry, replay |
| Sandbox export | `app_export` | Host session and trusted top-level save broker | same exact bindings; only `resume.export.request` | lifecycle, connection, view, expiry, replay |
| App-server data/export | `app_data` or `app_export` | Bearer on the internal HTTP request only | same exact bindings with `view_id: null`, current connection/session, capability version 1 | lifecycle, connection, expiry, replay |
| Owner-confirmed fact/definition action | owner route | Authenticated owner administration; no app bearer | active installation/grant and named owner-confirm capability | lifecycle and owner session |

Record scopes may only narrow the installed grant. `registry.test.ts` enumerates all 256 subsets of an eight-record grant and rejects one unrelated record. This historical M4 record covered eleven data/export entries; M5 subsequently adds protected inference as a twelfth registry entry without routing it through the data domain.

## Security and replay traces

- Exact-claim trace: `store-and-token.test.ts` changes owner, actor, app, publisher, package digest, grant ID/revision, revocation generation, token generation, connection, view, operation, idempotency key, and record scope one at a time; every changed claim returns `token_scope_invalid` before the unchanged token succeeds.
- Forgery/replay/expiry trace: an unknown bearer returns `token_invalid`; first exact use succeeds; second use returns `token_replayed`; advancing the clock beyond TTL returns `token_expired`.
- Revocation trace: revoking one view rejects its token while an unrelated view on the same connection remains live; revoking the connection rejects the remaining connection token; installation revocation rejects all installation tokens.
- Transport trace: `gateway/auth-routes.integration.test.ts` returns `403 gateway_transport_token_required` before the internal route is reached without the configured internal transport header. `routes.integration.test.ts` separately returns 401 without a capability bearer.
- Projection trace: `data-capability-bridge.test.ts` exercises host-held sandbox authority and app-server one-use authority; results contain no bearer. `SandboxedAppFrame` tests scan the iframe lifecycle and messages for credential absence.

## Idempotency and adapter call counts

- Two equivalent concurrent requests plus one completed retry invoke the adapter exactly once.
- Same idempotency key with different canonical capability/input invokes the adapter once total and returns `idempotency_conflict` for the mismatch.
- A replay of a consumed app-server bearer invokes the adapter zero additional times.
- Spec 02 durable operation tests cover canonical retry reuse, mismatched input conflict, CAS/persistence failure, and restart reconciliation. The M4 coordinator deliberately delegates durable recovery to that existing store.

## Data, context, export, and retention evidence

- `career.test.ts`, `capabilities.test.ts`, and `resume-data-m3.test.ts` prove bounded direct/Career context, managed-base/overlay ordering, direct-entry no-placement, Career journal placement, concurrent placement serialization, and idempotency conflict without returning memory paths.
- `resume-data-m5.test.ts` invokes every named data/export capability under exact grants, checks current connection/view binding, missing/out-of-scope non-disclosure, opaque IDs, owner confirmation, and content-free support diagnostics.
- `renderer.test.ts` proves only approved lineage exports, the returned destination is a safe label, raw paths are absent, overwrite needs confirmation, cancellation creates no artifact, and chooser cancellation does not claim completion. It also recreates the durable store and broker between retries, proving that the same export idempotency key returns the original artifact and receipt while changed retry input returns `idempotency_conflict` without altering the approved definition.
- `resume-data-m4.test.ts` verifies artifact compatibility/digests and path-free receipts. Resume store fault/restart tests prove atomic operation persistence and reconciliation.
- `app-lifecycle.m6.test.ts` hashes owner data and an exported PDF before uninstall and proves the hashes are unchanged afterward while runtime authority, grant, package/cache, and registration are removed.

## Diagnostics boundary

Capability audit events allow only safe IDs, capability/version, grant/revocation generations, counts/timing, decisions, digests, and safe errors. `memory/support-bundle.test.ts`, `resume-data-m5.test.ts`, and lifecycle support-bundle tests scan output and reject token/grant bodies, owner content, raw metadata, paths, destinations, and credentials.

## Verification commands

Run from `builds/typescript` unless noted:

```bash
npm run test -- app-capabilities mcp gateway memory
npm run test
npm run build
npm run web:typecheck
npm run web:test
npm run docs:test
npm run docs:check
npm run docs:verify
```

Run from the repository root:

```bash
node tools/docs/sync-generated.mjs --check
git diff --check
```

## Recorded result on 2026-08-09

| Command | Result |
| --- | --- |
| `npm run test -- app-capabilities mcp gateway memory` | PASS — 32 files, 213 tests |
| `npm run test` | PASS — 86 files, 604 tests |
| `npm run build` | PASS |
| `npm run web:typecheck` | PASS |
| `npm run web:test` | PASS — 24 files, 222 tests |
| `npm run contracts:schemas` | PASS; checked-in JSON Schemas regenerated |
| `npm run docs:test` | PASS — 163 passed, 1 platform-specific skip |
| `npm run docs:check` | PASS — 248 scoped candidates, 0 diagnostics |
| `npm run docs:verify` | PASS — docs tests and validation |
| `node tools/docs/sync-generated.mjs --check` | PASS — projections match the catalog |
| `git diff --check` | PASS |

The first two full runtime attempts each passed 602 of 603 tests but the pre-existing 20-sample `resume-domain/service.test.ts` invariant exceeded its five-second per-test limit under full-suite parallel load (5.015s and 5.032s). The file passed alone, and its production assertions were unchanged. Its single test timeout was raised to ten seconds; the next complete run passed all 603 tests. After adding the explicit export-restart case, the final complete run passed all 604 tests.

No live Docker runtime, native desktop package, browser E2E, provider credential, or external network was required or exercised by this M4 verification. Export destination behavior is covered at the host/browser-broker and deterministic renderer boundaries; native chooser parity remains governed by the existing later-milestone desktop evidence.

This milestone adds no provider/model behavior, dynamic supervisor, package lifecycle state, raw memory/filesystem authority, cross-app/project authority, iframe bearer, or optional MCP facility. Existing later-milestone code in the cumulative working tree is preserved but not expanded here.
