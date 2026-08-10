# Credential-isolated app inference capability

This directory is the Spec 05 Milestone 5 transport and projection boundary around the accepted Spec 03 Resume Builder broker. It does not resolve providers, read credentials, build prompts, validate generated claims, or implement repair. Those responsibilities remain in `resume-inference/`, the provider adapter, and the trusted gateway composition.

`AppInferenceCapability` accepts only inference contract version 1. The host first consumes a one-use `app_inference` token against the exact current owner/app/publisher/package/install/connection/view/operation/idempotency/grant/revocation/scope binding. The adapter repeats the binding check, clamps optional app budgets through the immutable snapshot builder, and validates the frozen protected request with `tools: false` and `allow_provider_fallback: false` before invoking Spec 03.

Bridge, app-server, and authenticated owner paths share this adapter. Canonical duplicate work coalesces in memory, and the lifecycle store atomically persists the safe terminal projection for reconnect/process replay. A reconnect may change host request IDs and timestamps without a second provider call; changing snapshot, policy, output schema, identity, or effective budget conflicts. Cancellation aborts both the coordinator and provider call, and the broker discards responses received after abort.

The app receives only contract/request/operation IDs, purpose/output-schema IDs, status, model class, attempt count, usage availability/counts, typed recovery-safe errors, deterministic validation, structured result, output digest, and progress/terminal events. It never receives a provider profile/model ID, credential, secret reference, authorization header, endpoint, fixed policy message, immutable context envelope, raw provider body, tool authority, or fallback control.

Model compatibility remains fail-closed. The active owner profile and model must have an accepted Spec 03 conformance entry before credentials are resolved. Ollama remains keyless, BYOK OpenRouter resolves only its owner credential, and BrainDrive Models resolves only its own credential/entitlement; none silently switches to or funds another profile. Incompatible or missing configuration returns an actionable safe error whose recovery action opens the existing BrainDrive Settings modal. Resume Builder contains no provider selector.

See [SPEC-05-M5-VERIFICATION.md](SPEC-05-M5-VERIFICATION.md) for the evidence matrix and reproducible checks.
