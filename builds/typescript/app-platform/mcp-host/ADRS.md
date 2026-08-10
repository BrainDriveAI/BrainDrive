# Milestone 3 implementation decisions

These records apply the project-owner approvals dated 2026-08-07 in Resume Builder Specs 1–5, the accepted verification plan, and ADR-RB-001 through ADR-RB-013. The source spec remains behavioral authority.

## ADR-RB-014 — Separate modern installed-app transport from the fixed-tool adapter

**Decision:** Keep `mcp/config.ts`, `mcp/registry.ts`, and `tools.ts` as the existing fixed-service path. Preserve rich MCP call results in `mcp/result-envelope.ts`, and invoke the historical lossy projection only from `mcp/client.ts` when an ordinary agent tool expects the old value. Installed apps use `app-platform/mcp-host/modern-client.ts`, which requires MCP `2026-07-28`, `io.modelcontextprotocol/ui` `2026-01-26`, and tools/resources capabilities. The exact workspace evidence pins are SDK `1.30.0` and extension package `1.7.5`.

**Reason:** The fixed services and agent loop have a stable value contract and a documented legacy owner-header window. Reusing that path for installed apps would discard content and inherit ambient authority. A separate adapter makes rollback explicit and prevents legacy behavior from becoming the installed-app default.

## ADR-RB-015 — Preserve complete envelopes internally and expose a validated UI projection

**Decision:** Retain the complete initialization, resource-list, tool-list, resource-read, annotations, and `_meta` envelopes in the modern session. Retain complete accepted tool result blocks and metadata in the version-1 complete-result contract. Return only the validated `McpAppResource` HTML projection and app-visible tool names to the owner web client.

**Reason:** Modern MCP/App behavior needs metadata for compatibility and future host decisions, while raw server envelopes are unnecessary browser authority. The split meets the no-flattening contract without exposing internal connection or package metadata.

## ADR-RB-016 — Opaque-origin `srcDoc` sandbox and parent-mediated bridge

**Decision:** Render the signed `ui://` resource through `srcDoc` with `sandbox="allow-scripts"`, no same-origin/navigation/forms/popups/download flags, no referrer, and a deny-by-default Permissions Policy. Require an inline CSP with `default-src 'none'`, `connect-src 'none'`, and `form-action 'none'`; reject external URLs, executable navigation schemes, nested browsing contexts, forms, network APIs, direct location changes, download markers, and direct Tauri use. The parent validates `event.source`, opaque origin, and encoded size before using its authenticated gateway adapter. The gateway then validates the versioned bridge schema, session/audience/installation/view/operation/token bindings, freshness, replay/rate limits, server identity, and app visibility.

**Reason:** An opaque iframe cannot directly call authenticated BrainDrive APIs. Parent mediation permits an auditable, revocable least-authority channel without trusting UI content or legacy MCP permission headers.

## ADR-RB-017 — Version 3 is the independently signed modern conformance fixture

**Decision:** Preserve versions 1.0.0 and 2.0.0 as the legacy lifecycle/update fixtures under their original generated authority. Modern releases use a separately generated Ed25519 authority per immutable package version under `fixture-source/modern/<version>`. Version 3.0.1 is the first patch release on this layout, replacing the incompatible 3.0.0 fixture without rewriting its signed bytes. Version 3.0.2 adds the responsive app resource. Version 3.1.0 adds the novice-guided interview, editable fact review, structured resume drafting, and improved single-column typography. Version 3.2.0 adds conformance-backed generation, per-job accomplishment association, immediate approved-state refresh, duplicate-confirmation reuse, structured job rendering, and restart-resilient owner-data leases. Version 3.2.1 keeps newly generated general and targeted drafts in their review screens even when an older approved tailored resume already exists. Version 3.2.2 retains the exact user-visible interview question, submitted answer, follow-up outcome, prompt version, session identity, and skipped turns as owner-data provenance without placing content in diagnostics. Discovery retains every prior version-specific authority so installed releases can be verified before an owner-approved update. The current package exposes only modern `server/discover`, tools list/call, resources list/read, the bounded `ui://resume-builder/main` UI, and the app-visible `fixture.status` test tool.

**Reason:** Public trust material can survive restarts without persisting private signing keys, so it cannot sign a later package. A narrow authority per release is the repository-consistent key-rotation equivalent, avoids weakening or rewriting already verified bytes, and lets an installed older version surface an explicit owner-approved update.

## ADR-RB-018 — One top-level Apps surface, still Docker-dev gated

**Decision:** Implement the accepted top-level Sidebar/SidebarCollapsed `Apps` entry and a combined single-app management/launch page. Register host routes only alongside the existing feature-gated Docker lifecycle. Do not change production/native/desktop enablement or add Career/resume workflow UI.

**Reason:** This follows the M1 placement decision and preserves AppShell/project/chat/settings behavior. Keeping the server feature gate means the UI reports Apps unavailable outside accepted environments rather than silently enabling unfinished runtime support.

## ADR-RB-019 — Resume rotates transport authority, not durable work identity

**Decision:** `AppViewRegistry` owns an atomic plan/commit reconnect boundary. An exact current resume retains `view_id` and durable `operation_id`, rotates `session_id`, increments `bridge_generation`, and invalidates the superseded session. New and concurrent views receive distinct host-generated identities. Close and cancellation use exact current-session lookup and never scan other sessions or views. The host performs lifecycle, readiness, MCP, resource, and sandbox checks before committing either a new or resumed view.

Docker/packaged-desktop parity is compared through the version-1 Spec 05 parity contract. Only transport, process isolation, package-root reference, cache-root reference, and diagnostic platform are separated as permitted runtime differences; protocol, policy, state, error, and outcome semantics are not. Missing native-target observations are blocked evidence.

**Reason:** Reload is a transport replacement, while Spec 02 operations and M4/M5 idempotency survive it. Keeping durable identities stable prevents duplicate writes, exports, and provider spend; rotating session and bridge generations makes late messages incapable of committing or rendering. Exact lookup prevents cancellation, close, and focus authority from crossing concurrent views. Refusing to synthesize a missing target keeps release claims grounded in executable evidence.
