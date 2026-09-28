# Spec 05 Milestone 3 verification

Date: 2026-08-09

Scope: REQ-002–003, REQ-010–017, REQ-029–030, and REQ-038–044. This evidence depends on the accepted Spec 05 M1 contracts and M2 protocol/resource core. It does not claim M4+ named capability, inference, supervision, lifecycle UI, or packaged-desktop behavior.

## Governing context

- `AGENTS.md`
- `docs/developers/README.md`
- `docs/developers/catalog.json` task routes `mcp-tools`, `web-to-tool`, and `verification`
- `docs/developers/integrations/mcp-and-tools.md`
- `docs/developers/verification.md`
- `app-platform/contracts/SPEC-05-M1-VERIFICATION.md`
- `mcp/host/SPEC-05-M2-VERIFICATION.md`
- accepted Spec 05, implementation plan section 8.3, and Milestone 3 prompt
- MCP Apps `2026-01-26` schemas and sandbox lifecycle from pinned `@modelcontextprotocol/ext-apps` `1.7.5`

## Renderer and bridge evidence

- The trusted component loads a fixed `data:` proxy. The proxy URL contains only fixed code and a random nonce; tests prove it contains no resource HTML, session/installation ID, or bridge credential.
- The proxy is cross-origin from the host and creates the inner view with `sandbox="allow-scripts"`. The inner view has opaque origin `null`; browser assertions prove local storage, cookies, and parent DOM are blocked and Tauri globals are absent in the accepted web target.
- The host sends the validated M2 HTML only after `ui/notifications/sandbox-proxy-ready`, using `ui/notifications/sandbox-resource-ready`. The proxy injects a restrictive CSP and denies device/clipboard permissions.
- The view performs `ui/initialize` followed by `ui/notifications/initialized`. The initialization response contains only presentation context; tests prove it excludes runtime credentials, paths, and launch identity.
- The controller validates exact proxy window, origin, nonce, source kind, protocol/lifecycle order, schema/method, unique request IDs, 64 KiB size, depth 32, 100 messages/10 seconds, 16 outstanding requests, cancellation, late-result generation, resize, and teardown before side effects.
- The trusted adapter constructs the gateway envelope. The app never holds or serializes its bridge token. The gateway rechecks installation, view, operation, bridge generation, exact same-server connection, replay/time/rate, app-visible tool, and launch-resource identity.
- `ui/message` and `ui/update-model-context` are rejected. Complete tool results use the app projection; the M2 projection tests independently prove model/app separation.
- Link, clipboard-write, and PDF initiation policy is default deny. Allowed operations require configured HTTPS origin or MIME/size/name, host gesture, and host-owner confirmation; the app receives only a safe result/label.

## Threat cases

| Case | Result | Evidence |
| --- | --- | --- |
| Forged parent/proxy message | Rejected before side effect | nonce/source wrapper unit tests and desktop browser request-count assertion |
| Wrong source or non-opaque origin | Rejected | bridge controller tests |
| View-forged proxy control | Rejected | bridge controller tests |
| Stale, replayed, wrong-view/generation, cross-server | Rejected | host and controller tests |
| Unknown or model-context method | Rejected | bridge controller tests |
| Oversized, too-deep, flooded, or >16 outstanding | Rejected/bounded | bridge controller tests |
| Cancellation and late result | Cancelled; late result discarded | controller, route, and M2 manager tests |
| Model-only/hidden tool or undeclared resource | Rejected | host tests |
| Unsafe link, clipboard, export name/type/size | Rejected with safe code | browser policy tests |
| Same-origin storage/cookie/parent/Tauri access | Blocked or absent | desktop Chrome Playwright assertions |
| Runtime credential or raw path in frame payload | Absent | proxy, initialization, adapter, export projection tests plus source scan |

## Commands and results

- `npm run test -- mcp`: pass, 10 files / 43 tests.
- `npm run test`: pass, 84 files / 594 tests.
- `npm run web:typecheck`: pass.
- `npm run web:test`: pass, 24 files / 222 tests.
- `npm run web:build`: pass; Vite reported existing font-resolution and chunk-size warnings.
- `npm run web:lint`: pass.
- `npm run test:e2e -- --project=desktop-chrome`: pass; mobile run 12 passed / 8 skipped, desktop run 5 passed / 5 skipped. Resume Builder is intentionally skipped on mobile and passes on desktop Chrome.
- `npm run build`: pass.
- Resume Builder package `npm run test && npm run build`: pass, 4 files / 11 tests, then TypeScript build pass.
- `npm run docs:test`: pass, 164 tests / 163 passed / 1 platform-specific skip. `npm run docs:check`: pass, 246 scoped candidates / 0 diagnostics. `npm run docs:verify`: pass with the same results.
- Root `node tools/docs/sync-generated.mjs --check` and `git diff --check`: pass after the final catalog/evidence update.

## Inspection and limitation

The accepted isolated local web target was exercised through Chromium with DOM, accessibility, focus, download, nested-frame, CSP, origin, storage, cookie, parent-DOM, Tauri-global, reload, teardown, and screenshot checkpoints. A human visual review and a packaged Tauri executable were not available in this non-interactive environment, so this milestone makes no packaged-desktop runtime claim beyond the required desktop-Chrome Playwright run and source/config review.
