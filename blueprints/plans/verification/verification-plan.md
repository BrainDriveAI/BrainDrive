## Strategy
Verify only the accepted documentation-only requirement: a new `docs/anvil-pilot-observation.md` note that records the baseline and the exact repository-native checks for runtime, web client, and MCP package. The command manifest intentionally excludes Git writes, repository audits beyond scoped finding paths, runtime servers, watchers, installers, security checks, release actions, and credential access.

Before each project command, require direct `node --version` and `npm --version` probes with PEP 440 constraints Node `>=22,<23` and npm `>=10,<11`. These probes are prerequisites for the Node/npm commands, not proof that the documentation content is correct.

## Requirement Coverage
REQ-001, REQ-002, REQ-006, REQ-007, REQ-008, and REQ-009 are covered by checking the single finding path `docs/anvil-pilot-observation.md` and by requiring review evidence that no other path is intentionally changed.

REQ-003, REQ-004, and REQ-005 are covered by the exact ordered command groups in the manifest: four runtime commands from `builds/typescript`, five web-client commands from `builds/typescript/client_web`, and three MCP commands from `builds/mcp_release`.

REQ-010 and REQ-011 are covered by the structured manifest: exactly 12 required project commands, each bounded to 1,200 seconds, each bound to the Node and npm runtime requirements.

## Evidence
The accepted specification, implementation plan, and milestone prompt pack all name one documentation target, the `dev` baseline commit `ba37f0893fbde331675d8d209fb1abf375e0ecce`, and the exact 12-command verification matrix. No provider text is used as validation authority or workflow authority.

Expected evidence is: the note exists, it states the baseline branch and commit, it lists the three command groups with exact working directories and order, it contains no placeholders or authority claims, and each required command exits successfully after passing the direct version probes.

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
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/package.json"],
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
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/package.json"],
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
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/package.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-npm-ci",
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
      "id": "web-lint",
      "argv": ["npm", "run", "lint"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/client_web/package.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-typecheck",
      "argv": ["npm", "run", "typecheck"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/client_web/package.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-test",
      "argv": ["npm", "test"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/client_web/package.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "web-build",
      "argv": ["npm", "run", "build"],
      "cwd": "builds/typescript/client_web",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/typescript/client_web/package.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "mcp-npm-ci",
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
      "id": "mcp-test",
      "argv": ["npm", "test"],
      "cwd": "builds/mcp_release",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/mcp_release/package.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    },
    {
      "id": "mcp-build",
      "argv": ["npm", "run", "build"],
      "cwd": "builds/mcp_release",
      "timeout_seconds": 1200,
      "max_output_bytes": 2000000,
      "network_required": false,
      "required": true,
      "finding_paths": ["docs/anvil-pilot-observation.md", "builds/mcp_release/package.json"],
      "runtime_requirement_ids": ["node-22", "npm-10"]
    }
  ]
}
```