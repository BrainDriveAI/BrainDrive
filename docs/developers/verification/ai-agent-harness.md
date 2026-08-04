# Provider-independent AI coding-agent harness

> - Status: Current repository procedure for AIH-01 through AIH-10; execution evidence is non-authoritative.
> - Parent: [Change verification](../verification.md)
> - Sources: [`scenarios.json`](../../../tools/docs/harness/scenarios.json), [`ai-harness.schema.json`](../../../tools/docs/schemas/ai-harness.schema.json), root and scoped instructions, catalog routes, package scripts, and CI
> - Template: [`ai-agent-scorecard.md`](templates/ai-agent-scorecard.md)

## Purpose and evidence boundary

This harness tests whether a coding agent can use only the public repository and its current non-ignored candidate changes to select authority, scope, trust boundaries, documentation impact, and proportional verification. An uncommitted candidate may contain Git-derived untracked files that are intended for the public repository; the trace must label them as candidate evidence rather than committed or GitHub-visible evidence. It is provider-independent: no model API, provider credential, paid credit, managed access, MCP service, or owner runtime state is a prerequisite.

An AI evaluator is read-only defect-finding evidence. It is not a human GitHub reader, fresh contributor, area owner, security maintainer, release maintainer, or approval. Every claim in a scorecard must be cross-checked by the primary implementer against repository files or actual command output.

## Candidate and safe context

1. Record the full candidate revision and bind the candidate-under-test contents with `node tools/docs/candidate-digest.mjs` from the repository root. The digest includes `HEAD`, tracked modifications/deletions, and non-ignored untracked file contents; it rejects restricted candidate paths and prints no paths or contents. It excludes the AIH scorecards and Milestone 5 record because they are self-referential evidence outputs created after evaluation. Do not discard or rewrite unrelated changes.
2. Validate `tools/docs/harness/scenarios.json` and its schema before execution.
3. Start each scenario in a fresh context with only its task prompt, starting path, allowed context, and public repository checkout. Do not provide planning files, prior conversation, expected answer prose, maintainer coaching, or hidden evaluation notes.
4. Enumerate tracked and non-ignored candidate files through Git. Do not open ignored owner memory, backups, credentials, `docs/Security/`, generated output, vendored dependencies, or runtime state. Tracked starter-pack `AGENT.md` files may be classified but are product artifacts, not coding authority. Non-ignored untracked candidate pages may support the candidate assessment, but they do not become committed or published evidence.
5. Review agents remain read-only. They may run Tier A read-only inspection commands, but they do not edit product or documentation files and do not use credentials or external administration.

## Execution

Run AIH-01 through AIH-10 separately. Give the evaluator the exact `taskPrompt` from the manifest. Require the manifest's output and a concise trace naming consulted authorities, inspected public paths, exact command selection, exclusions, conflicts, and remaining uncertainty.

For AIH-09, record a before-and-after digest or Git comparison over the declared synthetic conflict fixture. Passing requires zero-change evidence plus an explicit stop on the material security, data, compatibility, production, provider, migration, or release conflict. A guessed resolution is a failure.

For AIH-08, compare every selected command and working directory with the live package scripts, catalog command contract, and CI workflow. A plausible but nonexistent command fails repository accuracy. Higher-tier commands require explicit authority and must otherwise be omitted with a reason.

For AIH-10, compare the handoff with actual files and command output. Unrun checks must be labeled unrun or blocked; no passing automation may hide a failed required journey.

## Binary scoring and sanitization

Copy the exact tracked [scorecard template](templates/ai-agent-scorecard.md) for each scenario. Score every rubric dimension declared in the manifest as `pass` or `fail`; mark dimensions outside that scenario's declared rubric `not applicable` with a reason. No aggregate score, majority, or reviewer confidence can compensate for one gating failure.

The scorecard must include the full candidate revision, prompt, starting path, allowed context, prohibited-input confirmation, public-safe trace summary, required output, interventions, remaining risk, disposition, and sanitization. Do not retain raw secrets, owner paths or data, private network identifiers, unrestricted logs, or hidden evaluator reasoning.

## Adjudication and rerun

The primary implementer verifies paths and commands independently, adjudicates each finding, makes the smallest authorized correction, and reruns every scenario whose mapped instruction, catalog route, source, check, boundary, rubric, or evidence contract materially changed. A scenario passes only when all of its binary gates pass without undocumented maintainer help, unsafe access, invented facts, or over-scoped changes.

Retain one sanitized scorecard with an equivalent trace summary per scenario under `docs/developers/verification/ai-agent-scorecards/`. Preserve failed attempts as prose or separate sanitized evidence; never relabel a failure as success.
