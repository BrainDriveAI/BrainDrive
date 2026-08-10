# Gateway integration boundary

**Maturity: internal beta under the resolved OPEN-02 decision.** The supported use is the bundled BrainDrive web or Tauri client with the runtime from the same tagged release. This is not a public third-party API or a cross-version compatibility promise; during beta, routes and payloads may change when source, tests, documentation, and release notes change together.

## Current contract shape

The Fastify composition in `builds/typescript/gateway/server.ts` exposes route families for health/config, auth/session, message SSE and approvals, conversations/projects/skills, settings/providers/credentials, memory backup/export/migration, support bundles, credits, and managed account proxies. When `BRAINDRIVE_APP_PLATFORM_ENABLED=true`, it also registers the owner-authenticated `/apps` catalog and `/apps/resume-builder` lifecycle/status/inspection/session routes, modern launch/bridge, named owner-data capabilities, and app-scoped inference documented by the [lifecycle boundary](../../../builds/typescript/app-platform/lifecycle/README.md), [MCP Apps host](../../../builds/typescript/app-platform/mcp-host/README.md), [owner-data domain](../../../builds/typescript/resume-domain/README.md), and [inference broker](../../../builds/typescript/resume-inference/README.md). Lifecycle mutations bind an operation ID, lifecycle generation, owner, and exact installation before changing state. Their DTOs intentionally project identity/trust/version/source/compatibility/capability/retention/progress/recovery without host paths, tokens, raw metadata, or owner content. Route source and adapter tests—not this summary—define exact payloads.

The web adapter addresses routes under `/api`; browser deployments proxy that prefix, while Tauri rewrites it to the embedded gateway base and adds its desktop token. The gateway itself registers paths without `/api`. In production, refresh cookies remain `Secure` by default. The only HTTP exception is a request reconstructed by the trusted LAN bridge with the configured internal transport token, browser-access marker, exact `http` forwarded protocol, and normalized client IP; that cookie remains `HttpOnly` and `SameSite=Strict`. Direct clients cannot opt into the exception because the bridge strips and replaces all transport-identity headers.

`POST /message` validates the client request, persists the user message, composes system/project/skill/context input, resolves the active provider, and emits SSE. Expected events and persistence are traced in [request flows](../architecture/request-flows.md). Non-streaming failures use HTTP status and JSON; streaming provider/engine failures become an `error` SSE event where possible.

## Authentication and trust

Public routes are explicitly enumerated. In managed deployment, `PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES` defaults to enabled, making five `/account*` proxies exempt from this gateway's request-auth hook while the upstream cookie/session remains the account boundary. Optional transport-token enforcement is earlier and still applies when configured. Setting the option false restores gateway request auth. Local-owner headers, local JWT bearer tokens, and the desktop token are different contracts. The source-level `auth_mode=managed` header comparison is inconsistent and lacks a focused protected-route test; see [modes and trust](../architecture/modes-data-and-trust.md). Never expose a local gateway or upstream header-injection boundary on an untrusted network based on this internal description.

The engine can wait for approval and the gateway enforces approval authority, but the current web `ask-on-write` path immediately submits an approved decision when it receives `approval-request`. Do not describe the current web behavior as a human confirmation dialog.

## Safe validation

Tier A/B repository checks: from `builds/typescript`, run `npm test`, `npm run build`, `npm run web:typecheck`, and `npm run web:test`. A controlled provider-independent startup may validate health/config and the web shell, but provider response validation is separate Tier C work. No command in this page grants production, account, or credential authority.

Source/config/tests: `gateway/server.ts`, `auth/middleware.ts`, `contracts.ts`, `client_web/src/api/{gateway-adapter,config-adapter,runtime-api-base}.ts`, gateway integration/unit tests, and web adapter/hook tests.

The pre-Milestone-3 client contract is preserved as [historical context](../history/gateway-contract-original-client.md). It is not current authority.
