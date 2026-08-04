# Provider integration boundary

**Maturity: internal configuration; public extension and compatibility status unresolved under OPEN-02.**

BrainDrive uses the `openai-compatible` adapter with three declared profiles in `adapters/openai-compatible.json`:

| Profile | Endpoint/config source | Credential behavior |
|---|---|---|
| BrainDrive Models | Managed credits endpoint, optionally rebased by `BD_MANAGED_API_BASE` | Uses its own provider identity/entitlement and secret reference path. |
| BYOK OpenRouter | OpenRouter-compatible endpoint | Uses the owner's OpenRouter credential by environment reference or encrypted vault `secret_ref`. |
| Ollama | Local OpenAI-compatible endpoint | Does not require a provider secret by default; a running compatible local service/model is separate. |

These choices are independent. BrainDrive Models credits are not required for Ollama or BYOK OpenRouter. Selecting one profile must not remove or silently fund another. A completed BrainDrive Models claim may activate that profile only when the captured provider-intent revision still matches; a newer explicit OpenRouter/Ollama choice is preserved. BrainDrive-owned provider keys must never be placed in client configuration.

## Selection and secret resolution

Runtime config selects an adapter. Preferences select an active provider profile and store provider credential policy. Preferences may contain `mode: secret_ref`, `secret_ref`, and an optional environment-reference name; schema validation rejects secret-by-value preference fields. The resolver checks the declared environment reference, then decrypts the vault with the master key, optionally prompts once if configured, and otherwise fails closed for a required secret.

The gateway resolves the effective profile and credential immediately before the chat model adapter is created. Provider network errors are classified for the stream. Endpoint reachability, model availability, account entitlement, and provider-specific behavior are not established by config parsing.

## Verification boundary

Safe Tier A checks are the adapter/config/resolver/provider-activation tests and runtime build. They use unit, mock, or in-process evidence, not live provider compatibility evidence. Any live provider call is Tier C: it needs explicit owner authority, a selected independent profile, sanitized evidence, and bounded resource use. Do not use a BrainDrive Models credential to claim OpenRouter or Ollama evidence, or vice versa.

Source/tests: `builds/typescript/adapters/openai-compatible.json`, `adapters/index.ts`, `adapters/openai-compatible.ts`, `config.ts`, `secrets/resolver.ts`, `gateway/provider-activation.ts`, their tests, and gateway settings/message routes.
