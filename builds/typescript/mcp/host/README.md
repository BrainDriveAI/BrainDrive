# Spec 05 modern MCP connection core

> **Resume Builder status (2026-08-16):** Resume Builder's sandboxed MCP UI is quarantined pending the portable conversational-app architecture decision. The live Resume Builder route currently uses host-native chat and an app-private document workspace. This host remains the intended surface-app path; it is not the live Resume Builder owner experience.

This directory owns the Milestone 2 protocol seam for installed MCP Apps. It does not own app rendering, bridge messages, named data capabilities, inference, package execution, subscriptions, or supervisor lifecycle.

## Profiles and connection authority

`SdkMcpPeer` uses the official MCP v2 client, pins `server/discover` negotiation to core `2026-07-28`, disables automatic input-required rounds, enforces declared capabilities, and rejects HTTP redirects. `McpConnectionManager` accepts an installed peer only after the discovery result declares tools, resources, Apps extension `io.modelcontextprotocol/ui` version `2026-01-26`, and server identity.

Connection records are memory-only and keyed by installation plus server. Their authority also binds app, publisher, package digest, runtime ID, and positive generation. Equal authority reuses a ready connection. Newer or conflicting authority closes the prior peer and invalidates its catalogs/resource cache. Stale handles, late results, duplicate operation IDs, cross-server calls, and calls outside tool visibility fail with typed `McpHostError` codes.

Only negotiation and read-only catalog discovery receive one bounded reconnect attempt. A failed `tools/call` is reported as an ambiguous outcome and is never replayed. Abort signals are request-scoped, progress remains correlated to the operation, close aborts pending work, and audit events contain only allowlisted IDs, versions, counts, decisions, and error codes.

## Catalogs, resources, and results

Discovery atomically validates complete `tools/list`, `resources/list`, and `resources/templates/list` results before publishing a catalog generation. Tool `_meta.ui.visibility` becomes the exact model/app allowlist; `_meta.ui.resourceUri` is canonicalized and remains bound to the same server connection.

App resources must use a canonical traversal-free `ui://` URI and exact `text/html;profile=mcp-app` media type. Reads require one exact URI match, one text-or-blob body, the negotiated package digest, declared size agreement, SHA-256 integrity agreement, and a recognized cache policy. Immutable cache entries are partitioned by package digest, connection generation, connection ID, URI, and content digest; `no_store` results are never retained.

`preserveMcpResult` retains ordered text, image, audio, resource-link, and embedded-resource blocks together with annotations, structured content, metadata, error state, protocol/correlation fields, progress identity, and cancellation identity. `projectMcpResult` derives a metadata-minimized model view and a full authorized app view from explicit indices. The fixed first-party tool path never receives that authority: `legacy-adapter.ts` preserves the historical SDK-v1 list/call, approval, error, and outward projection behavior.

## State outline

```text
disconnected -> connecting -> negotiating -> ready
                                      |        |
                                      |        +-> reconnecting -> negotiating
                                      |        +-> closing -> closed
                                      +-> failed_recoverable
```

Catalogs and resource cache entries are usable only while their exact ready connection record remains current.

## Verification

Focused tests live beside the implementation:

- `connection-manager.test.ts`: negotiation, reuse, generations, catalogs, resources, retries, cancel/progress, duplicate/late/close, visibility, and same-server denial.
- `envelope-projection.test.ts`: golden/property complete envelopes, ordered content, typed errors, projections, and legacy precedence.
- `sdk-peer.test.ts`: official v2 loopback discovery/read/call and redirect denial.
- `legacy-adapter.test.ts`: fixed profile, naming, schemas, approvals, result precedence, and typed failures.

The authenticated signed-fixture proof remains `app-platform/mcp-host/live-fixture.integration.test.ts`.
