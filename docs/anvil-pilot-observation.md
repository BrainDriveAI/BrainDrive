# Anvil Pilot Observation

Pilot baseline: `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

This note records repository-native developer verification commands for the existing BrainDrive runtime, web client, and MCP package. No other repository files are identified for change.

## Command Groups

### Runtime

Working directory: `builds/typescript`

1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`

### Web Client

Working directory: `builds/typescript/client_web`

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

### MCP Package

Working directory: `builds/mcp_release`

1. `npm ci`
2. `npm test`
3. `npm run build`

## Commands

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
