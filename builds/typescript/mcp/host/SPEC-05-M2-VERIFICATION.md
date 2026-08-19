# Spec 05 Milestone 2 verification record

Milestone: Complete MCP Sessions, Envelopes, Resources, and Legacy Adapter

Status: Implementation complete; verification results are recorded below.

## Governing context

- Working authority: `AGENTS.md`, `docs/AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json`, and `docs/developers/verification.md`.
- Product authority: `spec-05-mcp-app-host-and-supervised-server-runtime.md`.
- Build authority: `spec-05-mcp-app-host-and-supervised-server-runtime-implementation-plan.md`, Milestone 2, and the attached M2 prompt pack.
- Accepted prerequisite: `app-platform/contracts/SPEC-05-M1-VERIFICATION.md` plus its generated contracts, fixtures, and dependency locks.
- Executable evidence: `connection-manager.ts`, `sdk-peer.ts`, `errors.ts`, `legacy-adapter.ts`, `mcp/result-envelope.ts`, their focused tests, and the authenticated live fixture test.

## Acceptance evidence

| Gate | Evidence |
|---|---|
| M2-AC1 | Pinned official-v2 negotiation plus incompatible-era, missing-capability, and missing-Apps rejection before catalog publication |
| M2-AC2 | Golden and 128-case property coverage for every accepted ordered content kind, structured content, metadata, errors, and correlations |
| M2-AC3 | Atomic tools/resources/templates catalogs and URI/MIME/package/digest/size/cache validation with typed failures |
| M2-AC4 | Reuse, conflicting/stale generation, progress, abort/cancel, read-only reconnect, no tool replay, duplicate operation, late response, and close tests |
| M2-AC5 | Exact model/app visibility projections and same-connection enforcement |
| M2-AC6 | Explicit bounded legacy profile with fixed naming, schema, approval, result-precedence, and typed-error regression evidence |
| M2-AC7 | Required main/MCP builds, tests, documentation checks, and diff checks recorded in the final section |

Requirements covered: REQ-004–REQ-010, REQ-012–REQ-013, REQ-030, and the M2 portions of REQ-038–REQ-044. Later-milestone renderer, bridge-message, capability, inference, supervisor-launch, subscription, and parity claims are excluded.

## Complete-envelope projection trace

Redacted example:

```text
server result
  content: [text(shared), resource_link(app-only), embedded_resource(shared)]
  structuredContent: { status: "ready" }
  _meta: { ui.visibility: ["model", "app"], ...host-retained }
  isError: false
        |
        v preserveMcpResult (ordered complete authority)
  correlation: protocol + connection + request + operation + cancel/progress
  projections: model=[0,2], app=[0,1,2]
        |                              |
        v                              v
model projection                 app projection
  shared blocks only               all app-authorized blocks
  structured data if allowed       structured data + retained metadata
  no progress/cancel metadata       progress/cancel correlation retained
```

The fixed tool adapter does not use these projections; it returns the historical `structuredContent`, then `toolResult`, then first-text JSON/plain-text precedence.

## Verification results

Commands executed in the working tree immediately before handoff:

| Command | Result |
|---|---|
| `npm run test -- mcp engine/loop.test.ts` | PASS — 11 files, 53 tests |
| `npm run test` | PASS — 84 files, 592 tests |
| `npm run build` | PASS |
| `builds/mcp_release: npm run test` | PASS — 2 files, 6 tests |
| `builds/mcp_release: npm run build` | PASS |
| `npm run docs:verify` | PASS — 163 passed, 1 platform skip; documentation check found 0 diagnostics |
| `node tools/docs/sync-generated.mjs --check` | PASS |
| `git diff --check` | PASS |

The additional main-workspace lint check remains blocked by one pre-existing unrelated violation at `app-platform/lifecycle/verified-package-store.ts:168` (`error` does not match the repository's allowed unused-catch naming rule). The M2 files add no lint findings. The task does not authorize changing that lifecycle-store line.

One full-suite rerun performed concurrently with the TypeScript build hit the existing 5-second timeout in `resume-domain/service.test.ts`. Its focused rerun passed all 11 tests, and the subsequent sequential full-suite rerun passed all 592 tests. This is recorded as a load-sensitive test flake, not omitted evidence.

No Docker/packaged-desktop parity, browser DOM, external provider, remote server, or conformance-CLI claim is made in M2. The authenticated signed loopback fixture and official SDK task-owned loopback peer are the live protocol evidence for this milestone.
