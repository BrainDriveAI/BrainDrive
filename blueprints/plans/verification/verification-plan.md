## Strategy
Produce a requirement-level verification manifest for the documentation-only pilot. The strategy verifies the single required documentation artifact and then runs only the accepted repository-native command matrix for the BrainDrive runtime, web client, and MCP package. Runtime-sensitive commands are bound to direct Node and npm version probes using PEP 440 constraints before execution.

Rationale: the accepted specification and plan require one documentation file, prohibit non-documentation changes, and define the exact 12 project commands, working directories, order, and 1,200-second bounds. No provider text is treated as validation or workflow authority.

## Requirement Coverage
REQ-001, REQ-002, REQ-006, REQ-008, REQ-009: covered by review evidence for `docs/anvil-pilot-observation.md`, including baseline text, bounded scope, no placeholders, no external artifact references, and no authority claims.

REQ-003 through REQ-005: covered by the exact runtime, web-client, and MCP command matrix in the required order and working directories.

REQ-007: covered by `finding_paths` scoped to the intended documentation file and the relevant package workspaces for verification output review, with no commands that write Git state or modify runtime source by design.

REQ-010 and REQ-011: covered by the manifest below: exactly 12 required project commands, each bounded to 1,200 seconds, each referencing direct `node --version` and `npm --version` probes requiring Node `>=22,<23` and npm `>=10,<11`.

## Evidence
Authoritative upstream inputs specify baseline `dev` at commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`, target file `docs/anvil-pilot-observation.md`, documentation-only scope, and the exact command matrix. The manifest does not add unrelated audits, shell interpreters, inline evaluators, listeners, watchers, destructive commands, Git writes, or invented fallbacks.

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
      "max_output_bytes": 2000000,
      "network_required": true,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/package.json", "builds/typescript/package-lock.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "runtime-lint",
      "argv": ["npm", "run", "lint"],
      "cwd": "builds/typescript",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "runtime-test",
      "argv": ["npm", "test"],
      "cwd": "builds/typescript",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "runtime-build",
      "argv": ["npm", "run", "build"],
      "cwd": "builds/typescript",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-client-npm-ci",
      "argv": ["npm", "ci"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": true,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/client_web/package.json", "builds/typescript/client_web/package-lock.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-client-lint",
      "argv": ["npm", "run", "lint"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/client_web"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-client-typecheck",
      "argv": ["npm", "run", "typecheck"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/client_web"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-client-test",
      "argv": ["npm", "test"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/client_web"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-client-build",
      "argv": ["npm", "run", "build"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/client_web"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "mcp-package-npm-ci",
      "argv": ["npm", "ci"],
      "cwd": "builds/mcp_release",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": true,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/mcp_release/package.json", "builds/mcp_release/package-lock.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "mcp-package-test",
      "argv": ["npm", "test"],
      "cwd": "builds/mcp_release",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/mcp_release"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "mcp-package-build",
      "argv": ["npm", "run", "build"],
      "cwd": "builds/mcp_release",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/mcp_release"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    }
  ]
}
```