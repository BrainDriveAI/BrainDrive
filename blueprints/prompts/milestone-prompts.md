## Shared Rules

All milestone tests and completion checks must be bounded, non-interactive, and executable in the managed workspace-write sandbox.

Use `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce` as the exact baseline. Make documentation-only changes. Do not change runtime code, dependencies, lockfiles, configuration, installer behavior, security policy, release behavior, or credentials. Do not add external artifact references, unresolved placeholders, workflow expansion, policy claims, validation-authority claims, workflow-authority claims, or operational-authority claims.

Anvil owns Git checkpoint commits. Do not commit, amend, tag, or provide a commit hash. Produce completion evidence that is sufficient for Anvil to create the checkpoint.

Rationale: one bounded documentation file is enough to satisfy the pilot request while keeping review focused and reproducible against the named baseline.

## Milestone 1: Add Pilot Observation Note

### Context

Project: BrainDrive Live Remote Pilot 2026-08-01.

Requested outcome: add `docs/anvil-pilot-observation.md` only. The note must identify repository-native developer verification commands for the existing BrainDrive runtime, web client, and MCP package. The pilot baseline is `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

The note must list these command groups exactly:

Runtime, working directory `builds/typescript`, in order:
1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`

Web client, working directory `builds/typescript/client_web`, in order:
1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

MCP package, working directory `builds/mcp_release`, in order:
1. `npm ci`
2. `npm test`
3. `npm run build`

Rationale: these are the exact requested repository-native verification commands and ordering for the three existing project areas.

### Scope

Create a concise documentation-only pilot note. Keep the note limited to baseline, scope boundary, and ordered command lists. Do not edit any other file.

### Expected Changes

- Create `docs/anvil-pilot-observation.md`.

### Tests

First confirm toolchain probes before every project command. Each project command is required and bounded to 1,200 seconds.

## Commands

| # | Working Directory | Required Probes Before Command | Required Command | Timeout Seconds |
|---:|---|---|---|---:|
| 1 | `builds/typescript` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm ci` | 1200 |
| 2 | `builds/typescript` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run lint` | 1200 |
| 3 | `builds/typescript` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm test` | 1200 |
| 4 | `builds/typescript` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run build` | 1200 |
| 5 | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm ci` | 1200 |
| 6 | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run lint` | 1200 |
| 7 | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run typecheck` | 1200 |
| 8 | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm test` | 1200 |
| 9 | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run build` | 1200 |
| 10 | `builds/mcp_release` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm ci` | 1200 |
| 11 | `builds/mcp_release` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm test` | 1200 |
| 12 | `builds/mcp_release` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run build` | 1200 |

Also run bounded completion checks:

1. Confirm `docs/anvil-pilot-observation.md` exists.
2. Confirm the only changed repository path is `docs/anvil-pilot-observation.md`.
3. Confirm the note states `dev` and `ba37f0893fbde331675d8d209fb1abf375e0ecce`.
4. Confirm the note contains the exact runtime, web-client, and MCP command lists with the required working directories and order.
5. Confirm the note contains no `TODO`, `TBD`, template braces, external artifact references, or authority claims.

### Acceptance Criteria

The repository contains `docs/anvil-pilot-observation.md`. The only intended project change is that new documentation note. The note lists the exact four runtime, five web-client, and three MCP commands with required working directories and ordering. The note references `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce` as the pilot baseline. No prohibited file category is changed. The verification manifest contains exactly the 12 required commands, marks every command required, and bounds each command to 1,200 seconds. Node `>=22,<23` and npm `>=10,<11` probes pass before each project command and are included in handoff evidence.

### Completion Evidence

Provide a concise handoff with:

1. The changed path: `docs/anvil-pilot-observation.md`.
2. Confirmation that no other repository paths changed.
3. The final note contents or a concise summary proving the baseline and three command groups are present exactly.
4. The `node --version` and `npm --version` result observed before each project command.
5. Pass/fail result for each of the 12 required project commands, including working directory and timeout bound.
6. Confirmation that the note contains no external artifact references, unresolved placeholders, workflow expansion, policy claims, or authority claims.
7. Statement that the repository is ready for Anvil’s distinct Git checkpoint for this milestone.