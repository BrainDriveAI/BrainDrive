# Modern MCP Apps host

This directory began as the Milestone 3 host boundary and now composes the M4 named data router, M5 brokered inference boundary, and M6 host-owned approval/export bridge. It launches only the active signed repository fixture from the Milestone 2 lifecycle service. Rendering remains in the separate deterministic renderer package. It does not implement desktop supervision, marketplace discovery, general MCP prompts/completions, or remote OAuth.

## Host flow

1. `AppMcpHost` resolves the active installation and its private loopback runtime connection from the lifecycle supervisor.
2. `ModernMcpAppsClient` negotiates exactly MCP `2026-07-28` plus `io.modelcontextprotocol/ui` `2026-01-26`, requiring both tools and resources before any resource read.
3. The client lists tools/resources, reads the declared `ui://resume-builder/main` resource, retains complete list/read metadata internally, validates its exact media type and encoded size, and rejects HTML that violates the fail-closed content policy.
4. The host creates an installation/view/operation/session-bound bridge, consumes the raw one-use bootstrap token, and returns only opaque IDs plus the validated UI projection to the authenticated owner client.
5. The web client renders the HTML through `srcDoc` in an opaque-origin iframe with `sandbox="allow-scripts"`. It checks both the exact iframe window and origin `null` before forwarding a bounded message.
6. The gateway accepts only the typed bridge envelope for that owner session. Same-server app-visible tools and declared data capabilities are allowed. A consumed `app_data` or `app_export` token is immediately reduced to the strict Resume data authority projection, and the data policy rechecks the current lifecycle grant before record lookup. Inference uses a one-use `app_inference` token; export uses a one-use `app_export` token and the host-owned browser-save boundary. Fact confirmation and definition approval are intercepted for authenticated owner confirmation. Cross-server/model-only calls, undeclared host actions, stale, replayed, revoked, malformed, oversized, or wrongly bound messages fail closed.

Disable, update, uninstall, lifecycle generation change, expiry, tab hiding, iframe closure, and gateway shutdown remove bridge-session authority. The sandbox receives no bearer credential, owner permission object, host path, filesystem/Tauri API, arbitrary network permission, download authority, or unrestricted MCP endpoint.

## Compatibility boundary

The modern installed-app path is independent from fixed tool discovery. Existing `mcp/config.ts`, `mcp/registry.ts`, and `tools.ts` still discover the three fixed services, and `mcp/client.ts` applies the explicit legacy compatibility projection only at the ordinary agent-tool boundary. Internally, modern app results retain every accepted content block, annotation, resource link/embedded resource, `structuredContent`, `_meta`, error state, progress identity, and cancellation identity. Milestone 4 additionally routes declared `capability.call` messages to the host-owned [Resume Builder data domain](../../resume-domain/README.md). Milestone 5 routes inference to the separate [no-tools broker](../../resume-inference/README.md), returns only a bounded model-class projection, and retains fact confirmation/definition approval as authenticated host-owner actions.

The workspace pins `@modelcontextprotocol/sdk` `1.30.0` and `@modelcontextprotocol/ext-apps` `1.7.5` exactly as accepted compatibility evidence. The installed-app wire adapter explicitly enforces the accepted future protocol constants instead of treating the SDK package version as protocol authority. `builds/mcp_release` remains the legacy fixed-service package and never receives installed-app bridge authority or the broad legacy request-context fallback.

## Owner routes and web surface

When `BRAINDRIVE_APP_PLATFORM_ENABLED=true`, the existing owner-administration lifecycle routes are joined by:

- `POST /apps/resume-builder/launch`
- `POST /apps/resume-builder/bridge`
- `DELETE /apps/resume-builder/sessions/:sessionId`
- `POST /apps/resume-builder/data/call` for host-owned owner actions; failures use the M1 content-free `{ error, owner_state }` contract

The web client exposes one top-level `Apps` sidebar entry. Its single Resume Builder card shows exact app/publisher identity, lifecycle and operation state, installed/available version, signed trust and revocation status, source, host/protocol/data compatibility, requested/granted capabilities, and selective-retention disclosures. It exposes install/reinstall, launch, disable/enable, update, rollback, recovery, and uninstall. Uninstall uses a focus-managed confirmation that names removed authority/code/cache and retained career data/history/exports. Ambiguous transport completion triggers a status refresh before the UI claims an outcome. States use readable text in addition to color, controls wrap at narrow widths, and closing the iframe returns focus to Launch.

## Verification

Focused host checks from `builds/typescript`:

```bash
npm run test -- app-platform/mcp-host mcp/result-envelope.test.ts
npm run web:test -- src/components/apps src/components/layout/AppShell.test.tsx src/components/layout/Sidebar.test.tsx src/api/apps-adapter.test.ts
```

`live-fixture.integration.test.ts` installs and starts the real signed version-3 fixture, negotiates over its authenticated HTTP endpoint, loads the `ui://` resource, preserves a mixed complete result, then proves disable invalidates the existing session. M6 adds `client_web/e2e/resume-builder.spec.ts`, which proves Career entry, host-owned approvals, tailored child creation, parse-back, browser PDF save, history, and direct retained-data reopen against disposable synthetic data. No desktop parity claim is made.
