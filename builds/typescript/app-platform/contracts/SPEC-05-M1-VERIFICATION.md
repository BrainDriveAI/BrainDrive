# Spec 05 Milestone 1 verification authority

Status: Accepted

Decision owner: DJJones, Project Owner

Accepted: 2026-08-07

Milestone: Protocol and Security Contract Foundation

## Governing context

- Repository authority: `AGENTS.md`, `docs/AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json`, and `docs/developers/verification.md`.
- Product authority: `spec-05-mcp-app-host-and-supervised-server-runtime.md`.
- Build authority: `spec-05-mcp-app-host-and-supervised-server-runtime-implementation-plan.md` and its Milestone 1 prompt pack.
- Cross-spec verification authority: the accepted Resume Builder `test-plan.md` and Specs 01–04 in `/home/hex/Reference/Designs/BrainDrive-Tools/Resume-Builder/MVP/`.
- Executable evidence: `spec-05-foundation.ts`, `spec-05-m1.test.ts`, generated `schemas/v1/*.schema.json`, and `fixtures/spec-05/`.
- Decision record: ADR-RB-021 in `ADRS.md`.

## Accepted M1 evidence

| Gate | Proof | M1 disposition |
|---|---|---|
| M1-AC1 | `decisions.json` plus ADR-RB-021 | OQ-1–OQ-7 and both repository discrepancies resolved with owners and rationale |
| M1-AC2 | Exact package/lock pins plus task-owned loopback fake peer | Modern pinned `2026-07-28` and legacy default `2025-11-25` clients pass against one v2 server factory |
| M1-AC3 | Strict Zod authorities and generated draft-2020-12 JSON Schemas | Protocol, result/projection, resource, view, bridge, authority, inference, diagnostics, supervisor policy, and parity are versioned |
| M1-AC4 | `conformance-corpus.json`, property mutations, fake provider/supervisor, forbidden diagnostic cases | Neutral/adversarial inputs have deterministic outcomes and contain no private or executable material |
| M1-AC5 | `requirements.json` | REQ-001–REQ-045 each maps once to automated/live/human/release evidence, a milestone acceptance gate, and an accountable role |
| M1-AC6 | Required regression/build commands plus scope/diff review | This diff adds no app HTML, live bridge, capability or inference execution, dynamic registration, or process/container launch |

The M1 protocol test is a bounded local SDK compatibility proof, not installed-app execution. It creates a task-owned loopback HTTP server with a static fake tool, negotiates both protocol eras, closes both clients, closes the SDK handler, and closes the server in the same test. It contains no app resource, HTML, capability handler, provider call, package entrypoint, or process spawn.

## Dependency and version matrix

| Surface | Exact package | Contract role |
|---|---|---|
| Modern client | `@modelcontextprotocol/client@2.0.0` | Pinned modern/auto version negotiation |
| Modern core | `@modelcontextprotocol/core@2.0.0` | MCP `2026-07-28` types and envelopes |
| Fake-peer server | `@modelcontextprotocol/server@2.0.0` | Per-request modern plus bounded legacy factory |
| Node test adapter | `@modelcontextprotocol/node@2.0.0` | Task-owned loopback fake peer only in M1 |
| Fixed-service compatibility | `@modelcontextprotocol/sdk@1.30.0` | Existing MCP `2025-11-25` path and Apps peer dependency |
| MCP Apps | `@modelcontextprotocol/ext-apps@1.7.5` | Stable Apps `2026-01-26` identifier, resource, and bridge vocabulary |
| Conformance corpus | `@modelcontextprotocol/conformance@0.2.0-alpha.11` | Modern `2026-07-28` scenario inventory; CLI requires Node 22+ |

Normal application and SDK tests require Node 20 or newer. The selected conformance alpha calls `fs.globSync`, which is unavailable on the repository's Node `20.20.1`; listing its modern scenarios was separately proven under Node 22. This environmental distinction is evidence, not permission to change the product runtime requirement.

## Contract ownership

- Spec 02 owns durable Resume Builder data, data migrations, histories, Career placement, export records, and app data operations.
- Spec 03 owns inference purposes, prompt policy, provider/model compatibility, structured-output validation and repair, and fact-grounding policy.
- Spec 04 owns package trust, grants, install/update/rollback/disable/uninstall state, revocation, and lifecycle orchestration.
- Spec 05 owns MCP wire profiles, complete result/projection transport, Apps resource/view/bridge protection, capability and inference transport authority, the supervisor interface, diagnostics, and cross-runtime normalization.

`InstalledAppSupervisor` has no `execute` method. The Spec 05 app authority contains token identity and binding claims but no bearer value. The inference request contains no provider ID, model ID, endpoint, key, vault reference, or fallback. The resource descriptor contains no HTML bytes.

## Evidence procedure

From `builds/typescript`:

```bash
npm run test -- app-platform/contracts/spec-05-m1.test.ts
npm run test -- mcp
npm run test
npm run build
npm run lint
npm run web:typecheck
npm run docs:verify
npm run contracts:schemas
```

From `builds/mcp_release`:

```bash
npm run test
npm run build
```

From the repository root:

```bash
node tools/docs/sync-generated.mjs --check
git diff --check
```

The declared `builds/mcp_release` `test:integration` command is not part of this gate because its `test/integration/mcp-smoke.ts` entrypoint is absent. Do not treat that known broken target as executed evidence and do not create an unrelated replacement in M1.

## Deferred ground truth

M1 does not claim sandbox DOM behavior, blocked live browser actions, real app capability/data/export calls, provider inference, Docker container/process supervision, Windows packaging, native chooser behavior, or Docker/Windows parity. Those require their later accepted milestones and ground-truth environments. Native Windows is the only first packaged target; macOS and Linux remain configured but unclaimed.

The feature branch already includes later-milestone Resume Builder runtime code from prior commits. That baseline is outside this M1 diff. Review readiness therefore means this change activates no additional runtime path, not that the entire branch contains no runtime implementation.
