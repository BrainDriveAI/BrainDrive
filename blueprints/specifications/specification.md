## Scope

Create one documentation-only pilot note at `docs/anvil-pilot-observation.md` for the BrainDrive Live Remote Pilot 2026-08-01 project.

The note must identify repository-native developer verification commands relevant to the existing BrainDrive runtime, web client, and MCP package.

The work is bounded to documentation. It must not change runtime code, dependencies, lockfiles, configuration, installer behavior, security policy, release behavior, or credentials.

Baseline context: use `dev` as the exact baseline, with baseline commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

Evidence: the request explicitly names the target file, forbids non-documentation changes, and identifies the exact baseline branch and commit; no additional upstream artifacts or bound references were provided.

## User Stories

As a BrainDrive developer, I want a concise pilot observation note listing the repo-native verification commands so I can quickly identify the checks relevant to runtime, web client, and MCP package work.

As a reviewer, I want the change limited to one documentation file so I can verify that no runtime, dependency, configuration, installer, security, release, or credential behavior changed.

As a maintainer, I want the note tied to the specified `dev` baseline and exact commit so the pilot remains reviewable and reproducible in scope.

## Requirements

REQ-001: Add a new documentation file at `docs/anvil-pilot-observation.md`.

REQ-002: The file must be documentation-only and must not require or imply changes outside `docs/anvil-pilot-observation.md`.

REQ-003: Runtime verification must use exactly these commands from `builds/typescript`, in this order: `npm ci`, `npm run lint`, `npm test`, and `npm run build`.

REQ-004: Web client verification must use exactly these commands from `builds/typescript/client_web`, in this order: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

REQ-005: MCP package verification must use exactly these commands from `builds/mcp_release`, in this order: `npm ci`, `npm test`, and `npm run build`.

REQ-006: The note must state that the pilot baseline is `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

REQ-007: The change must not modify runtime code, dependencies, lockfiles, configuration, installer behavior, security policy, release behavior, or credentials.

REQ-008: The note must remain reviewable and bounded by avoiding unrelated guidance, generated content, workflow expansion, or policy claims.

REQ-009: The note must not claim that provider text grants validation authority, workflow authority, or operational authority.

REQ-010: The generated verification plan must encode the exact 12-command matrix in its structured `## Commands` manifest, mark every command required, and bound every command to 1,200 seconds.

REQ-011: Before any project command, the verification manifest must bind direct `node --version` and `npm --version` probes to every runtime-sensitive command, requiring Node `>=22,<23` and npm `>=10,<11`.

## Acceptance Criteria

The repository contains `docs/anvil-pilot-observation.md`.

The only intended project change is the new documentation note.

The note lists the exact four runtime, five web-client, and three MCP commands, with the required working directories and order.

The note references `dev` and commit `ba37f0893fbde331675d8d209fb1abf375e0ecce` as the pilot baseline.

No runtime source files, dependency manifests, lockfiles, configuration files, installer files, security policy files, release files, or credential files are changed.

The note does not include external artifact references, unresolved placeholders, or claims of operational authority.

The accepted verification manifest contains exactly the required 12 commands, with 1,200-second bounds, and executes them at the exact candidate commit.

Node `>=22,<23` and npm `>=10,<11` probes pass before any project command and remain present in the final verification and handoff evidence.

## Open Questions

1. Which exact command names should the note include for each area?

Recommended Default: Use exactly four runtime commands (`npm ci`, lint, test, build), five web-client commands (`npm ci`, lint, typecheck, test, build), and three MCP commands (`npm ci`, test, build), grouped under their exact working directories.

Rationale: This is the exact CI-equivalent matrix independently proven on the frozen baseline and prevents Anvil from inventing or omitting verification scope.

2. Should the note include instructions for running the commands or only identify them?

Recommended Default: Keep the note concise and identify the commands with minimal context, without adding expanded workflow instructions.

Rationale: The request asks for a pilot observation note and emphasizes bounded, reviewable documentation-only work.

3. Should the note discuss validation authority or process ownership?

Recommended Default: Do not include authority claims.

Rationale: The request explicitly says not to claim that provider text grants validation or workflow authority, and the artifact should stay limited to documentation of relevant commands.
