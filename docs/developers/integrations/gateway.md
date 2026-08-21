# Gateway integration boundary

**Maturity: internal beta under the resolved OPEN-02 decision.** The supported use is the bundled BrainDrive web or Tauri client with the runtime from the same tagged release. This is not a public third-party API or a cross-version compatibility promise; during beta, routes and payloads may change when source, tests, documentation, and release notes change together.

## Current contract shape

The Fastify composition in `builds/typescript/gateway/server.ts` exposes route families for health/config, auth/session, message SSE and approvals, conversations/projects/skills, settings/providers/credentials, memory backup/export/migration, support bundles, credits, and managed account proxies. Route source and adapter tests—not this summary—define exact payloads.

The web adapter addresses routes under `/api`; browser deployments proxy that prefix, while Tauri rewrites it to the embedded gateway base and adds its desktop token. The gateway itself registers paths without `/api`.

`POST /message` validates the client request, persists the user message, composes system/project/skill/context input, resolves the active provider, and emits SSE. Expected events and persistence are traced in [request flows](../architecture/request-flows.md). Non-streaming failures use HTTP status and JSON; streaming provider/engine failures become an `error` SSE event where possible.

Credits routes are owner-facing gateway routes for BrainDrive Models. `POST /credits/checkout` and `GET /credits/status` share the dedicated BrainDrive Models secret reference and encrypted vault value. `GET /credits/status` does not resolve the active provider credential; active Ollama or BYOK OpenRouter selection cannot change the hosted credits key. The gateway maps hosted status into `purchase_status`: `activating` when the host reports `checkout_pending` or a legacy host response leaves local pending unresolved, `ready` when the exact status has remaining balance, `zero_balance` when settled at zero, `repair_required` when the dedicated secret is missing after prior setup or rejected by the host, and `unavailable` for transient host/network/malformed status failures. Local checkout pending is cleared only on exact ready or zero settlement, not from historical purchase totals.

The bundled Settings UI treats `activating` as bounded recovery, not indefinite progress. It polls status every three seconds for up to 120 seconds, stops on ready, zero balance, repair required, or unavailable at the deadline, and exposes a retry action that rechecks status without starting a duplicate checkout. A transient hosted status failure preserves the BrainDrive Models key metadata; only a missing or host-rejected dedicated key enters repair.

## Authentication and trust

Public routes are explicitly enumerated. In managed deployment, `PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES` defaults to enabled, making five `/account*` proxies exempt from this gateway's request-auth hook while the upstream cookie/session remains the account boundary. Optional transport-token enforcement is earlier and still applies when configured. Setting the option false restores gateway request auth. Local-owner headers, local JWT bearer tokens, and the desktop token are different contracts. The source-level `auth_mode=managed` header comparison is inconsistent and lacks a focused protected-route test; see [modes and trust](../architecture/modes-data-and-trust.md). Never expose a local gateway or upstream header-injection boundary on an untrusted network based on this internal description.

The engine can wait for approval and the gateway enforces approval authority, but the current web `ask-on-write` path immediately submits an approved decision when it receives `approval-request`. Do not describe the current web behavior as a human confirmation dialog.

## Safe validation

Tier A/B repository checks: from `builds/typescript`, run `npm test`, `npm run build`, `npm run web:typecheck`, and `npm run web:test`. A controlled provider-independent startup may validate health/config and the web shell, but provider response validation is separate Tier C work. No command in this page grants production, account, or credential authority.

Source/config/tests: `gateway/server.ts`, `auth/middleware.ts`, `contracts.ts`, `client_web/src/api/{gateway-adapter,config-adapter,runtime-api-base}.ts`, gateway integration/unit tests, and web adapter/hook tests.

The pre-Milestone-3 client contract is preserved as [historical context](../history/gateway-contract-original-client.md). It is not current authority.
