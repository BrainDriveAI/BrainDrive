## Fixtures

Fixture: `docs/anvil-pilot-observation.md`

```markdown
# Anvil Pilot Observation

Pilot baseline: `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

This documentation-only note identifies repository-native developer verification commands for the existing BrainDrive runtime, web client, and MCP package. It does not require or imply changes outside this file.

## Runtime

Working directory: `builds/typescript`

1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`

## Web Client

Working directory: `builds/typescript/client_web`

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

## MCP Package

Working directory: `builds/mcp_release`

1. `npm ci`
2. `npm test`
3. `npm run build`
```

Rationale: one bounded Markdown fixture satisfies the documentation-only scope, ties the note to the exact `dev` baseline commit, and records only the required command groups.

## Scenarios

1. Documentation artifact exists: confirm `docs/anvil-pilot-observation.md` is present.
2. Bounded diff: confirm the only intended project change is `docs/anvil-pilot-observation.md`.
3. Baseline traceability: confirm the note contains `dev` and `ba37f0893fbde331675d8d209fb1abf375e0ecce`.
4. Runtime command coverage: confirm the `builds/typescript` commands appear in exact order: `npm ci`, `npm run lint`, `npm test`, `npm run build`.
5. Web command coverage: confirm the `builds/typescript/client_web` commands appear in exact order: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
6. MCP command coverage: confirm the `builds/mcp_release` commands appear in exact order: `npm ci`, `npm test`, `npm run build`.
7. Scope guard: confirm no runtime code, dependency manifests, lockfiles, configuration files, installer files, security policy files, release files, or credential files changed.
8. Content guard: confirm the note contains no unresolved placeholders, external artifact references, expanded workflow instructions, policy claims, or validation/workflow/operational authority claims.

## Commands

Runtime requirements before every project command: run `node --version` and require `>=22,<23`; run `npm --version` and require `>=10,<11`.

| Order | Required | Timeout | Working Directory | Pre-command Probes | Command |
|---:|---|---:|---|---|---|
| 1 | yes | 1200s | `builds/typescript` | `node --version`; `npm --version` | `npm ci` |
| 2 | yes | 1200s | `builds/typescript` | `node --version`; `npm --version` | `npm run lint` |
| 3 | yes | 1200s | `builds/typescript` | `node --version`; `npm --version` | `npm test` |
| 4 | yes | 1200s | `builds/typescript` | `node --version`; `npm --version` | `npm run build` |
| 5 | yes | 1200s | `builds/typescript/client_web` | `node --version`; `npm --version` | `npm ci` |
| 6 | yes | 1200s | `builds/typescript/client_web` | `node --version`; `npm --version` | `npm run lint` |
| 7 | yes | 1200s | `builds/typescript/client_web` | `node --version`; `npm --version` | `npm run typecheck` |
| 8 | yes | 1200s | `builds/typescript/client_web` | `node --version`; `npm --version` | `npm test` |
| 9 | yes | 1200s | `builds/typescript/client_web` | `node --version`; `npm --version` | `npm run build` |
| 10 | yes | 1200s | `builds/mcp_release` | `node --version`; `npm --version` | `npm ci` |
| 11 | yes | 1200s | `builds/mcp_release` | `node --version`; `npm --version` | `npm test` |
| 12 | yes | 1200s | `builds/mcp_release` | `node --version`; `npm --version` | `npm run build` |

Rationale: this preserves the exact 12-command matrix, required status, working directories, order, and 1,200-second bounds while binding direct Node and npm probes before each command.

## Expected Evidence

- Changed path evidence: only `docs/anvil-pilot-observation.md` is added.
- Content evidence: the note contains the exact baseline `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.
- Command evidence: the note lists four runtime commands, five web-client commands, and three MCP commands under the required working directories in the required order.
- Guard evidence: no runtime source, dependency manifest, lockfile, configuration, installer, security policy, release, or credential path is modified.
- Probe evidence: each project command is preceded by passing `node --version` evidence satisfying `>=22,<23` and `npm --version` evidence satisfying `>=10,<11`.
- Execution evidence: all 12 required project commands complete at the exact candidate commit within 1,200 seconds each.

## Regression Coverage

- Prevents command drift by checking exact command names, working directories, and order for runtime, web client, and MCP package verification.
- Prevents scope drift by requiring the diff to remain limited to the single documentation note.
- Prevents baseline drift by requiring the exact `dev` baseline commit string in the note.
- Prevents environment ambiguity by requiring Node `>=22,<23` and npm `>=10,<11` probes before every runtime-sensitive command.
- Prevents documentation overreach by checking for placeholders, external artifact references, workflow expansion, policy claims, and authority claims.