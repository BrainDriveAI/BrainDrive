## Shared Rules

All milestone tests and completion checks must be bounded, non-interactive, and executable in the managed workspace-write sandbox.

Use `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce` as the exact baseline. Keep work documentation-only. Do not change runtime code, dependencies, lockfiles, configuration, installer behavior, security policy, release behavior, or credentials. Do not add external artifact references, unresolved placeholders, workflow expansion, policy claims, or any statement that provider text grants validation, workflow, or operational authority. Do not require a network listener, browser, manual check, watch process, `HTTPServer`, `ThreadingHTTPServer`, `TCPServer`, socket bind, or live-handler exercise. Anvil owns Git checkpoint commits; do not commit or provide a commit hash.

Rationale: one bounded documentation change is enough because the request identifies a single target file and an exact command matrix. Evidence: the authoritative inputs name `docs/anvil-pilot-observation.md`, the `dev` baseline commit, and the runtime, web client, and MCP verification commands.

## Milestone 1

### Context

Create the complete documentation-only pilot observation note for the BrainDrive Anvil Fresh Blueprint Pilot. The note must be tied to `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce` and must only identify repository-native developer verification commands for the existing BrainDrive runtime, web client, and MCP package.

### Scope

In scope: add one concise Markdown note at `docs/anvil-pilot-observation.md`.

Out of scope: runtime source changes, dependency or lockfile changes, configuration changes, installer changes, security policy changes, release behavior changes, credential changes, generated artifacts, external references, authority claims, or expanded workflow instructions.

### Expected Changes

- Create `docs/anvil-pilot-observation.md`.

The file must state the pilot baseline exactly as `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

The file must list these command groups with exact working directories and exact order:

Runtime, working directory `builds/typescript`:

1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`

Web client, working directory `builds/typescript/client_web`:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

MCP package, working directory `builds/mcp_release`:

1. `npm ci`
2. `npm test`
3. `npm run build`

Keep the note observational and concise. It must not imply that any file beyond `docs/anvil-pilot-observation.md` should change.

### Tests

Run bounded content and diff checks for the documentation change:

1. Confirm `docs/anvil-pilot-observation.md` exists.
2. Confirm the working tree change is limited to `docs/anvil-pilot-observation.md`.
3. Confirm the file contains the baseline string `dev` and `ba37f0893fbde331675d8d209fb1abf375e0ecce`.
4. Confirm the file contains exactly the required command names under the required working directories and in the required order.
5. Confirm the file contains no unresolved placeholders such as `TODO`, `TBD`, or template braces.
6. Confirm the file contains no external artifact references and no claims of validation, workflow, or operational authority.

Structured `## Commands` manifest for final verification at the exact candidate commit:

| Order | Required | Timeout | Working Directory | Pre-command Probes | Command |
|---:|---|---:|---|---|---|
| 1 | yes | 1200s | `builds/typescript` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm ci` |
| 2 | yes | 1200s | `builds/typescript` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run lint` |
| 3 | yes | 1200s | `builds/typescript` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm test` |
| 4 | yes | 1200s | `builds/typescript` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run build` |
| 5 | yes | 1200s | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm ci` |
| 6 | yes | 1200s | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run lint` |
| 7 | yes | 1200s | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run typecheck` |
| 8 | yes | 1200s | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm test` |
| 9 | yes | 1200s | `builds/typescript/client_web` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run build` |
| 10 | yes | 1200s | `builds/mcp_release` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm ci` |
| 11 | yes | 1200s | `builds/mcp_release` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm test` |
| 12 | yes | 1200s | `builds/mcp_release` | `node --version` must satisfy `>=22,<23`; `npm --version` must satisfy `>=10,<11` | `npm run build` |

### Acceptance Criteria

The repository contains `docs/anvil-pilot-observation.md` as the only intended project change.

The note lists the exact four runtime commands, five web-client commands, and three MCP commands with the required working directories and order.

The note references `dev` and commit `ba37f0893fbde331675d8d209fb1abf375e0ecce` as the pilot baseline.

No runtime source files, dependency manifests, lockfiles, configuration files, installer files, security policy files, release files, or credential files are changed.

The note contains no external artifact references, unresolved placeholders, unrelated guidance, generated filler, workflow expansion, policy claims, or authority claims.

The final verification manifest preserves exactly the 12 required project commands, marks each required, bounds each to 1,200 seconds, and requires direct `node --version` and `npm --version` probes before every project command with Node `>=22,<23` and npm `>=10,<11`.

### Completion Evidence

Provide the path changed: `docs/anvil-pilot-observation.md`.

Provide a concise summary of the note contents: baseline statement plus the three ordered command groups.

Provide evidence that the only intended change is the new documentation file.

Provide the results of the bounded content and diff checks.

Provide final verification evidence for the 12-command matrix, including that Node `>=22,<23` and npm `>=10,<11` probes passed before each project command.

Stop after this milestone for Anvil’s distinct Git checkpoint. Do not commit and do not provide a commit hash.