# Installed app architecture and ownership boundary

**Maturity: internal beta for reviewed, same-release apps.** This is the current architecture used by Resume Builder and Brief Builder. It is not yet a public plugin SDK, an arbitrary-package execution promise, or a cross-version compatibility guarantee.

## The governing rule

An app owns everything that makes that app useful. BrainDrive owns only the reusable authority, isolation, transport, and provider mediation needed to run installed apps safely.

| Concern | App-owned | BrainDrive host-owned |
|---|---|---|
| Product behavior | Workflow, UI resource, domain language, prompts, output schemas, semantic validation, issue IDs, retry instructions, deterministic fallback | No app-specific product policy |
| Package identity | Declared app/publisher identity, version, immutable files, runtime artifacts, primary `ui://` resource, provenance, SBOM, requested capabilities and inference purposes | Signature/trust verification, exact reviewed registration join, install/update/disable/uninstall state |
| Runtime | Signed app process and its public/private MCP tools | Starting only installed active app runtimes, health/readiness, restart limits, connection identity, teardown and revocation |
| UI | Opaque-origin app view and owner-facing workflow | Verified resource loading, double sandbox, CSP, bridge limits, focus/close state, browser actions and confirmations |
| Data | App-defined inputs and domain transitions through reviewed capabilities | Owner/app-scoped authority, exact data adapter, CAS/idempotency, durable store boundary, audit projection and retention enforcement |
| Inference | Program identity, prompt, strict JSON Schema, candidate adjudication, content-free issue IDs, one correction instruction, eligible fallback | Owner-active provider resolution, credential isolation, structured no-tools execution, cancellation, two-call ceiling and generic terminal envelope |

Resume Builder is a reference implementation of this model, not a BrainDrive product module. A future app must carry its own policy and behavior in its signed package rather than adding that app's semantics to the BrainDrive runtime.

## Installation and launch flow

1. A generic manifest revision 2 declares immutable package files, supported platform artifacts, its primary `ui://` resource, requested capabilities and inference purposes, provenance, SBOM, and the retention policy.
2. BrainDrive verifies the descriptor, archive digest, signature, trust root, revocation state, compatibility, and selected platform artifact.
3. `FirstPartyAppRegistry` joins the verified package to an exact reviewed app/publisher/route registration. A manifest cannot select a host handler, import a module, or grant itself authority.
4. Installation persists lifecycle and grant state. The supervisor starts a packaged runtime only for an installed active app and binds it to the exact installation, package digest, runtime identity, and lifecycle generation.
5. The modern MCP client negotiates the pinned protocol and Apps extension, discovers tools/resources, and reads only the verified primary resource from the same server.
6. The trusted web layer renders that resource through a fixed cross-origin proxy and an inner opaque-origin sandbox. The app view receives safe presentation context, never bearer credentials, host paths, owner permission objects, provider secrets, or direct gateway/Tauri authority.
7. Every capability call re-resolves the selected app and checks its current install, package, connection, view, operation, grant, revocation, scope, deadline, and idempotency binding before invoking one reviewed adapter.

Disable, update, uninstall, lifecycle-generation change, failed health, session close, and gateway shutdown revoke or replace the corresponding runtime, connection, bridge, and token authority.

## App-owned inference flow

Installed inference uses contract version 2:

1. The sandbox requests `app.inference.request` through its app-bound bridge; it cannot call the provider or private program tools directly.
2. BrainDrive consumes a one-use `app_inference` token and invokes private prepare/adjudicate tools on the same verified app connection.
3. The app prepares the exact system/user messages and strict JSON Schema for attempt one.
4. BrainDrive resolves the owner's active provider and performs one structured completion with no tools. Credentials remain only in the adapter authorization boundary.
5. The app adjudicates the parsed candidate. It either accepts, returns namespaced content-free issue IDs for one correction call, fails safely, or uses an eligible deterministic app fallback after the second invalid result.
6. BrainDrive returns the generic terminal envelope: app program and operation identities, attempt count, completion mode, opaque provider/model identities, issue IDs, structured app result, and app-supplied persistence binding where required.
7. The app separately requests its reviewed data capability to persist an unapproved result. Normal domain, evidence, CAS, review, and owner-approval gates still apply.

Failure transport follows the same ownership boundary. BrainDrive validates and forwards only a strict app-neutral safe envelope containing a stable code, fixed safe message, retryability, correlation or operation reference, attempt count, completion mode, namespaced content-free app issue IDs, owner state, and bounded scalar app recovery metadata. It never replaces the stable code with an exception message, and it drops content-bearing or malformed fields. Each installed app owns the mapping from its issue IDs to owner guidance. Future apps can reuse this transport without adding their schemas, validators, prompts, fallback constructors, or policy branches to BrainDrive.

Provider output is not durable merely because inference completed. Persistence is a distinct host-authorized transition. Equal retries may coalesce or replay through the operation coordinator; changed canonical input under the same semantic identity conflicts. Cancellation propagates to provider work, and late responses cannot commit.

Resume Builder demonstrates two useful patterns:

- Strategy inference exposes only bounded high-level choices to the model; the app derives all job/fact identities, topology, evidence priority, and persisted bindings.
- General Resume inference gives the model exact text slots; the app owns statement IDs, support identities, section/role topology, the six-bullet maximum, fact-grounding checks, issue IDs, and deterministic fallback.

These patterns keep app semantics out of BrainDrive while still allowing the host to enforce generic safety and resource limits.

The same boundary applies to test support. An app-specific synthetic provider or response shaper lives with that app's tests and is injected into the isolated test gateway through the generic installed-app provider-resolver dependency. Production gateway source must not import an app fixture or select one through an app-named environment branch.

## Scaling across many available apps

The catalog and reviewed registry hold bounded metadata; they do not execute every available app. An app runtime is started only after that app is installed and active, and provider work occurs only when an authorized invocation requests it. Live views, connections, tokens, operation state, and data scopes are keyed by app and installation.

Therefore, having 100 available apps while an owner installs four does not load 100 app workflows, prompts, validators, or provider sessions into the core runtime. The installed four pay their own runtime and active-view costs. BrainDrive retains only generic registry/lifecycle infrastructure plus the metadata required to discover and verify available packages.

Current reviewed registrations are compiled same-release integration points. A future public marketplace needs a separately accepted extension and compatibility policy; do not treat the present internal registry as an unrestricted dynamic plugin ABI.

## Checklist for another app

1. Create a separately buildable app package with a generic revision-2 manifest, immutable primary resource, packaged runtime artifacts, provenance, and SBOM.
2. Define a unique canonical app/publisher/route identity and request only the minimum capabilities and inference purposes.
3. Add an exact reviewed registration for each capability, inference purpose, data adapter, runtime profile, and lifecycle binding. The manifest alone cannot create these bindings.
4. Implement public app-visible tools/resources and keep inference prepare/adjudicate tools private from the iframe.
5. Keep workflow, prompts, schemas, semantic validation, issue IDs, retry instructions, and fallbacks inside the app package.
6. Use host capabilities for owner data, exports, browser actions, confirmations, and inference. Do not add filesystem, credential, provider-selection, or unrestricted network authority to the app.
7. Make durable writes idempotent and revision-bound. Treat transport loss as ambiguous until the host's operation/reconciliation read resolves it.
8. Test package verification, lifecycle/revocation, cross-app isolation, sandbox denial, capability scope, inference cancellation/replay, content-free audit projection, and app-specific domain behavior.

## Source and verification routes

- Generic contracts and registration: [`app-platform/contracts`](../../../builds/typescript/app-platform/contracts/README.md) and [`app-platform/registry.ts`](../../../builds/typescript/app-platform/registry.ts)
- Install/runtime lifecycle: [`app-platform/lifecycle`](../../../builds/typescript/app-platform/lifecycle/README.md)
- MCP Apps host and sandbox: [`app-platform/mcp-host`](../../../builds/typescript/app-platform/mcp-host/README.md)
- Generic inference executor: [`app-inference`](../../../builds/typescript/app-inference/README.md)
- Capability routing: [`app-capabilities`](../../../builds/typescript/app-capabilities/README.md)
- Reference apps: [Resume Builder](../../../builds/resume_builder/README.md) and [Brief Builder](../../../builds/brief_builder/README.md)

Focused checks from `builds/typescript`:

```bash
npx vitest run app-inference/installed-program.test.ts app-inference/capability.test.ts app-platform/mcp-host/live-fixture.integration.test.ts app-platform/mcp-host/data-capability-bridge.test.ts
npm run web:test -- --run src/components/apps/SandboxedAppFrame.test.tsx
npm run web:typecheck
```

App-package checks run inside the app package, for example:

```bash
cd builds/resume_builder
npm test
npm run build
```

After documentation changes, follow the repository [verification guide](../verification.md).
