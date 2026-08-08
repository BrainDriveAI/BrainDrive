# MCP and tool integration boundary

**Maturity: internal beta under the resolved OPEN-02 decision.** First-party services are supported only under BrainDrive's standard same-release orchestration and trusted network boundary. Custom or external MCP is experimental. The repository contains working application components, not an SDK, plugin ABI, semantic-version compatibility promise, or arbitrary third-party server guarantee.

## Discovery and execution

`discoverTools` loads each `tool_sources` entry. Built-in sources create in-process tools; MCP JSON sources are parsed by `mcp/config.ts`, which accepts Streamable HTTP servers, enforces unique ids, requires `system_shipped` sources to be `first_party`, resolves declared header environment references, and registers enabled servers. The MCP client lists tools and creates a local definition whose execution performs a bounded remote call.

Runtime `ToolDefinition` carries name, description, approval/read-only flags, input schema, and execution callback. It does not carry MCP trust/isolation/required fields. `mcp/config.ts` validates source/trust/isolation/required server metadata, but only the `system_shipped`/`first_party` relationship is enforced; provenance is included in the generated tool description. `ToolExecutor.listTools`/`execute` authorize using the gateway auth context and tool-name permission mapping. Read-only tool names control `requiresApproval`; this is local classification, not server attestation, independent authentication, or a guarantee of no writes. `auto-approve` also skips the approval wait.

`mcp/client.ts` deliberately projects fixed-service call results into the historical agent-tool value shape. The complete result authority now lives in `mcp/result-envelope.ts`; the fixed path's projection is an isolated compatibility adapter rather than the internal representation.

## Installed MCP Apps

When the Docker-development app platform is enabled, the signed Resume Builder fixture uses the separate [modern MCP Apps host](../../../builds/typescript/app-platform/mcp-host/README.md). That host negotiates exact MCP/App versions, retains complete content/resource/annotation/metadata envelopes, reads only declared bounded `ui://` UI resources, and brokers only same-server app-visible operations through an opaque-origin sandbox session. M5 model operations go through the separate [app-scoped no-tools broker](../../../builds/typescript/resume-inference/README.md); they do not use static MCP config, register tools into the agent loop, expose credentials/provider identifiers to the app, or inherit the legacy permission-header fallback.

The workspace pins `@modelcontextprotocol/sdk` `1.30.0` and `@modelcontextprotocol/ext-apps` `1.7.5` exactly. Accepted protocol constants remain the normative wire authority; package versions alone do not imply compatibility.

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

Source/tests: `builds/typescript/tools.ts`, `mcp/{config,registry,client,result-envelope}.ts`, `mcp/servers*.json`, `app-platform/mcp-host/`, `builds/mcp_release/src/{index,server-factory,first-party-tools,request-context,memory-core}.ts`, package unit tests, and [the source-adjacent README](../../../builds/mcp_release/README.md).
