# Anvil Pilot Observation

Pilot baseline: `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

Scope boundary: documentation-only observation note for repository-native developer verification commands covering the existing BrainDrive runtime, web client, and MCP package.

## Verification Manifest

Before each project command, confirm `node --version` satisfies `>=22,<23` and `npm --version` satisfies `>=10,<11`.

## Runtime

Working directory: `builds/typescript`

| Order | Required Command | Required | Timeout Seconds |
|---:|---|---|---:|
| 1 | `npm ci` | Yes | 1200 |
| 2 | `npm run lint` | Yes | 1200 |
| 3 | `npm test` | Yes | 1200 |
| 4 | `npm run build` | Yes | 1200 |

## Web Client

Working directory: `builds/typescript/client_web`

| Order | Required Command | Required | Timeout Seconds |
|---:|---|---|---:|
| 1 | `npm ci` | Yes | 1200 |
| 2 | `npm run lint` | Yes | 1200 |
| 3 | `npm run typecheck` | Yes | 1200 |
| 4 | `npm test` | Yes | 1200 |
| 5 | `npm run build` | Yes | 1200 |

## MCP Package

Working directory: `builds/mcp_release`

| Order | Required Command | Required | Timeout Seconds |
|---:|---|---|---:|
| 1 | `npm ci` | Yes | 1200 |
| 2 | `npm test` | Yes | 1200 |
| 3 | `npm run build` | Yes | 1200 |
