# Modern MCP Apps host

This directory began as the Milestone 3 host boundary and now composes the M4 named data router, M5 brokered inference boundary, and M6 host-owned approval/export bridge. It launches only the active signed repository fixture from the Milestone 2 lifecycle service. Rendering remains in the separate deterministic renderer package. It does not implement desktop supervision, marketplace discovery, general MCP prompts/completions, or remote OAuth.

## Host flow

1. `AppMcpHost` resolves the active installation and its private loopback runtime connection from the lifecycle supervisor.
2. `ModernMcpAppsClient` negotiates exactly MCP `2026-07-28` plus `io.modelcontextprotocol/ui` `2026-01-26`, requiring both tools and resources before any resource read.
3. The client lists tools/resources, reads the declared `ui://resume-builder/main` resource, retains complete list/read metadata internally, validates its exact media type and encoded size, and rejects HTML that violates the fail-closed content policy.
4. The host creates an installation/view/operation/session-bound bridge, consumes the raw one-use bootstrap token, and returns only opaque IDs plus the validated UI projection to the authenticated owner client.
5. The trusted web component loads a fixed `data:` sandbox proxy with `sandbox="allow-scripts allow-same-origin"`; the proxy and host therefore remain different origins. Only after the proxy-ready message does the host send the validated resource through `ui/notifications/sandbox-resource-ready`. The proxy creates the inner opaque-origin view with `sandbox="allow-scripts"`, injects the restrictive resource CSP, and mediates every message.
6. The component implements Apps `2026-01-26` initialization (`ui/initialize`, host response, then `ui/notifications/initialized`) and emits only safe host context. The view never receives the launch/session record, bridge token, server identity, owner permissions, raw paths, or Tauri globals.
7. The gateway accepts only the typed, host-constructed Apps bridge envelope for that owner session. Same-server app-visible tools and the validated launch resource are allowed. A consumed `app_data` or `app_export` token is immediately reduced to the strict Resume data authority projection, and the data policy rechecks the current lifecycle grant before record lookup. Inference uses a one-use `app_inference` token; export uses a one-use `app_export` token and the host-owned browser-save boundary. Fact confirmation and definition approval are intercepted for authenticated owner confirmation. Cross-server/model-only calls, undeclared host actions, stale, replayed, revoked, malformed, oversized, or wrongly bound messages fail closed.

Disable, update, uninstall, lifecycle generation change, expiry, tab hiding, iframe closure, and gateway shutdown remove bridge-session authority. The sandbox receives no bearer credential, owner permission object, host path, filesystem/Tauri API, arbitrary network permission, download authority, or unrestricted MCP endpoint.

## Reconnect and concurrent views

`AppViewRegistry` is the host authority for live Resume Builder view state. A first launch allocates random session, view, and operation identities at bridge generation 1 only after lifecycle activation, authenticated supervisor readiness, MCP negotiation/discovery, resource verification, and sandbox eligibility all succeed. A reload may present only the previous session, view, operation, and bridge generation. An exact current match keeps the view and durable operation identities, rotates the session, increments the bridge generation, and invalidates the old session before it can commit or render another result. A missing, stale, expired, cross-installation, cross-package, cross-lifecycle, or racing resume request fails closed.

The registry permits at most 16 live views per installation and expires inactive records after five minutes. Each view has independent session, token, progress/result, cancellation, focus, and close authority. Cancellation and close resolve the exact current session and operation; they never search other views for a matching operation. The existing capability and inference coordinators remain the durable idempotency authorities, so reconnect changes transport identity without creating a second write, export, or provider call.

`parity-normalizer.ts` compares Docker and selected packaged-desktop observations after separating only the five M1-contract runtime fields: transport, process isolation, package-root reference, cache-root reference, and diagnostic platform. Protocol, extension, lifecycle, policy, state, error, and outcome differences remain failures. A missing selected target produces blocked evidence rather than an inferred parity result. The revision-bound M7 result and operator checks are recorded in [`SPEC-05-M7-ACCEPTANCE.md`](SPEC-05-M7-ACCEPTANCE.md).

## Compatibility boundary

The modern installed-app path is independent from fixed tool discovery. Existing `mcp/config.ts`, `mcp/registry.ts`, and `tools.ts` still discover the three fixed services, and `mcp/client.ts` applies the explicit legacy compatibility projection only at the ordinary agent-tool boundary. Internally, modern app results retain every accepted content block, annotation, resource link/embedded resource, `structuredContent`, `_meta`, error state, progress identity, and cancellation identity. Milestone 4 additionally routes declared `capability.call` messages to the host-owned [Resume Builder data domain](../../resume-domain/README.md). Milestone 5 routes inference to the separate [no-tools broker](../../resume-inference/README.md), returns only a bounded model-class projection, and retains fact confirmation/definition approval as authenticated host-owner actions.

Spec 05 M2 replaces the former initialization-shaped exchange with the official v2 client pinned to MCP `2026-07-28`. `AppMcpHost` shares one connection manager across launches; connection authority is keyed by installation/server and bound to app, publisher, package digest, runtime identity, and generation. Discovery is atomic across tools, resources, and resource templates. Matching authority reuses the connection, changed/stale authority closes it, read-only negotiation/discovery may reconnect once, and ambiguous tool calls are never replayed. The manager preserves complete results and derives separate model/app projections, validates exact Apps visibility and same-server identity, and verifies `ui://` resource MIME, size, digest, cache identity, and redirect policy before the existing host consumes the resource.

Fixed tools remain deliberately separate: `mcp/host/legacy-adapter.ts` wraps the existing SDK-v1 `2025-11-25` list/call behavior, naming, approval classification, context headers, typed failures, and lossy chat projection. `builds/mcp_release` receives no installed-app authority. The M2 protocol core is documented in [`mcp/host/README.md`](../../mcp/host/README.md); it does not add renderer messages, named capabilities, inference, dynamic server launch, subscriptions, or supervisor lifecycle behavior.

## Sandbox renderer and policy bridge

Spec 05 M3 keeps the trusted React component, intermediate proxy, and app view as three authority layers. The outer proxy contains only fixed code plus a random binding nonce; neither the resource HTML nor any launch identity appears in its URL. It accepts host traffic only from its exact parent with the channel/direction/nonce wrapper, accepts view traffic only from the exact inner window at origin `null`, and forwards no other source. The inner view has no same-origin, forms, object, worker, popup, navigation, download, device, clipboard, storage, cookie, parent-DOM, direct gateway, or Tauri authority. Its packaged SHA-256 and UUID helpers use only `TextEncoder`, arithmetic, and `crypto.getRandomValues`, which remain available under the opaque origin.

`McpAppBridgeController` enforces proxy-ready/initialize/initialized ordering, exact JSON-RPC and compatibility-message schemas, unique IDs, 64 KiB payloads, depth 32, 100 messages per 10 seconds, 16 outstanding requests, cancellation, late-result discard, resize bounds, generation teardown, and default-deny methods. `ui/message` and `ui/update-model-context` are explicitly rejected so app content cannot enter model context. The trusted gateway adapter constructs the installation/view/operation/generation/provenance envelope; the app does not construct authority claims or hold a runtime credential.

`BrowserActionBroker` permits only configured HTTPS origins, host gesture plus confirmation, bounded clipboard writes, and allowlisted export MIME/size/name. The current Resume Builder policy allows `https://docs.braindrive.ai`, clipboard write up to 16 KiB, and PDF export up to 2 MiB. The host performs the action and returns only a safe outcome or destination label. All other schemes, origins, clipboard reads, direct downloads, raw paths, and unconfirmed actions fail closed.

## Capability boundary

The [capability registry](../../app-capabilities/README.md) contains eleven version-1 data/export actions plus the M5 `app.inference.request` action. For every action the host derives the owner, actor, app, publisher, package digest, grant/revision, revocation generation, installation, connection, view, operation, idempotency, audience, capability, and record scopes. The token broker verifies those claims against the current lifecycle grant, permits one exact use, and revokes at installation, connection, or view closure. Equivalent concurrent and completed retries coalesce through the operation coordinator; canonical input mismatch conflicts before the selected adapter.

Sandbox actions keep bearer authority entirely in the host session. App-server actions use `POST /internal/apps/resume-builder/capabilities` with a short-lived one-use bearer and the configured gateway internal transport credential. The route does not accept owner authentication as app-server authority. The data router receives only the verified authority projection, invokes one exact opaque Spec 02 adapter, and rechecks connection/view/current-grant identity. Export destination selection and bytes remain top-level host actions; only safe status, label, and opaque artifact identity cross the app boundary.

Inference tokens use only the `app_inference` audience and the exact inference capability. The [M5 adapter](../../app-inference/README.md) validates the versioned invocation, clamps its budget to the accepted purpose ceiling, constructs the frozen protected request with `tools: false` and fallback disabled, and then invokes the existing Spec 03 broker. Safe progress/terminal events, usage availability, validation findings, and a model class cross the app boundary; provider/model IDs, credentials, secret references, endpoints, policy messages, immutable context, and raw provider bodies do not. Configuration recovery opens the existing BrainDrive Settings modal and adds no app-owned selector.

## Owner routes and web surface

When `BRAINDRIVE_APP_PLATFORM_ENABLED=true`, the existing owner-administration lifecycle routes are joined by:

- `POST /apps/resume-builder/launch`
- `POST /apps/resume-builder/bridge`
- `POST /apps/resume-builder/apps-bridge` for host-constructed, session-bound Apps JSON-RPC requests
- `DELETE /apps/resume-builder/sessions/:sessionId/requests/:operationId` for one request cancellation
- `DELETE /apps/resume-builder/sessions/:sessionId`
- `POST /apps/resume-builder/data/call` for host-owned owner actions; failures use the M1 content-free `{ error, owner_state }` contract
- `POST /internal/apps/resume-builder/capabilities` for authenticated app-server capability calls; this is not an owner route and requires an exact one-use capability bearer

The web client exposes one top-level `Apps` sidebar entry. Its single Resume Builder card shows exact app/publisher identity, lifecycle and operation state, installed/available version, signed trust and revocation status, source, host/protocol/data compatibility, requested/granted capabilities, and selective-retention disclosures. It exposes install/reinstall, launch, disable/enable, update, rollback, recovery, and uninstall. Uninstall uses a focus-managed confirmation that names removed authority/code/cache and retained career data/history/exports. Ambiguous transport completion triggers a status refresh before the UI claims an outcome. States use readable text in addition to color, controls wrap at narrow widths, and closing the iframe returns focus to Launch.

## Verification

Focused host checks from `builds/typescript`:

```bash
npm run test -- app-platform/mcp-host mcp/result-envelope.test.ts
npm run test -- mcp/host mcp engine/loop.test.ts
npm run web:test -- src/components/apps src/components/layout/AppShell.test.tsx src/components/layout/Sidebar.test.tsx src/api/apps-adapter.test.ts
npm run web:test -- --run src/mcp-apps src/components/apps/SandboxedAppFrame.test.tsx
npm run web:typecheck
npm run web:build
npm run test -- app-platform/mcp-host/app-view-registry.test.ts app-platform/mcp-host/parity-normalizer.test.ts app-platform/mcp-host/live-fixture.integration.test.ts
```

The M4 evidence and frozen scope/token matrix are recorded in [`app-capabilities/SPEC-05-M4-VERIFICATION.md`](../../app-capabilities/SPEC-05-M4-VERIFICATION.md).

`live-fixture.integration.test.ts` installs and starts the real signed version-3 fixture, negotiates over its authenticated HTTP endpoint, loads the `ui://` resource, preserves a mixed complete result, then proves disable invalidates the existing session. `client_web/e2e/resume-builder.spec.ts` additionally proves the double iframe, opaque storage/cookie/parent/Tauri boundary, injected CSP, forged-parent rejection, focus, deterministic reload/teardown, brokered browser PDF save, and direct retained-data reopen against disposable synthetic data. No packaged-desktop parity claim is made by this browser run.
