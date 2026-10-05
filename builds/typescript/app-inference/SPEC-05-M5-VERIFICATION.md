# Spec 05 Milestone 5 verification

This record maps the credential-isolated Resume Builder inference capability to REQ-022, REQ-025–REQ-030, REQ-038–REQ-044 and M5-AC1 through M5-AC7. The accepted Spec 03 broker remains authority for purpose policy, immutable snapshots, provider compatibility, structured schemas/repair, and deterministic validation. Spec 05 owns only protected capability transport, authority/budget binding, replay, cancellation, safe events/projections, and settings recovery.

## Public contract and dispatch boundary

- App invocation: strict `inference_contract_version: 1`, one of six accepted purposes, opaque operation/request identity, exact revision IDs, bounded presentation/derived blocks, optional `quality|balanced|speed` intent, progress-only stream preference, and optional narrowing budget. Unknown provider/model/endpoint/key/tool/fallback fields are rejected.
- Protected request: the frozen M1 `AppInferenceRequestSchema`; exact `app_inference` authority, one `app.inference.request` capability, `tools: false`, `allow_provider_fallback: false`, strict output schema, immutable context digests, and the host-clamped Spec 03 budget.
- Events: a content-free progress event followed by exactly one typed completed or failed event. No partial model text is streamed. Completion includes structured output, digest, and token usage counts when the provider supplies them.
- Dispatch: bridge, internal app-server, and authenticated owner routes all consume exact current authority and call one `AppInferenceCapability`, which invokes the existing `ResumeInferenceBroker`. The chat loop and MCP tool discovery are not used.

## Captured provider body

`adapters/openai-compatible.test.ts` captures the exact body on the dedicated structured call:

```json
{
  "model": "test-model",
  "stream": false,
  "messages": [
    { "role": "system", "content": "Fixed policy" },
    { "role": "user", "content": "<data>owner input</data>" }
  ],
  "tools": [],
  "max_tokens": 128,
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "resume_test",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": { "questions": { "type": "array" } },
        "required": ["questions"],
        "additionalProperties": false
      }
    }
  }
}
```

The test verifies those are the only six top-level keys, `tool_choice`, provider selection, and fallback are absent, the owner key is absent from the body, and the credential exists only in the HTTP Authorization header inside the trusted adapter.

## Provider/model decision matrix

| Active profile | Model decision | Credential decision | Credits/fallback decision | Expected dispatch |
| --- | --- | --- | --- | --- |
| Ollama | exact active per-profile model plus exact conformance record | no key required; unrelated BrainDrive Models secret ignored | no credits dependency; no fallback | one local structured no-tools call |
| BYOK OpenRouter | exact active per-profile model plus exact conformance record | only the owner OpenRouter secret ref/env override | no BrainDrive Models credits; no fallback | one OpenRouter structured no-tools call |
| BrainDrive Models | exact active per-profile model plus exact conformance record | only the BrainDrive Models secret/entitlement | does not borrow BYOK or Ollama authority | one managed structured no-tools call |
| Missing active profile | none | none resolved | no fallback | `provider_unavailable`, zero provider calls |
| Active unqualified model | none | credential resolution occurs after compatibility, so none resolved | no fallback | `model_incompatible`, zero provider calls |

The checked-in real compatibility registry intentionally remains empty. Real dispatch therefore fails closed until separately reviewed Spec 03 conformance entries exist; synthetic entries exercise all three independent profile classes without making a production model claim.

## Replay, retry, cancellation, and result evidence

- Equivalent concurrent capability calls: one snapshot build, one broker call, one result.
- Reconnect with the same semantic operation/input but rebuilt host request ID/timestamps: one provider call total and the original completion is returned.
- Same operation with changed snapshot/policy/schema/identity/effective budget: `idempotency_conflict` or `invalid_request`, zero additional provider calls.
- Eligible empty/schema-invalid output: at most two provider calls total, both on the same resolved provider/model and immutable input; the second system message is the single structural-repair instruction.
- Auth, quota, rate, network, timeout, ambiguous/truncated finish, deterministic validation, and cancellation: one provider call maximum and zero fallback calls.
- Cancel during an adapter that honors abort: one cancel, terminal `cancelled`, no result.
- Cancel during an adapter that ignores abort: the late returned body is checked after await and discarded; terminal `cancelled`, no result.
- The existing lifecycle idempotency store writes only the safe terminal projection with an atomic rename. Failed/partial/raw provider output never reaches that store.

A representative safe completion projection is:

```json
{
  "inference_contract_version": 1,
  "status": "completed",
  "model_class": "owner_active_compatible",
  "attempt_count": 1,
  "usage": { "available": true, "input_tokens": 11, "output_tokens": 3 },
  "result": {
    "questions": [
      {
        "question_id": "question-1",
        "topic": "experience",
        "prompt": "What did you build?",
        "rationale": "Collect an owner fact"
      }
    ]
  },
  "validation": null,
  "events": [
    { "event": "progress", "sequence": 0, "delta": "provider_request_completed" },
    { "event": "completed", "sequence": 1, "usage": { "input_tokens": 11, "output_tokens": 3 } }
  ]
}
```

Request/operation IDs, schema IDs, and the output digest are omitted from this abbreviated sample but are present in the validated projection.

## Forbidden-field and settings-recovery evidence

Capability, bridge, provider, app-frame, and support-boundary tests scan app-visible JSON/proxy HTML for provider profile/model IDs, credentials, API keys, secret refs, Authorization/token values, endpoints/URLs, host policy messages/context envelopes, raw provider payloads, filesystem paths, and unrelated tools. Synthetic provider/model identifiers, credential fixtures, and provider URLs are absent from app projections. Broker audit tests separately prove confirmed owner content, keys, and URLs are absent.

Typed incompatible/unavailable/credential failures carry a safe `open_model_settings` recovery action. Resume Builder renders an **Open BrainDrive Settings** control, sends only the fixed `host.action { action: "navigate_settings", value: "models" }`, and the trusted React host opens the existing `SettingsModal`. Any other settings value or browser action remains denied. No Resume Builder model/provider selector was added.

## Verification commands

Run from `builds/typescript` unless noted:

```bash
npm run test -- app-inference app-capabilities adapters/openai-compatible.test.ts adapters/index.test.ts secrets/resolver.test.ts engine/loop.test.ts
npm run test
npm run build
npm run web:typecheck
npm run web:test
npm run docs:test
npm run docs:check
npm run docs:verify
```

Run from the repository root:

```bash
node tools/docs/sync-generated.mjs --check
tools/security/scan-secrets.sh --current
git diff --check
```

## Recorded result on 2026-08-09

| Command | Result |
| --- | --- |
| `npm run test -- app-inference app-capabilities adapters/openai-compatible.test.ts adapters/index.test.ts secrets/resolver.test.ts engine/loop.test.ts` | PASS — 15 files, 48 tests |
| `npm run test` | PASS — 87 files, 612 tests |
| `npm run build` | PASS |
| `npm run web:typecheck` | PASS |
| `npm run web:test` | PASS — 24 files, 224 tests; jsdom printed its known non-failing navigation notice |
| `npm run web:build` | PASS — Vite emitted existing font-resolution and chunk-size warnings |
| Resume Builder `npm run test` | PASS — 4 files, 11 tests |
| Resume Builder `npm run build` | PASS |
| `npm run docs:test` | PASS — 163 passed, 1 platform-specific skip |
| `npm run docs:check` | PASS — 250 scoped candidates, 0 diagnostics |
| `npm run docs:verify` | PASS — docs tests and validation |
| `node tools/docs/sync-generated.mjs --check` | PASS — projections match the catalog |
| `tools/security/scan-secrets.sh --current` | PASS — no findings |
| `git diff --check` | PASS |

## Environment boundary and residual risk

No live provider credential, external network, Docker app runtime, browser E2E, or packaged desktop runtime is required for this milestone's deterministic verification. Provider bodies are captured against a stubbed fetch; compatibility and provider-class tests use synthetic entries/credentials. Because the production compatibility registry has no reviewed real-model entries, normal real-model Resume Builder inference remains deliberately unavailable and routes owners to the existing model settings until conformance evidence is added. Dynamic supervisor/process work and packaged-platform parity remain outside M5.
