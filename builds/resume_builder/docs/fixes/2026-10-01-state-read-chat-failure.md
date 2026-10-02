# Resume Builder status lookup and chat failure fix — 2026-10-01

Sanitized fix evidence for base `2756b32c6be11aca5e6e9476ac4a7f4e356b703d` on `fix/rb-state-read-failure`. This record is not product acceptance or live-provider verification.

## Defect and evidence

The supplied root-cause report (`../packets/p54/out.md`, outside this repository) records a live model call to `resume.state.read` carrying `action_input.queried_operation_id` with the zero UUID. It was an operation lookup, not a failed empty-input workspace read. The scoped operation catalog had no matching entry, so `resume-domain/store.ts` threw `not_found_within_scope` (404). The app-action mapper converted that into `execution_failed` with `recoverable: false`; `engine/loop.ts` then emitted `tool_error` and returned before another model response or terminal `done`. The reported owner symptom was a stopped chat turn whose incomplete-response notice blamed an interrupted model connection, although an app tool had failed. This session has not replayed that owner/provider trace.

The shipped descriptor built by `app-platform/lifecycle/fixture-repository.ts` advertised an optional queried operation ID even though the model-visible result schema describes current Profile, Resume, and export receipt state. The prior regression substituted a locally constructed empty-object input schema, so it could not detect this shipped exposure. The report also identifies lost app instructions during context-window truncation as a contributing condition; that change is explicitly excluded from this fix.

Before implementation, the real-descriptor regression failed because its input schema still contained `queried_operation_id`; ten app-error continuation cases failed because the model was called only once; the UI tests failed because tool failures said “the model connection was interrupted.” The source/shipped planner test also demonstrated that the operation-ID input was accepted.

## Governing context and accepted specifications

Repository context: `AGENTS.md`, `docs/developers/README.md`, `docs/developers/catalog.json` (installed-apps and web-to-tool routes), `docs/developers/verification.md`, `docs/developers/integrations/installed-apps.md`, `docs/developers/architecture/request-flows.md`, and `builds/typescript/app-platform/mcp-host/README.md`. Source, tests, and package configuration are executable evidence.

Accepted specifications supplied with this task (paths relative to the accepted `docs/` root):

- `apps/resume-builder/resume-builder-spec.md`, AC-14.1: “the model gives a plain-language, context-aware answer in the same conversation.”
- Same specification, AC-11.5: “the description matches the actual interface” and “The model never names a location, control, or artifact that does not exist.”
- `platform/host-chat/host-chat-spec.md`, AC-10.1: “the message states what failed in plain language Katie can understand”; “explains whether anything was changed, saved, skipped, or lost”; “offers the next useful recovery action.”
- Same specification, CHAT-3.1: “that work remains available, the owner receives an understandable next action, and the conversation is not replaced by a hard-failure screen.”
- `platform/app-platform/braindrive-app-host-spec.md`, APP-1.2: “Every CHAT-n story holds inside the app workspace”.

These specifications govern the owner outcome; the empty-object API is this fix's design choice, not a quoted specification requirement.

## Design and changed files

- `builds/typescript/app-platform/lifecycle/fixture-repository.ts`: advertise `resume.state.read` with an object schema, no properties, and `additionalProperties: false`. Schema identity and digest are produced by the existing descriptor builder.
- `builds/resume_builder/resources/inference-program.js` and `builds/resume_builder/src/chat-workspace.ts`: both app-owned planners reject nonempty/nonobject state-read input. `resources/agent-instructions.md` now states that operation recovery is separate, removing the obsolete model-facing operation lookup guidance.
- `builds/typescript/app-platform/mcp-host/app-chat-model.ts`: scoped absence codes `not_found_within_scope` and `operation_not_found` become recoverable `not_found` tool results. Explicit additional recoverable codes are `conflict`, `revision_conflict`, `provider_unavailable`, `rate_limited`, `quota_exceeded`, `deadline_exceeded`, and `operation_cancelled`. These mean the model can explain the failure, not that a mutation succeeded or may be retried blindly. Safe messages direct it to check current state first. Existing cancellation, input-validation, and permission mappings remain in place.
- Malformed action results, ambiguous runtime outcomes, broad `recoverable_internal_failure`, internal failures without a specifically allowed code, and unknown codes retain fatal behavior. Explicit fatal integrity codes stay fatal, but pre-existing integrity failures surfaced as `validation_failed` still map to recoverable `invalid_input`; the blanket integrity-fatal claim was incorrect. That classification remains a separate issue. Regression negatives cover `store_corrupt`, `ambiguous_runtime_state`, `package_archive_digest_mismatch`, `package_path_invalid`, `internal_failure`, `recoverable_internal_failure`, and an unknown code. A real storage fault after catalog publication additionally verifies fatal chat classification, retained committed data, scoped operation lookup, and idempotent recovery.
- `builds/typescript/client_web/src/components/chat/ChatPanel.tsx` passes the existing error code to `MessageList.tsx`. Both partial-text and no-assistant-text `tool_error` notices identify a failed tool/app action, explicitly say that the failed action’s changes could not be confirmed, say saved conversation and documents remain available, and direct the owner to check app state before retrying. Try Again replays the owner’s last message with retry metadata and without a duplicate user echo. Tool errors no longer trigger the connection-lost banner. Connection failure retains connection-specific wording and a retry action. The notice does not claim a failed action saved or changed nothing.
- Tests: `builds/resume_builder/test/chat-workspace.test.ts`, `builds/typescript/app-platform/mcp-host/app-chat-session.test.ts`, `builds/typescript/engine/loop.test.ts`, and the web `ChatPanel.test.tsx` / `MessageList.test.tsx` files.
- Documentation: this note, the Resume Builder and MCP-host READMEs, and the note's classification in `docs/developers/catalog.json`.

`engine/loop.ts` now caps all recoverable tool failures at three across a turn, including loop-guard and other guard results, without relying on an injected safety iteration limit. Successful calls do not reset the count. After emitting/auditing the final tool result, it ends with a clear fallback explaining uncertain action changes, saved work, and current-state/retry guidance, followed by terminal `done` (`tool_recovery_exhausted`); later calls in that batch are not executed. The existing three-invalid-input fallback remains in place. Tests exercise that actual loop through a reply and terminal `done`, while checking that fatal errors still stop it. New regressions reproduce repeated invalid shipped state reads and app failures under shipped defaults, plus the no-text recovery action. The existing authorized `resume.operations.read` capability/reconciliation path remains available to app recovery; no operation recovery store, dispatcher, capability schema, or app recovery UI changed. No context-window, provider configuration, credentials, or release/installer packaging changed.

Documentation impact: the package README and host README describe the changed action and error behavior. The request-flows page documents the new per-turn failure cap. The lifecycle README’s trust/install contract is unchanged because this follow-up changes neither package installation nor lifecycle authority.

## Original verification at `4ccdf52`

Tests were written and run before implementation. The workspace lacked dependencies; local dependencies were copied from a neighboring worktree after all three corresponding package lockfiles matched byte-for-byte. No tracked dependency files changed.

The state regression loads action descriptors from the actual newly generated signed package descriptor, then installs those exact actions into the isolated host harness. It does not substitute an empty-object schema. With a persisted Profile, created Resume, and finalized export receipt, `{}` returns current revisions/status/receipt. An operation-ID model call fails schema validation with recoverable `invalid_input`, never reaches operation lookup, and permits a subsequent model reply and terminal `done`. Separate app-error cases exercise the domain error mapper and actual engine loop; unsafe cases retain `tool_error` and no `done`. Source and shipped app planners agree. Rendered UI tests verify both failure reasons, saved-work language, and the clickable retry action; the ChatPanel test verifies propagation of the actual error code.

| Working directory | Command | Result |
|---|---|---|
| `builds/resume_builder` | `npm test -- --maxWorkers=2` | PASS: 9 files, 220 tests |
| `builds/resume_builder` | `npm run build` | PASS |
| `builds/typescript` | `npm run lint` | PASS |
| `builds/typescript` | `npm run build` | PASS |
| `builds/typescript` | `npm run web:lint` | PASS |
| `builds/typescript` | `npm run web:typecheck` | PASS |
| `builds/typescript` | `npm run web:test` | PASS: 27 files, 340 tests |
| `builds/typescript` | `npm run web:build` | PASS; font-path and bundle-size warnings |
| `builds/typescript` | `npm test -- --maxWorkers=2 app-platform/mcp-host engine` | PASS: 13 files, 133 tests |
| `builds/typescript` | `npm test -- --maxWorkers=2` | PASS: 157 files, 1,455 tests |
| `builds/typescript` | `npm run docs:check` | PASS: 269 scoped candidates, zero diagnostics |
| `builds/typescript` | `npm run docs:verify` | PASS: 166 documentation tests, one skip, zero failures; docs check passes |
| repository root | `node tools/docs/sync-generated.mjs --check` | PASS |

The focused MCP-host/engine suite initially failed only in its ten live signed-fixture cases because the sandbox prohibited local listeners (`listen EPERM`). It passed with local loopback access. The full runtime suite uses that same access. The first documentation test run detected a missing migration disposition for the new note's initial classification; using the catalog's existing non-authoritative evidence classification resolved the diagnostic, and the final documentation rerun is recorded above.

## Review follow-up verification

Test-first regressions failed before implementation: seven runtime cases (uncapped failures and unsafe internal-error continuation) and three UI cases (missing outcome wording and no-text recovery notice). Neither loop regression helper now injects `safetyIterationLimit`. The real shipped descriptor is used for the repeated operation-ID input regression. A post-catalog-commit storage hook proves that `recoverable_internal_failure` can coexist with committed data; the chat mapping stays fatal, while scoped lookup and idempotent operation recovery remain available. Interleaved successful calls and multiple calls in a completion cannot reset or bypass the cap.

Fresh follow-up checks ran against the uncommitted candidate based on `4ccdf52`, on this branch. Commands below run from `builds/typescript/` unless noted. The focused suite initially hit the sandbox’s `listen EPERM` loopback restriction; rerunning with local listener access passed. A later focused run overlapped broader checks and failed the existing cancellation-settlement timing assertion in `data-capability-bridge.test.ts` (pending rather than settled after releasing publication). The full runtime run and a separate final focused rerun both passed that test; no timing-test behavior was changed.

| Command | Result |
|---|---|
| `npm test -- --maxWorkers=2 app-platform/mcp-host engine` | PASS: 13 files, 141 tests (final separate run) |
| `npm run web:lint` | PASS |
| `npm run web:typecheck` | PASS |
| `npm run web:test` | PASS: 27 files, 341 tests |
| `npm run web:build` | PASS; existing font-path and bundle-size warnings |
| `npm test -- --maxWorkers=2` | PASS: 157 files, 1,463 tests |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run docs:check` | PASS: 269 scoped candidates, zero diagnostics |
| `npm run docs:verify` | PASS: 166 documentation tests, one skip, zero failures; docs check passes |
| `node tools/docs/sync-generated.mjs --check` (repository root) | PASS |
| `git diff --check` (repository root) | PASS |

Rendered web component tests verify the no-text failure notice, absence of connection-lost wording, saved-work/outcome explanation, and exactly one replay of the last owner message with preserved metadata. Live provider and installed-package validation remain outside this follow-up.

## Still needs live validation

Install a freshly rebuilt package in a disposable runtime and repeat an owner status/PDF-location question using a real provider, retained Profile/Resume state, and an export receipt. Inspect the provider-advertised schema and confirm the response accurately describes current state. Induce an app-action failure and a connection interruption separately; review the inline wording and recovery action in the running web app. Docker release and native desktop behavior, real-provider decisions, and accepted-spec human clarity scoring were not validated here. Existing installed packages retain their old descriptor until replaced through the normal package lifecycle. Context-window truncation remains a separate PR.
