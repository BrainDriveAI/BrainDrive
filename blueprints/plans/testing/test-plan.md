## Fixtures

1. Baseline fixture: `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.
   Rationale: anchors the pilot note to the exact requested upstream baseline.

2. Documentation fixture: `docs/anvil-pilot-observation.md`.
   Rationale: the requested change is documentation-only and bounded to one new file.

3. Runtime command fixture: working directory `builds/typescript`, ordered commands `npm ci`, `npm run lint`, `npm test`, `npm run build`.
   Rationale: covers existing BrainDrive runtime verification without expanding workflow scope.

4. Web-client command fixture: working directory `builds/typescript/client_web`, ordered commands `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
   Rationale: covers the existing web client with the exact requested repo-native command sequence.

5. MCP package command fixture: working directory `builds/mcp_release`, ordered commands `npm ci`, `npm test`, `npm run build`.
   Rationale: covers the existing MCP release package with the exact requested checks.

## Scenarios

1. Create the pilot note only.
   Evidence target: repository contains `docs/anvil-pilot-observation.md`, and no other repository path is intentionally changed.

2. Verify baseline identity in the note.
   Evidence target: the note states `dev` and `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

3. Verify runtime command listing.
   Evidence target: the note lists exactly four runtime commands under `builds/typescript`, in this order: `npm ci`, `npm run lint`, `npm test`, `npm run build`.

4. Verify web-client command listing.
   Evidence target: the note lists exactly five web-client commands under `builds/typescript/client_web`, in this order: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

5. Verify MCP package command listing.
   Evidence target: the note lists exactly three MCP package commands under `builds/mcp_release`, in this order: `npm ci`, `npm test`, `npm run build`.

6. Verify bounded content.
   Evidence target: the note contains no external artifact references, unresolved placeholders, workflow expansion, policy claims, validation-authority claims, workflow-authority claims, or operational-authority claims.

## Commands

```json
{
  "schema_version": "1.1",
  "runtime_requirements": [
    {
      "id": "node-22",
      "probe_argv": ["node", "--version"],
      "specifier": ">=22,<23",
      "timeout_seconds": 60,
      "max_output_bytes": 65536
    },
    {
      "id": "npm-10",
      "probe_argv": ["npm", "--version"],
      "specifier": ">=10,<11",
      "timeout_seconds": 60,
      "max_output_bytes": 65536
    }
  ],
  "commands": [
    {
      "id": "runtime-npm-ci",
      "argv": ["npm", "ci"],
      "cwd": "builds/typescript",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "runtime-lint",
      "argv": ["npm", "run", "lint"],
      "cwd": "builds/typescript",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "runtime-test",
      "argv": ["npm", "test"],
      "cwd": "builds/typescript",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "runtime-build",
      "argv": ["npm", "run", "build"],
      "cwd": "builds/typescript",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-npm-ci",
      "argv": ["npm", "ci"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-lint",
      "argv": ["npm", "run", "lint"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-typecheck",
      "argv": ["npm", "run", "typecheck"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-test",
      "argv": ["npm", "test"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-build",
      "argv": ["npm", "run", "build"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "mcp-npm-ci",
      "argv": ["npm", "ci"],
      "cwd": "builds/mcp_release",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "mcp-test",
      "argv": ["npm", "test"],
      "cwd": "builds/mcp_release",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "mcp-build",
      "argv": ["npm", "run", "build"],
      "cwd": "builds/mcp_release",
      "timeout_seconds": 1200,
      "required": true,
      "runtime_requirement_ids": ["node-22", "npm-10"]
    }
  ]
}
```

## Expected Evidence

1. Changed path evidence: only `docs/anvil-pilot-observation.md` is changed.

2. Baseline evidence: the note includes `dev` and `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

3. Command evidence: the note includes the exact four runtime, five web-client, and three MCP commands with their required working directories and order.

4. Probe evidence: before each required project command, `node --version` satisfies `>=22,<23` and `npm --version` satisfies `>=10,<11`.

5. Execution evidence: each of the 12 required project commands exits successfully within its 1,200-second bound.

6. Content-boundary evidence: the note contains no external artifact references, unresolved placeholders, workflow expansion, policy claims, validation-authority claims, workflow-authority claims, or operational-authority claims.

## Regression Coverage

1. Documentation-only scope regression: catches accidental edits to runtime code, dependencies, lockfiles, configuration, installer behavior, security policy, release behavior, or credentials by requiring the changed path set to contain only `docs/anvil-pilot-observation.md`.

2. Baseline drift regression: catches omission or mutation of the required pilot baseline by checking for `dev` and commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`.

3. Runtime verification regression: catches missing, reordered, or substituted runtime commands by requiring the exact `builds/typescript` four-command sequence.

4. Web-client verification regression: catches missing, reordered, or substituted web commands by requiring the exact `builds/typescript/client_web` five-command sequence.

5. MCP verification regression: catches missing, reordered, or substituted MCP commands by requiring the exact `builds/mcp_release` three-command sequence.

6. Toolchain regression: catches execution under an unsupported local toolchain by binding Node `>=22,<23` and npm `>=10,<11` probes before every project command.

7. Scope-expansion regression: catches unwanted process or authority language by checking that the note avoids external artifact references, placeholders, workflow expansion, policy claims, and authority claims.