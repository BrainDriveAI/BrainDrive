# MCP and tool integration boundary

**Maturity: internal beta under the resolved OPEN-02 decision.** First-party services are supported only under BrainDrive's standard same-release orchestration and trusted network boundary. Custom or external MCP is experimental. The repository contains working application components, not an SDK, plugin ABI, semantic-version compatibility promise, or arbitrary third-party server guarantee.

## Discovery and execution

`discoverTools` loads each `tool_sources` entry. Built-in sources create in-process tools; MCP JSON sources are parsed by `mcp/config.ts`, which accepts Streamable HTTP servers, enforces unique ids, requires `system_shipped` sources to be `first_party`, resolves declared header environment references, and registers enabled servers. The MCP client lists tools and creates a local definition whose execution performs a bounded remote call.

Runtime `ToolDefinition` carries name, description, approval/read-only flags, input schema, and execution callback. It does not carry MCP trust/isolation/required fields. `mcp/config.ts` validates source/trust/isolation/required server metadata, but only the `system_shipped`/`first_party` relationship is enforced; provenance is included in the generated tool description. `ToolExecutor.listTools`/`execute` authorize using the gateway auth context and tool-name permission mapping. Read-only tool names control `requiresApproval`; this is local classification, not server attestation, independent authentication, or a guarantee of no writes. `auto-approve` also skips the approval wait.

`mcp/client.ts` deliberately projects fixed-service call results into the historical agent-tool value shape. The complete result authority now lives in `mcp/result-envelope.ts`; the fixed path's projection is an isolated compatibility adapter rather than the internal representation.

## Installed MCP Apps

When the Docker-development app platform is enabled, the signed Resume Builder fixture uses the separate [modern MCP Apps host](../../../builds/typescript/app-platform/mcp-host/README.md). That host negotiates exact MCP/App versions, retains complete content/resource/annotation/metadata envelopes, reads only declared bounded `ui://` UI resources, and brokers only same-server app-visible operations through an opaque-origin sandbox session. M5 model operations pass through the [protected inference capability](../../../builds/typescript/app-inference/README.md) into the existing [app-scoped no-tools broker](../../../builds/typescript/resume-inference/README.md); they do not use static MCP config, register tools into the agent loop, expose credentials/provider identifiers to the app, or inherit the legacy permission-header fallback.

The accepted Spec 05 foundation pins the split `@modelcontextprotocol/client`, `core`, `server`, and `node` packages at `2.0.0` for stateless MCP `2026-07-28`; `@modelcontextprotocol/sdk` `1.30.0` remains the bounded fixed-tool MCP `2025-11-25` dependency; and `@modelcontextprotocol/ext-apps` `1.7.5` supplies the Apps `2026-01-26` evidence surface. The focused M1 loopback test proves one fake peer serves both eras. These pins are implementation evidence; the accepted protocol constants remain wire authority.

Spec 05 M2 implements that corrective runtime in `mcp/host/`: the installed-app path now uses the official v2 client with pinned `server/discover` negotiation, installation/server/generation connection reuse, atomic tools/resources/templates discovery, bounded read-only reconnect, request cancellation/progress correlation, same-server and exact model/app visibility checks, complete result envelopes, and verified `ui://` resource reads. HTTP redirects fail closed; immutable resource cache entries bind package digest, connection generation/ID, URI, and integrity. Failed tool calls are never replayed because their outcome may be ambiguous.

The static first-party path remains an explicit bounded legacy adapter. It still connects through SDK v1, lists and calls only fixed configured tools, preserves tool naming and read-only approval classification, forwards the existing trusted-local request context, and returns the exact historical lossy value projection to chat. It does not negotiate Apps or enter the installed-app connection manager. M2 adds no renderer messages, named capabilities, inference, subscriptions, or supervisor launch behavior; see the [protocol-core boundary](../../../builds/typescript/mcp/host/README.md).

Spec 05 M3 renders a verified Apps resource through a fixed cross-origin `data:` proxy and an inner opaque-origin `sandbox="allow-scripts"` iframe. The proxy receives HTML only after the official sandbox-ready lifecycle message, injects an allowlisted CSP, and binds forwarding to the exact parent/view windows plus a per-render nonce. The view receives safe presentation context but no launch envelope, runtime credential, server identity, host path, storage/cookie/parent DOM, direct gateway, or Tauri authority. The host accepts Apps JSON-RPC only after initialization and enforces exact schemas, IDs, size/depth/rate/outstanding limits, cancellation, generation teardown, same-server app visibility, and separate complete app/model projections. Links, clipboard writes, and PDF initiation remain host-confirmed policy actions; model-context injection methods are denied. See the [installed-app host boundary](../../../builds/typescript/app-platform/mcp-host/README.md).

Spec 05 M4 adds a separate [named capability control plane](../../../builds/typescript/app-capabilities/README.md) for the accepted Spec 02 Resume data/export adapters. Sandbox calls resolve host-held view authority and never receive a bearer. App-server calls use the internal capability route with a one-use exact-bound token and the configured internal transport credential. Both paths check the current Spec 04 grant, package/install/connection/view/operation identity, version, audience, record scope, deadline, cancellation, and canonical idempotency before one adapter call. The route never falls back to fixed-service owner defaults or raw memory tools; export destination and bytes remain host-controlled.

## First-party services

`builds/mcp_release` provides three server kinds:

- `memory`: read, write, edit, delete, list, search, history, and export.
- `auth`: who-am-I, permission check, and auth-state export.
- `project`: project listing.

The tracked full MCP configs declare all three as required first-party, system-shipped services. Configured `tool_sources` and the selected tracked JSON determine the tool graph; do not describe every runtime as having MCP tools.

## Critical trust boundary

The standalone fixed MCP services do not independently authenticate callers. Missing or malformed request-context headers default to a local owner context with owner permissions. This legacy behavior is not allowed for installed apps. The package's standalone Compose file binds `0.0.0.0` and publishes ports 8911–8913. Keep these services loopback-only or inside an explicitly trusted isolated network; never expose those published ports to untrusted clients.

`docker compose down -v` deletes the package's named memory volume and is destructive Tier B cleanup. It is not a routine verification step.

## Verification and known gap

`npm test` and `npm run build` in `builds/mcp_release` are the safe package checks. The declared package `npm run test:integration` currently points to absent `test/integration/mcp-smoke.ts`; that dedicated package test cannot run or be cited until its entrypoint is reconciled. Standard native/Docker orchestration can still provide controlled integration evidence under its own stated prerequisites. Main-workspace MCP registration has source/config evidence but no focused declared registry/config test.

Source/tests: `builds/typescript/tools.ts`, `mcp/{config,registry,client,result-envelope}.ts`, `mcp/host/`, `mcp/servers*.json`, `app-platform/mcp-host/`, `builds/mcp_release/src/{index,server-factory,first-party-tools,request-context,memory-core}.ts`, package unit tests, and [the source-adjacent README](../../../builds/mcp_release/README.md).
