## Requirement Traceability

1. REQ-001: Create exactly one new file: `docs/anvil-pilot-observation.md`.
   Evidence: The specification names this file as the required documentation-only output.

2. REQ-002, REQ-007: Keep the implementation limited to that file and make no changes to runtime code, dependencies, lockfiles, configuration, installer behavior, security policy, release behavior, or credentials.
   Evidence: The requested outcome explicitly bounds the pilot to documentation.

3. REQ-003: In the note, list runtime verification commands from `builds/typescript` in this exact order: `npm ci`, `npm run lint`, `npm test`, `npm run build`.

4. REQ-004: In the note, list web client verification commands from `builds/typescript/client_web` in this exact order: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

5. REQ-005: In the note, list MCP package verification commands from `builds/mcp_release` in this exact order: `npm ci`, `npm test`, `npm run build`.

6. REQ-006: State the pilot baseline exactly as `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

7. REQ-008, REQ-009: Keep the note concise and observational, avoiding unrelated guidance, generated content, workflow expansion, policy claims, and any statement that provider text grants validation, workflow, or operational authority.

8. REQ-010, REQ-011: Define final verification using the exact 12 project-command matrix, each required, each bounded to 1,200 seconds, with direct `node --version` and `npm --version` probes before every runtime-sensitive command requiring Node `>=22,<23` and npm `>=10,<11`.

## Architecture

The implementation is a single Markdown documentation addition under `docs/`. No runtime or build architecture changes are needed because the requested artifact only records repository-native verification commands.

The note should be structured around the three existing work areas named in the specification: BrainDrive runtime, web client, and MCP package. Each section should include only the working directory and ordered commands required by REQ-003 through REQ-005, plus the baseline statement required by REQ-006.

This architecture keeps review scope narrow: reviewers can confirm the diff contains one new documentation file and compare the listed commands directly against the requirement matrix.

## Milestones

1. Confirm baseline intent.
   Tie the note to `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce` without adding external artifact references.
   Covers REQ-006 and supports reviewability.

2. Add the documentation note.
   Create `docs/anvil-pilot-observation.md` with concise Markdown content only.
   Covers REQ-001 and REQ-002.

3. Encode the command groups.
   Add the runtime, web client, and MCP command lists with exact working directories, exact command names, and exact order.
   Covers REQ-003, REQ-004, and REQ-005.

4. Bound the language.
   Remove unrelated guidance, workflow expansion, generated filler, placeholders, external references, and authority claims.
   Covers REQ-007, REQ-008, and REQ-009.

5. Verify the candidate commit.
   Use the structured command manifest below at the exact candidate commit, with environment probes before every project command.
   Covers REQ-010 and REQ-011.

## Verification

Structured `## Commands` manifest for final verification:

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

Additional review checks:

1. Confirm `docs/anvil-pilot-observation.md` exists.
2. Confirm the only intended project change is that new documentation file.
3. Confirm the note contains no unresolved placeholders, external artifact references, or authority claims.
4. Confirm no runtime source files, dependency manifests, lockfiles, configuration files, installer files, security policy files, release files, or credential files changed.