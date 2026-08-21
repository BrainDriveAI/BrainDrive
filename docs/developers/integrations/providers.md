# Provider integration boundary

**Maturity: beta-supported built-in integrations under the resolved OPEN-02 decision.** Support covers BrainDrive's declared configuration and credential boundaries for the three named profiles in a tagged release. It does not cover every model, endpoint, provider feature, future third-party behavior, or a generic OpenAI-compatible extension contract.

BrainDrive uses the `openai-compatible` adapter with three declared profiles in `adapters/openai-compatible.json`:

| Profile | Endpoint/config source | Credential behavior |
|---|---|---|
| BrainDrive Models | Managed credits endpoint, optionally rebased by `BD_MANAGED_API_BASE` | Uses its own provider identity/entitlement and secret reference path. |
| BYOK OpenRouter | OpenRouter-compatible endpoint | May be selected before configuration; model requests require the owner's OpenRouter credential by environment reference or encrypted vault `secret_ref`. |
| Ollama | Local OpenAI-compatible endpoint | Does not require a provider secret by default; a running compatible local service/model is separate. |

These choices are independent. BrainDrive Models credits are not required for Ollama or BYOK OpenRouter. Selecting one profile must not remove or silently fund another. A completed BrainDrive Models claim may activate that profile only when the captured provider-intent revision still matches; a newer explicit OpenRouter/Ollama choice is preserved. BrainDrive-owned provider keys must never be placed in client configuration.

External provider reachability, model availability, account entitlement, pricing, and provider-specific behavior are outside BrainDrive's compatibility guarantee. Compatibility claims are limited to the configuration and tests evidenced for the tagged BrainDrive release.

## Selection and secret resolution

Runtime config selects an adapter. Preferences select an active provider profile and store provider credential policy. Preferences may contain `mode: secret_ref`, `secret_ref`, and an optional environment-reference name; schema validation rejects secret-by-value preference fields. The resolver checks the declared environment reference, then decrypts the vault with the master key, optionally prompts once if configured, and otherwise fails closed for a required secret.

OpenRouter selection and OpenRouter runtime readiness are intentionally separate. An owner may make OpenRouter the active profile before adding a key; the missing credential remains visible as unresolved onboarding/configuration and OpenRouter model requests still require an owner-supplied key. Selecting OpenRouter does not create, borrow, or transfer BrainDrive Models credit or credentials.

BrainDrive Models credits status and checkout use the dedicated `braindrive-models` provider credential and encrypted vault value, not the active chat provider. If Ollama or BYOK OpenRouter is active, `/credits/status` still authenticates to the hosted credits service with the BrainDrive Models secret reference. A missing known BrainDrive Models secret enters repair, while a transient hosted status failure is reported as unavailable without borrowing another provider credential.

Release evidence for BrainDrive Models credit changes must show the provider boundary in both directions: Ollama and BYOK OpenRouter remain selectable without BrainDrive Models credits, and BrainDrive Models status/top-up never sends an Ollama placeholder or OpenRouter BYOK key to the hosted credits service. Use automated gateway tests for Tier A evidence and controlled staging only with explicit owner/provider authority.

The gateway resolves the effective profile and credential immediately before the chat model adapter is created. Provider network errors are classified for the stream. Endpoint reachability, model availability, account entitlement, and provider-specific behavior are not established by config parsing.

## Structured no-tools completion

The OpenAI-compatible adapter also exposes an optional structured completion path for app inference. It sends only system and user messages, an empty `tools` array, a strict JSON Schema response format, the selected model, and the bounded output-token limit. The active profile's resolved credential is sent only in the authorization header; it is not copied into the request body. A caller-supplied abort signal and timeout bound the request.

When a structured response safely includes a provider-returned model identity, the adapter projects that optional identity separately from generated text. Resume compatibility v2 uses it for drift detection; providers that omit it remain supported through the exact configured identity, secret-free effective-configuration fingerprint, and 90-day expiry. The compatibility preflight still runs before credential resolution, adapter construction, or owner-data transmission. Checked-in v1 Resume records are classified `legacy_provisional` and do not constitute Spec 09 release evidence.

Resume inference fails closed when the active adapter lacks this capability. Supporting the request shape is not, by itself, a compatibility claim: each provider/model combination still needs the separately authorized conformance evidence required by the app-inference registry. The path does not enable provider fallback, share credentials across profiles, or turn deterministic fixtures into live-provider evidence.

## Verification boundary

Safe Tier A checks are the adapter/config/resolver/provider-activation tests and runtime build. They use unit, mock, or in-process evidence, not live provider compatibility evidence. Any live provider call is Tier C: it needs explicit owner authority, a selected independent profile, sanitized evidence, and bounded resource use. Do not use a BrainDrive Models credential to claim OpenRouter or Ollama evidence, or vice versa.

Source/tests: `builds/typescript/adapters/openai-compatible.json`, `adapters/index.ts`, `adapters/openai-compatible.ts`, `config.ts`, `secrets/resolver.ts`, `gateway/provider-activation.ts`, their tests, and gateway settings/message routes.
