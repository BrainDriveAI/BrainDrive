## Requirement Traceability

| Requirement | Implementation Plan | Rationale / Evidence |
|---|---|---|
| REQ-001 | Add exactly one new file: `docs/anvil-pilot-observation.md`. | The specification names this exact target path. |
| REQ-002 | Keep the note documentation-only and self-contained. | The requested outcome forbids changes outside the note. |
| REQ-003 | In the note, list runtime commands under `builds/typescript` in this exact order: `npm ci`, `npm run lint`, `npm test`, `npm run build`. | Preserves the required runtime verification matrix. |
| REQ-004 | In the note, list web-client commands under `builds/typescript/client_web` in this exact order: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. | Preserves the required web-client verification matrix. |
| REQ-005 | In the note, list MCP package commands under `builds/mcp_release` in this exact order: `npm ci`, `npm test`, `npm run build`. | Preserves the required MCP verification matrix. |
| REQ-006 | State the pilot baseline as `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`. | Keeps the pilot reproducible against the exact requested baseline. |
| REQ-007 | Do not modify runtime code, dependencies, lockfiles, configuration, installer behavior, security policy, release behavior, or credentials. | Scope is documentation-only. |
| REQ-008 | Keep prose concise: baseline, scope boundary, and command lists only. | Avoids unrelated guidance, generated content, workflow expansion, and policy claims. |
| REQ-009 | Do not include validation-authority, workflow-authority, or operational-authority claims. | The specification explicitly forbids these claims. |
| REQ-010 | Verification manifest includes exactly 12 required project commands, each bounded to 1,200 seconds. | Matches the accepted command matrix. |
| REQ-011 | Bind direct `node --version` and `npm --version` probes to every project command, requiring Node `>=22,<23` and npm `>=10,<11`. | Ensures runtime-sensitive commands run only after the required toolchain probes. |

## Architecture

This is a single-file documentation change. The implementation should create `docs/anvil-pilot-observation.md` with three command groups: existing BrainDrive runtime, web client, and MCP package. The note should include the exact baseline branch and commit, a short scope boundary, and the ordered command lists.

No runtime architecture changes are needed. No package manifests, lockfiles, configuration, installer assets, security policy, release files, generated files, or credentials should be touched. This keeps review bounded to one documentation artifact and makes the diff directly traceable to the specification.

## Milestones

1. Confirm candidate work starts from `dev` at `ba37f0893fbde331675d8d209fb1abf375e0ecce`.
2. Create `docs/anvil-pilot-observation.md` only.
3. Add concise baseline text: `dev` at `ba37f0893fbde331675d8d209fb1abf375e0ecce`.
4. Add the runtime command group for `builds/typescript` with the exact four commands in order.
5. Add the web-client command group for `builds/typescript/client_web` with the exact five commands in order.
6. Add the MCP command group for `builds/mcp_release` with the exact three commands in order.
7. Review the note for prohibited content: no external artifact references, unresolved placeholders, workflow expansion, policy claims, or authority claims.
8. Verify the final diff contains only `docs/anvil-pilot-observation.md`.

## Verification

Run verification at the exact candidate commit produced from baseline `dev` commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

Commands manifest:

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

Additional review checks: confirm `docs/anvil-pilot-observation.md` exists, confirm no other files changed, and confirm the note contains no external artifact references, placeholders, or authority claims.