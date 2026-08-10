# Resume Builder brokered inference

This directory is the accepted Spec 03 broker for all six Resume Builder generation purposes. Spec 05 M5 exposes it through the thin [protected app capability adapter](../app-inference/README.md). Both remain deliberately separate from `engine/loop.ts`: requests cannot discover or call tools, cannot enter the chat retry loop, and cannot select a provider, model, credential, or capability.

`ImmutableInferenceSnapshotBuilder` resolves only exact, scoped M4 revision IDs and admits only confirmed facts. `ResumeInferenceBroker` validates the request and every data-block digest before resolving the owner's live provider. It then uses the dedicated adapter `completeStructuredNoTools` path with `tools: []`, a fixed policy, a strict purpose schema, the accepted token/time budgets, and the caller's abort signal.

Empty or schema-invalid output receives one structural repair on the same provider, model, policy, snapshot, and operation. Auth, quota, rate-limit, policy, cancellation, network, deterministic validation, and visible/ambiguous failures do not fall back or retry. Raw failed output is not retained. Standard audit callbacks receive only opaque operation/request IDs, purpose/schema/policy IDs, model class, attempt, bounded usage availability, status, timing class, and typed error code.

Cancellation is checked before and after provider resolution, before each bounded attempt, immediately after every provider response, and before validation/commit. A provider response that arrives after abort is projected as cancelled and cannot become a completed result. Broker idempotency hashes the immutable semantic request rather than host-generated request/timestamp fields, so a reconnect rebuild reuses the same completed operation while any snapshot, policy, schema, identity, or budget change conflicts.

The deterministic gate resolves every cited fact identity to the immutable confirmed snapshot, requires exact job source spans, validates targeted lineage, and conservatively rejects lexical/protected numeric, date, title, and URL drift. Any error finding blocks approval. M4 definitions record validator, policy, input, output, and findings digests atomically with the approved revision.

Resume-generation policy asks compatible models for a professional reverse-chronological document with standard section identifiers, one concise statement per output unit, and a clear separation between jobs, accomplishments, education, credentials, projects, volunteering, and links. Coaching preferences can guide the draft but cannot be copied into experience. The deterministic browser fixture mirrors that section mapping, excludes preference facts from resume claims, and uses confirmed contact information for the displayed name when available.

## Compatibility gate

`ModelCompatibilityRegistry` accepts only version-1 conformance records that already passed 100% schema success and the zero-unsupported-claim gate. The versioned `model-compatibility.json` intentionally starts with no real-model entries: project-owner approval is not model conformance evidence. Consequently, a real provider request fails closed as `model_incompatible` until a separately reviewed conformance run supplies entries to that registry. Tests use synthetic accepted entries to prove Ollama and BYOK profile independence and the complete execution path; no production provider profile or recommendation is added here.

The app-visible projection reports `owner_active_compatible` as a model class and omits provider profile/model identifiers, credentials, headers, raw permissions, URLs, and paths. The package-side MCP operations delegate to this host capability and never call a provider directly.

The isolated M6 browser journey may set `BRAINDRIVE_E2E_RESUME_INFERENCE_FIXTURE=1` through `client_web/scripts/run-isolated-e2e.mjs`. That resolver is deterministic, accepts only the structured no-tools Resume Builder call shape, and throws if asked to enter the general agent loop. The flag is absent from normal runtime and Docker configuration and never adds a production compatibility entry.
