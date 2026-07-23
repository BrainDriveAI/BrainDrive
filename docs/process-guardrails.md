# Process Guardrails: Operations, Recovery, and Evaluation

Process guardrails coordinate the existing page interview, specification, plan,
and journal handoff procedures. They add no settings screen, API, role, provider,
credential, network destination, or owner-visible artifact type. The canonical
owner files remain `spec.md`, `plan.md`, and, when an update warrants one,
`journal.md`.

## Configuration

The server reads `BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE` when the runtime process
starts. Values are trimmed and case-insensitive.

| Value | Ollama | BrainDrive Models | OpenRouter | Unknown provider |
|---|---:|---:|---:|---:|
| `none` | bypass | bypass | bypass | bypass |
| `local` | guarded | bypass | bypass | bypass |
| `cloud` | bypass | guarded | guarded | bypass |
| `all` | guarded | guarded | guarded | bypass |

A missing or empty value defaults to `all`. Any other non-empty value fails
runtime configuration loading with:

```text
BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE must be one of: none, local, cloud, all
```

Provider classification uses the configured provider identity, not its base URL:
`ollama` is local; `braindrive-models` and `openrouter` are cloud. An unknown
identity fails closed to unguarded behavior. Scope changes do not change provider
credentials, BrainDrive Models credits, approvals, auth, or available provider
choices.

### Applying a scope change

- Docker local, production, or development: set the value in the install `.env`,
  then restart the app service or selected Docker mode. Vite hot module reload
  does not reload a server environment variable.
- Server-only: set the variable in the service/process environment, then fully
  stop and start the gateway process.
- Desktop: set the variable in the environment used to launch BrainDrive, then
  fully quit and relaunch the desktop app and its runtime. There is no in-app
  scope control.

Confirm startup logs include `process_guardrails.config` with the expected
`configured_scope` and `resolved_scope`. Do not put provider keys or secret
values in diagnostic notes.

## Runtime contract

Eligible page runs use this fixed order:

1. `interview`
2. `specification` → the page's `spec.md`
3. `plan` → the page's `plan.md`
4. `journal_handoff` → either exactly one eligible `journal.md` entry or no entry

The registered pages are Career, Finance, Fitness, Relationships, and New
Project. Your Agent and pages without the full procedure/artifact set remain
unguarded. Entry is structural: an eligible guarded turn exposes the internal
`process_start` control to the model, while resumable progress enters directly.
Internal process controls are not sent as owner-visible chat/tool events.

Candidate mutations still use the existing memory tools and approval policy.
Validation occurs before one canonical write. The controller permits at most two
structural attempts for a stage; after the first failure it returns stable
validator codes to the next attempt, and after the second it requires owner
action. Provider empty-completion retry accounting remains separate from these
two structural attempts.

An accepted artifact digest is checked before later stages. A valid owner edit is
preserved and reconciled. A missing or structurally invalid accepted artifact is
not overwritten: the run moves to an owner-action or recoverable state.
Concurrent/stale work uses revision checks so one result wins without duplicating
a write.

## State and traces

Guardrail state and traces are local implementation diagnostics beneath the
configured memory root:

```text
diagnostics/process-guardrails/state/<tuple-hash>.json
diagnostics/process-guardrails/traces/YYYY-MM-DD(.N).jsonl
```

They are not owner artifacts and are excluded from model memory browsing and
memory file tools. State is keyed to the conversation, page, and registered
process. JSONL traces contain allowlisted IDs, scope/provider/model identity,
stage/revision/attempt, event/status codes, durations, artifact/instruction
digests, and optional adapter metrics. They must not contain owner text, prompts,
artifact bodies, provider payloads, cookies, authorization data, credentials,
secret values, or stack traces.

V1 uses a fixed 14-day default retention policy. Terminal state is eligible for
expiry after 14 days. Nonterminal, corrupt, and unsupported state is retained so
recovery evidence is not silently lost. Trace files use the same 14-day window
and rotate at 5 MiB by default. There is no separate V1 guardrail retention
environment variable.

The audit stream also records structural events such as
`process_guardrails.config`, activation, validation, tool reconciliation, state
recovery, and request completion. Audit retention remains controlled by the
existing `PAA_AUDIT_*` settings.

## Recovery

| Observed state or reason | Meaning | Safe next action |
|---|---|---|
| `active` | One stage is waiting for the owner or a current attempt. | Continue in the same conversation and page. |
| `paused_recoverable` with `provider_timeout`, `provider_rate_limited`, or `provider_unavailable` | Progress was persisted before the provider error. | Restore provider availability, then explicitly say to resume. |
| `paused_recoverable` with `artifact_write_failed`, `artifact_write_ambiguous`, or `artifact_inspection_failed` | A write or reconciliation could not be proved safe. | Inspect the named canonical artifact and diagnostics; resume only after the filesystem/tool issue is resolved. |
| `needs_owner_action` with `structural_retry_exhausted` or validator codes | Both automatic structural attempts failed. | Edit the artifact, explicitly redo the stage, skip it, or stop. A plain resume does not reset the retry budget. |
| `needs_owner_action` with `approval_denied` | The existing approval flow denied the mutation. | Review the proposed canonical path and explicitly redo/skip/stop as appropriate. |
| `state_corrupt` or `state_unsupported_version` | Saved state cannot be trusted by this runtime. | Preserve the file, capture a support copy, and use `none` while an operator reviews it. Do not reconstruct progress from conversation text. |
| `diagnostic_health: degraded` / `trace_persist_failed` | Owner work may be intact, but acceptance evidence is incomplete. | Fix ownership, free space, or filesystem availability; preserve state/artifacts and rerun verification. |
| `completed` | Every stage resolved; journal may be accepted or `handoff_complete_no_entry`. | No action. Replays must not duplicate artifacts or entries. |
| `stopped_by_owner` | The owner explicitly stopped the run. | Start a new run only when the owner asks. |
| `failed_internal` | The controller could not safely continue. | Preserve artifacts/state/traces, collect sanitized logs, set `none`, and investigate before retrying. |

For recovery, record the app revision, configured/resolved scope, provider profile
and model ID, run/conversation/page IDs, terminal or active state, recovery reason,
diagnostic health, artifact digests, and relevant event codes. Never copy raw
owner artifacts or secrets into an incident report.

## Rollback

Set `BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE=none` and restart the runtime. This is
the supported immediate containment and clean unguarded baseline. It changes
future activation only. It does not delete, migrate, or rewrite:

- `spec.md`, `plan.md`, `journal.md`, profile files, or other owner artifacts;
- conversations or tool history;
- process state or JSONL traces;
- owner instruction overlays or page procedures.

Existing nonterminal state remains available if an eligible scope is restored.
Do not delete diagnostics as part of rollback. Preserve them for recovery and
privacy-safe incident reconstruction.

## Deterministic browser verification

BrainDrive-Harness provides a credential-free, real-browser source run:

```bash
cd /path/to/BrainDrive-Harness
BRAINDRIVE_SOURCE_DIR=/path/to/BrainDrive \
  ./runs/BrainDrive/process-guardrails-dev-source.sh
```

The run uses disposable memory and a local OpenAI-compatible fixture through the
real web app, gateway, engine, and MCP file tools. Evidence records exact product
and harness revisions/dirty status, fixture identity, sanitized provider request
digests, scope decisions, runtime restart generations, state/trace validation,
artifact hashes, screenshots, and the owner-visible transcript. The wrapper also
runs the credential-free contamination scan:

```bash
node scripts/check-process-guardrail-contamination.mjs --source /path/to/BrainDrive
```

The scan compares frozen starter-baseline opening prompts and scripted answers
against production guardrail sources and the new generic fixture. Frozen Katie
answers and expected production strings are not modified by this workflow.

## Later paired evaluation

Implementation verification does not require a live provider, chosen model, or
16 GB evaluation host. When evaluation owners are ready, keep scenario inputs,
model/provider settings, repetitions, hardware, and revisions identical and vary
only the scope lane:

| Comparison purpose | Baseline | Guarded |
|---|---|---|
| Local model | `none` | `local` |
| Hosted/OpenRouter model | `none` | `cloud` |
| Product default behavior | `none` | `all` |

For runtime comparisons, use the BrainDrive-Harness real-browser workflow and
attach the same provenance and state/trace fields described above. Do not mix
infrastructure/provider failures with product outcomes.

The BrainDrive-Library starter-pack harness is a separate, read-only
conversation/content evaluation lane. It cannot prove runtime activation, tools,
writes, browser behavior, restart/resume, or rollback. From its
`projects/active/foundation/starter-pack-testing-harness` directory, later
credentialed evaluators may run:

```bash
./smoke.sh

python3 openrouter-eval.py --domain finance --persona katie-a \
  --model <advisor-model> --persona-model <fixed-persona-model> \
  --concurrency 1 --repeat 3

python3 judge.py --batch 'runs/finance-katie-a-*.json' --no-dedupe
```

Those commands require the evaluator's own configured provider credential. They
are documented for later use only: Milestone 6 neither runs them nor changes the
pack-only corpus.
