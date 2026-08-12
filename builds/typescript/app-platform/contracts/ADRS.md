# Resume Builder Milestone 1 decision record

Status: Accepted

Decision owner: DJJones, Project Owner

Accepted: 2026-08-07

## ADR-RB-001 — Contract placement and non-runtime boundary

The accepted plans proposed new `app-platform`, `resume-domain`, `builds/resume_builder`, and architecture-decision locations. The active `dev` baseline contains none of those abstractions. Contracts therefore live at `builds/typescript/app-platform/contracts`, domain schemas remain in that contract package for Milestone 1, and the inert separately buildable package lives at `builds/resume_builder`.

This source-adjacent ADR is the narrowest repository-consistent equivalent. Creating a new canonical page under `docs/developers/architecture` would require a broader catalog-owned architecture commitment before runtime design exists. Future milestones may promote accepted architecture into the developer catalog; they must not duplicate these contract authorities.

No current runtime, gateway, MCP, web, Docker, Tauri, auth, provider, secrets, or memory module imports this directory.

## ADR-RB-002 — Version and compatibility policy

- BrainDrive app contract schema: `1`.
- Resume owner-data schema: `1`.
- Resume inference schema: `1`.
- App bridge schema: `1`.
- Modern normative MCP target: `2026-07-28`.
- Bounded legacy MCP adapter: `2025-11-25` only.
- Stable MCP Apps extension: `io.modelcontextprotocol/ui` at `2026-01-26`.
- Current exact repository SDK evidence: `@modelcontextprotocol/sdk` `1.30.0`; stable extension package evidence: `@modelcontextprotocol/ext-apps` `1.7.5`. These are compatibility evidence, not permission to add or upgrade runtime dependencies in Milestone 1.

Authority-bearing envelopes reject unknown fields. Durable records preserve compatible unknown extension data only under their non-authoritative `extensions` object. A reader may read its own schema version and explicitly listed compatible older versions. Unknown major/newer versions and every attempted downgrade fail closed.

## ADR-RB-003 — Trust, package, platform, and retention decisions

Resume Builder is a first-party, signed package in the dedicated `braindrive-app-release` trust domain. Product-image release manifests and keys are not app-package authority.

The accepted archive is `.bdapp`, media type `application/vnd.braindrive.app+zip`, using the `braindrive-zip-v1` profile. It is an uncompressed ZIP with UTF-8 POSIX-relative names, entries ordered by unsigned Unicode code-unit path, DOS epoch timestamps, no archive/file comments, extra fields, data descriptors, encryption, explicit directory entries, links, device nodes, or undeclared entries. External mode is `0444` for `read_only` and `0555` for `executable`. The first entry is canonical `manifest.json`; remaining entries are exactly the manifest inventory. Case-folded duplicate paths, absolute paths, `.`/`..`, backslashes, and traversal fail. The manifest excludes itself from its file inventory so no digest is circular.

`manifest.json` is `braindrive-canonical-json-v1` UTF-8 followed by one LF. That canonicalization accepts JSON values only, sorts object keys by unsigned Unicode code-unit order, preserves array order, uses JSON primitive encoding, emits no insignificant whitespace, and rejects non-finite numbers and `undefined`. The descriptor's `manifest_digest` covers those exact manifest bytes. The archive digest covers every exact `.bdapp` byte. The detached package signature covers these exact bytes:

```text
BrainDrive-App-Package-v1\n
<canonical descriptor payload JSON>\n
```

Detached source-index and revocation signatures use the same construction with `BrainDrive-App-Source-Index-v1` and `BrainDrive-App-Revocations-v1`. Descriptor digests in the source index cover canonical JSON of the complete descriptor, including its detached signature. All digests are SHA-256 and all signatures are Ed25519 encoded as canonical padded Base64.

The host pins one offline BrainDrive app root public key. Root private material never ships in source, fixtures, Docker images, desktop bundles, or logs. The root authorizes bounded release public keys by signing the canonical release-key payload with `BrainDrive-App-Release-Key-v1`; package, source-index, and revocation signatures must use an active authorized release key inside its validity window. Rotation adds a newly root-authorized release key before retiring the old key. A revoked release key cannot verify new or cached package authority.

Docker development resolves exact immutable descriptors through the repository-controlled signed source-index fixture. Desktop resolves the same contract through signed BrainDrive release assets. Both indexes are independently monotonic and chained by prior payload digest. A lower sequence or different content at the same sequence is rejected and never replaces the cached last-valid index.

The BrainDrive release authority owns a signed, independently versioned monotonic revocation list. Refresh is attempted hourly and diagnostics mark it stale after 24 hours. Only a valid higher sequence, or identical content at the current sequence, may update the atomic cache. Every cached explicit revocation remains binding indefinitely. A stale list permits only rechecking and launching an already verified local package without an explicit match; it cannot authorize a new install or update. An explicit digest or version-range match fails closed and requires stop, token revocation, and quarantine.

Docker `dev` is the first live promotion environment. Native Windows is the first packaged desktop release target because it is the only desktop platform currently claimed by the repository. macOS and Linux remain configured but unclaimed until ground-truth release evidence exists.

Default uninstall retains durable owner facts, provenance needed by retained records, resume and variant history, referenced job snapshots, accepted artifact metadata, export receipts, and completed-operation lookup according to policy. It removes package/runtime files, grants, tokens, disposable preview cache, and abandoned transient operations. Owner-exported files remain outside app deletion. Retain the active package, one last-known-good package, and one pre-migration recovery snapshot until the candidate is ready, registered, and completes one authenticated request under the new runtime generation. That operation ID is the successful-use checkpoint evidence; only then may bounded LKG/snapshot cleanup occur.

## ADR-RB-004 — Capability, inference, and supervision limits

App authority uses named capabilities, opaque IDs, and short-lived tokens bound to owner actor, app, package, installation, audience, view/operation where applicable, and an explicit grant set. Requested grants must be a subset of installed grants; data never supplies authority.

The inference surface supports exactly nine purposes: `interview_assist`, `general_resume_draft`, `job_description_analyze`, `requirement_evidence_match`, `tailoring_plan`, `targeted_resume_draft`, `resume_revision_classify`, `resume_revision_draft`, and `resume_guidance`. Each purpose binds a host-selected prompt policy, output schema, strict budget, immutable input snapshot, and no-tools capability requirement. Model compatibility is conformance-derived, never inferred from a marketing name; the three Spec 06 additions remain incompatible until later conformance evidence is accepted. The accepted M1 conformance ceilings are versioned in `inference.ts`; an app may only request lower values. Later live fixture evidence may justify a versioned policy revision, never an unversioned widening.

### Milestone 5 implementation record

The executable broker uses a dedicated structured adapter call and never the general agent loop. The app cannot select provider/model, receive credentials, or see provider/model identifiers; it sees only the `owner_active_compatible` class. At most two provider calls are allowed: the second can repair either schema shape or safe deterministic-validator findings on the same immutable snapshot. When schema repair consumes that call, resume drafts may use a no-provider deterministic fallback that replaces only rejected or missing lines with wording derived directly from cited confirmed facts; unchanged valid statements are preserved and the complete result must pass the same claim gate. The real-model compatibility registry is initially empty and therefore fail-closed: owner acceptance of the architecture does not substitute for a measured model conformance record. Synthetic entries are test evidence only. Purpose-specific schemas are emitted with the version-1 JSON schema catalog, and approved definitions atomically bind validator, policy, immutable-input, output, and findings digests.

The version-1 `InstalledAppSupervisor` contract is runtime-neutral and owns `start`, `awaitReady`, `health`, `register`, `stop`, token revocation, and inspect/reconcile operations. Every request binds opaque operation/installation/runtime/registration identities, package digest, grant, and monotonically increasing runtime/token generations. Runtime descriptors contain verified relative entrypoints, opaque package/cache root references, allowlisted argument and environment-key names, resource-policy version, and authenticated endpoint policy; they contain no raw host path, shell command, inherited environment, package-selected credential, or public bind.

Docker uses authenticated container-internal HTTP. Packaged Node uses authenticated `127.0.0.1` HTTP. Readiness returns an exact endpoint descriptor and registration occurs only afterward. Stop distinguishes graceful, forced, already stopped, and ambiguous outcomes; an ambiguous result cannot acknowledge termination. Reconciliation permits at most one runtime and one registration and resolves committed pointer authority before another start. Supervisor state is `starting -> ready -> unhealthy -> backoff -> restarting`, ending in `failed_recoverable` after its restart budget, while stop/revoke ends in `stopped`.

The supervisor allows one process/container per active installation, one CPU core, 512 MiB memory, 1 MiB output per request, a 120-second request timeout, a 30-second startup timeout, and at most three crash restarts at 1/2/4-second backoff before owner retry. These are accepted contract ceilings; later live Docker/Windows evidence may justify only a versioned policy revision. Desktop packaging uses verified compiled JavaScript with BrainDrive's packaged Node runtime unless later packaging evidence blocks it.

Lifecycle state and lifecycle-operation journals are independently versioned. Every mutation records its idempotency identity, prior/target/next state, current and completed stages, commit outcome, recovery action and safe state, terminal result, timestamps, and content-free error code. Missing state means `not_installed`; unknown/newer state versions fail closed. `active` requires package and grant authority. `not_installed`, `disabled`, and `quarantined` results require runtime authority removal. The generic data-operation record remains separate and is not overloaded for lifecycle recovery.

## ADR-RB-005 — UI, Career, export, and audit boundaries

The future Apps entry belongs under a top-level sidebar `Apps` item, not inside project files. The renderer bridge belongs in a dedicated web-client module with no direct Tauri authority. Privileged navigation, clipboard, export/download, data, and inference actions remain host-brokered.

Career returns only a concise M-11 result/status summary. Detailed facts, job text, resume definitions, variants, and generation traces remain Resume Builder-owned durable data. Export uses a host-mediated chooser/download contract; the app receives a safe destination label/receipt, never a raw path.

Ordinary audit is content-free. It may contain identities, opaque references, versions, hashes, timings, counts, lifecycle/operation outcomes, capability name, and error category. It may not contain resume, career, job, prompt, completion, HTML, source body, credentials, internal permission objects, raw paths, or unsafe destinations.

Spec 06 Milestone 2 adds named recovery save/restore/discard/conflict events without changing that allowlist, and separates a capability call's optional durable `request_operation_id` from its unique bridge `message_id`. The former may be retried with identical canonical input; the latter may never replay in a live bridge session.

## ADR-RB-006 — Repository evidence deviations

The accepted prompt pack described TypeScript/web lint as a placeholder. On the active `dev` baseline both `npm run lint` and `npm run web:lint` are substantive ESLint gates. Milestone verification therefore runs them and reports their actual results. No invented format command is added.

Current MCP request context defaults missing or malformed permission headers to full local-owner permissions, and the current MCP client flattens rich results. Those are documented incompatibilities for later milestones; Milestone 1 does not change existing fixed-MCP behavior.

## ADR-RB-007 — Corrective M1 gate closure

The initial M1 draft named digests, signatures, revocation status, lifecycle state, and supervisor ceilings without defining their byte boundaries, trust hierarchy, monotonic feeds, lifecycle recovery journal, or supervisor wire outcomes. DJJones directed the implementation engineer to complete that gate on 2026-08-07. ADR-RB-003/004 and the corresponding version-1 Zod/JSON contracts now carry those previously delegated decisions. This correction remains M1 contract-only work and enables no runtime behavior.

## ADR-RB-008 — Spec 02 data-conformance closure

The project-owner-approved Spec 02 Milestone 1 prompt was re-audited against the active `feature/resume-builder-app` branch. That branch already contains the later accepted integrated implementation, so the repository-consistent action is to close missing conformance authorities in `app-platform/contracts`, not to create the plan's older proposed `resume-data` directory or a second store. This change adds no new route, initialization, persistence, Career/profile write, inference, renderer, export, Docker, or desktop behavior.

The accepted physical namespace remains `apps/resume-builder` below the configured memory root. The exact data capability names are `career.context.read`, `career.facts.read`, `career.facts.propose`, `career.facts.confirm`, `resume.definitions.read`, `resume.definitions.write`, `resume.jobs.read`, `resume.jobs.write`, `resume.artifacts.register`, `resume.export.request`, and `resume.operations.read`. Their version-1 context is bound to owner, actor, first-party app/publisher, package digest, installation, grant, audience, named capability, record scopes, and a bounded lifetime. Capability input is strict and canonical-digest-bound; content cannot add authority. Fact confirmation additionally requires matching host-mediated owner proof.

Spec 02 uses its own REQ-001–REQ-040 manifest because the accepted cross-spec test plan uses a different REQ-001–REQ-034 namespace. Both remain authoritative within their named scope. The data conformance suite freezes immutable successor transitions, CAS conflicts, actual cancellation outcomes, maximum-support sensitivity inheritance, non-enumerating owner denial, content-free events, deterministic no-AI migration provenance, read-current/write-current first-release compatibility, the future immediately-prior read obligation, and the accepted retention matrix. Native Windows remains the sole claimed packaged desktop target; macOS and Linux remain unclaimed.

## ADR-RB-009 — Spec 04 M1 trust/lifecycle conformance closure

DJJones accepted Spec 04, its verification plan, and OQ-4-1 through OQ-4-6 as the accountable project owner and initial security/release/desktop authority. ADR-RB-003 remains the byte-level decision authority: `.bdapp` stored ZIP, canonical JSON plus LF, SHA-256/Ed25519 with a pinned app root and bounded release-key rotation, signed Docker/release indexes, active plus one LKG and one snapshot through the authenticated successful-use checkpoint, monotonic cached revocations, no retained-data deletion operation, and native Windows as the sole first packaged target.

The exact Spec 05 boundary is the version-1 `InstalledAppSupervisor` interface in `supervisor.ts`; it owns start, readiness, health, registration, stop, token revocation, orphan cleanup, and reconciliation without exposing a shell, raw path, credential, or public endpoint. The exact Spec 02 boundary is the version-1 `ResumeLifecycleDataAdapter` in `lifecycle-foundation.ts`; it owns schema inspection, retained-data discovery, snapshot, deterministic migration, and restore through opaque identities and contains no deletion method.

Spec 04 retains its own REQ-001–REQ-040 namespace. `fixtures/spec-04/requirements.json` maps each requirement to an automated/live/human/release method, G0–G6, and an accountable role. `fixtures/spec-04/m1-evidence.json` freezes gate ownership plus transition/failure evidence. `fixtures/spec-04/package-corpus.json` supplies the public-key-only positive/adversarial corpus. `SPEC-04-M1-VERIFICATION.md` is the accepted source-adjacent verification authority.

This closure changes contract and verification artifacts only. It adds no gateway import, route, fetch, package store, lifecycle persistence, process/container binding, API, UI, marketplace, or retained-data deletion. The current feature branch already contains later-milestone runtime code from prior commits; that baseline is not M1 work and means repository-wide execution is not disabled even though this diff enables no execution path.

## ADR-RB-018 — Corrective M1 data and Career contract addendum

DJJones approved this addendum on 2026-08-07 after the M4 prerequisite audit found that the original version-1 data schemas did not fully encode accepted Spec 2 or the accepted Career return decision. Because no Resume Builder owner-data runtime had yet been enabled, version 1 is corrected in place before first data activation.

The physical namespace is the repository-consistent mapping already established by M2: `apps/resume-builder` below the configured memory root, with immutable JSON revisions and one atomically replaced catalog pointer. `career.context.read` returns a bounded, path-free projection of only owner profile, Career spec, and Career plan. Career-originated returns use one insert-only entry through the existing Career journal procedure and contain only outcome/status, an optional approved reference, material stable-fact proposals, and the next Career action. Profile, Career spec, and Career plan changes remain proposals for the existing owner-controlled workflow. No Career starter file is changed by this decision.

Version-1 records now carry explicit update/lifecycle metadata. Resume definitions carry section order, selected facts, locale, page intent, template/policy compatibility, and approval time; job snapshots carry source/capture metadata; interview progress is durable declared draft state. These are corrections to the accepted contract, not M5 generation or M6 UI/export behavior.

## ADR-RB-019 — Milestone 6 owner workflow and renderer mapping

DJJones approved Milestone 6 and the accepted Specs 1–5 remain its change authority. The repository-consistent implementation keeps the owner workflow resource in the separately buildable `builds/resume_builder` package, the opaque-origin host and owner confirmations in the existing web Apps surface, durable state in `resume-domain`, inference in `resume-inference`, and deterministic preview/export in `builds/typescript/resume-renderer`. This avoids a second app shell, a second data abstraction, and any direct sandbox filesystem or provider authority.

Career entry is selected through the existing Career project plus the single top-level Apps entry. Direct entry uses the same installed package and durable records. Career return remains the accepted narrow journal summary. Fact confirmation and definition approval render in the host-owned React surface; the sandbox can only propose the typed operation. Browser PDF save is host-mediated and returns only a safe filename/parse-back projection to the app.

Before the first renderer activation, data schema version 1 is corrected in place so every resume statement carries a logical `section_id` and every statement section must appear in `section_order`. No owner Resume Builder data had shipped under the earlier incomplete shape. The pinned renderer is `resume.single-column@1` plus `braindrive.ats-pdf@1`, uses the PDF 1.4 Helvetica core-font manifest, limits output to two pages, and requires exact logical-order parse-back before preview or export. Approved definitions remain the source of truth; artifacts and export receipts store lineage and safe metadata only.

The isolated browser test uses `BRAINDRIVE_E2E_RESUME_INFERENCE_FIXTURE=1` together with the isolated runner's disposable memory root. That explicit fixture can satisfy only the structured no-tools Resume Builder path and throws if invoked through the agent loop. Normal runtime construction continues to use the empty, fail-closed real-model compatibility registry; owner approval is not model conformance evidence.

## ADR-RB-020 — Milestone 7 desktop lifecycle and native export mapping

DJJones approved Milestone 7 on 2026-08-07. Native Windows remains the sole selected packaged desktop MVP target; configured macOS and Linux bundles remain unclaimed. Docker development uses the `docker_linux_x64` package artifact with container-internal transport. Packaged Windows uses the same signed package and lifecycle policy, selects `desktop_windows_x64`, runs the verified compiled JavaScript entrypoint with BrainDrive's packaged Node runtime, and binds authenticated random `127.0.0.1` transport. Unknown targets and target/artifact mismatches fail closed.

The repository-consistent desktop boundary keeps package verification, lifecycle journals, reconciliation, restart limits, retention, and capability tokens in `app-platform/lifecycle`. Tauri stages the declared Resume Builder resource, selects the Windows target and platform data root, and places the fixed MCP/gateway children and their inherited app descendants in a Windows Job Object configured for a one-logical-CPU-equivalent group ceiling, a 512 MiB per-process ceiling, and process-tree termination when its owner closes. Graceful lifecycle stop remains authoritative; the Job Object is the resource/orphan-containment fail-safe. This avoids a second desktop lifecycle implementation.

Native export is a two-phase host operation. The renderer first prepares and validates immutable PDF bytes and artifact lineage without claiming an export receipt. Tauri then opens the operating-system save chooser, validates the bounded PDF again, writes a temporary sibling, synchronizes it, and atomically commits only the selected file. The host finalizes exactly one `completed`, `cancelled`, or `failed` receipt after the chooser result. The sandbox receives only the safe file label and outcome, never bytes or a raw path.

Source/process parity tests exercise install, authentication, disable/enable, update, rollback, owner-data retention, uninstall/reinstall, and shutdown for both accepted runtime targets. Those tests and Linux Rust tests are implementation evidence, not native Windows release evidence. M7 acceptance still requires an actual Windows package build, signature verification, install, live chooser, crash/orphan/restart, update/rollback, migration, uninstall/reinstall, retained-data reopen, and shutdown run. A non-Windows workspace must report that gate as blocked rather than translate cross-platform source tests into a Windows claim.

## ADR-RB-021 — Spec 05 M1 protocol and security foundation

**Status:** Accepted by DJJones, Project Owner, on 2026-08-07. This record resolves OQ-1 through OQ-7 and the two repository discrepancies delegated to Spec 05 Milestone 1. It supersedes only the dependency-evidence sentence in ADR-RB-002 and ADR-RB-014; it does not activate or rewrite the later-milestone host already present on this feature branch.

The normative modern profile is MCP `2026-07-28`. It is stateless: `server/discover` performs optional/version-pinned negotiation, each request carries protocol/client/capability metadata, and neither `initialize`/`initialized` nor `Mcp-Session-Id` is modern wire state. A host `connection_id` is therefore an opaque local authorization, cache, correlation, and view identity rather than a wire session. The only compatibility profile is bounded MCP `2025-11-25` for existing tool-only services; it retains its initialization/session semantics and cannot launch an MCP App.

The exact evidence pins are `@modelcontextprotocol/client`, `@modelcontextprotocol/core`, `@modelcontextprotocol/server`, and `@modelcontextprotocol/node` `2.0.0`; legacy `@modelcontextprotocol/sdk` `1.30.0`; `@modelcontextprotocol/ext-apps` `1.7.5`; and `@modelcontextprotocol/conformance` `0.2.0-alpha.11`. The normal SDK runtime floor is Node 20. The selected conformance alpha uses `fs.globSync`, so its CLI must be executed with Node 22 or newer. The existing `builds/mcp_release` package remains pinned to the legacy SDK; its declared `test:integration` target is missing, and M1 does not invent it.

MCP Apps is `io.modelcontextprotocol/ui` at `2026-01-26`, with `ui://` resources, exact `text/html;profile=mcp-app` media type, `_meta.ui.resourceUri`, `model`/`app` visibility defaulting to both, same-server app calls, and JSON-RPC 2.0 bridge messages. The accepted renderer is a dedicated web-client double-iframe opaque-origin proxy. It receives no direct Tauri authority, bearer token, host path, credential, provider setting, or ambient network/browser permission. M1 defines the descriptor and bridge/provenance contracts but renders no HTML and creates no bridge.

Named authority is host-issued, at most 15 minutes, and bound to owner/actor, app/publisher/package, installation, connection, view where applicable, operation, audience, exact capability set, record scopes, grant revision, token generation, revocation generation, and idempotency key. The app receives no serializable bearer value. Spec 02 remains owner-data/history/export authority, Spec 03 remains purpose policy/structured validation/repair/provider-compatibility authority, Spec 04 remains package trust/grants/lifecycle authority, and Spec 05 owns only the host wire, view/bridge protection, capability transport, inference transport, and supervisor interface.

App inference version 1 carries only typed messages, bounded context, output schema, stream/cancel, quality intent, budget, operation/idempotency identity, and exact host authority. Tools and provider fallback are false. Provider/model selection, credentials, endpoint, quotas, repair policy, and durable acceptance remain host/Spec 03 concerns and never cross the app contract. The accepted absolute ceilings remain 327,680 input bytes, 81,920 input tokens, 8,192 output tokens, 120 seconds, and two attempts, with purpose-specific Spec 03 ceilings allowed to be narrower.

The version-1 `InstalledAppSupervisor` remains the Spec 04 boundary: one active runtime per installation, one CPU, 512 MiB, 1 MiB response output, 120-second request timeout, 30-second startup timeout, and three crash restarts at 1/2/4 seconds before owner retry. Docker uses authenticated container-internal transport; the first packaged executable is verified compiled JavaScript on BrainDrive's packaged Node over authenticated loopback. Public/LAN bind is prohibited. Docker dev is required; native Windows is the first packaged claim; macOS/Linux remain configured but unclaimed.

The MVP optional-facility matrix is closed. Sampling is rejected as the app inference contract. Prompts/completions, remote OAuth, stdio, resource subscriptions, Tasks, and general elicitation are deferred. Marketplace, third-party/managed hosting, and public/LAN endpoints remain excluded.

`spec-05-foundation.ts`, its generated JSON Schemas, `fixtures/spec-05`, and `spec-05-m1.test.ts` are the executable decision and conformance foundation. Authority envelopes reject unknown fields; unknown critical protocol versions, extensions, facilities, schemas, bridge methods, capabilities, and runtime forms fail closed. Diagnostics are strict and content-free. Normalized parity may differ only by transport, process isolation, opaque package/cache references, and platform diagnostic fields.

This M1 diff adds contracts, exact dependency/lock evidence, fixtures, tests, schemas, and documentation only. It adds no app HTML, renderer, working bridge, capability route or execution, inference route or execution, package lifecycle mutation, dynamic server registration, or process/container launch. Prior commits on the feature branch already contain later runtime work; that baseline is a declared repository deviation and is not enabled or changed by this decision.

## ADR-RB-022 — Generic app-published project documents

**Status:** Accepted by DJJones, Project Owner, on 2026-08-10.

Installed apps may expose owner-readable Markdown through the generic project-document boundary. The gateway project service accepts registered document providers, derives a collision-safe path below `documents/<project-id>/published/<publisher-id>/<logical-id>.md`, validates bounded identity/title/content fields, and atomically refreshes the materialized projection before project file listing or reading. The existing project sidebar and Markdown viewer receive generic `displayName`, `readOnly`, `sourceLabel`, and `sourceType` metadata; they contain no Resume Builder-specific rendering or navigation rule. Writes through the project-file API to the reserved `published/` namespace fail closed.

Resume Builder is the first provider. It publishes the latest approved general definition into Career as `General Resume`; proposed drafts and targeted variants cannot replace that projection. The approved definition remains the authoritative record, prior versions remain in Resume Builder history, and the Markdown file is a host-managed readable projection rather than a second editable resume source. Refresh-on-list/read prevents an owner from being shown an older approved projection after a newer approval. The same provider contract can serve future apps and projects without adding app-specific behavior to Career.

This does not widen the sandbox capability grant, expose app filesystem access, or change the narrow Career-return journal schema. Projection writes are host-derived, content-bounded, Git-checkpointed on change, retained with owner memory, and continue to use the normal project document read path. App disable or default uninstall does not delete the retained approved definition or its materialized readable projection.

## ADR-RB-023 — Corrected product-quality contract authority

**Status:** Accepted by the Product Owner on 2026-08-11 with RB7-OQ-1 through RB7-OQ-4 retained as explicit accepted implementation blockers.

Schema 4 makes product-craft evidence versioned and downgrade-safe without declaring release readiness. A craft report v2 contains every C1–C7 and T1–T3 criterion exactly once, requires positive, negative, or explicit-absence evidence for each verdict, binds evidence to the exact definition/strategy/fact/coverage/target identities, identifies the product-craft evaluator contract, stores score-free findings, and seals the report body with a digest. Durable reports exclude raw prompts, reasoning, duplicated resume text, provider bodies, credentials, reviewer transcripts, and paths.

The shared quality-state vocabulary is limited to `review_not_run`, `review_incomplete`, `needs_correction`, `evidence_limited`, `product_craft_passed`, `owner_approved`, and `pre_correction_review`. It does not contain release readiness or independent-review claims. Approval evidence v2 requires an exact corrected report and evaluator binding. Historical approval/report v1 remains readable but derives only `pre_correction_review` and cannot satisfy a corrected new approval. Career return v2 carries approved identity, the narrow quality state, and the current report identity/digest when the state requires one.

The versioned synthetic regression manifest is workflow-only evidence at `resume-inference/fixtures/quality/qgc-frozen-regression-v1.json`. Its semantic input, normalized checkpoint, expected C1/C2 failure and C3 pass, policy identities, and complete manifest digest are immutable. Product code must not import, read, or branch on the fixture. Strategy canonicalization, evaluator algorithms, repair routing, UI/Career presentation decisions, controlled provider runs, human review, numeric friction, target threshold finalization, and release acceptance remain later work.

## ADR-RB-024 — Bounded correction operation v2 preserves historical authority

**Status:** Accepted by the Product Owner on 2026-08-11 for Spec 07 quality-gate-correction Milestone 4.

The existing repair-operation v1 contract remains readable. New current-policy attempts write repair-operation v2 with one `repair_statement` action, one exact correction class, exact statement scope, attempt one, immutable source/report/strategy/fact bindings, same provider/model identity, input/output and operation digests, terminal transition, safe recovery reason, unchanged-statement count, and optional successor definition/report identities. Completed operations require both successors and no recovery/error class; rejected or failed operations require no successor and an allowlisted content-free reason.

The inference repair result and repair-scope contracts accept historical v1 and current v2 shapes. Current v2 scope uses one correction class rather than a broad class set. Content-free capability audit adds correction action/transition/recovery, source/successor identities, digests, attempt, result, and counts. None of these fields carries resume text, opportunity copy, provider bodies, prompts, credentials, or paths. This adjustment does not change report v2, quality-state, approval, or Career metadata contracts established in Milestone 3.
