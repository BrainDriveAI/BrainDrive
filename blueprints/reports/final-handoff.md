# Blueprint handoff

## Outcome

BrainDrive Anvil Fresh Blueprint Pilot was implemented and verified before this portable Blueprint snapshot was published.

## Run and test

No independently verified run command was registered for this change. Re-run only the exact registered verification commands below, in order. First confirm the accepted runtime requirements:

- `node-22`: `node --version` must satisfy `>=22,<23`
- `npm-10`: `npm --version` must satisfy `>=10,<11`

Then run:

```console
# runtime-npm-ci (cwd: builds/typescript)
cd builds/typescript
npm ci

# runtime-lint (cwd: builds/typescript)
cd builds/typescript
npm run lint

# runtime-test (cwd: builds/typescript)
cd builds/typescript
npm test

# runtime-build (cwd: builds/typescript)
cd builds/typescript
npm run build

# web-client-npm-ci (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm ci

# web-client-lint (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm run lint

# web-client-typecheck (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm run typecheck

# web-client-test (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm test

# web-client-build (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm run build

# mcp-package-npm-ci (cwd: builds/mcp_release)
cd builds/mcp_release
npm ci

# mcp-package-test (cwd: builds/mcp_release)
cd builds/mcp_release
npm test

# mcp-package-build (cwd: builds/mcp_release)
cd builds/mcp_release
npm run build
```

## Result

- Anvil result branch: `anvil-pilot/braindrive-anvil-fresh-pilot-request-add-a-documentation-only-p-3911e97235`
- Verified pre-Blueprint input commit: `c401669982d852dce4dc3b6187c7625990c96088`
- Published project knowledge: `blueprints/`

## Known limits

This immutable snapshot is created before the Blueprint commit can be assigned. Remote delivery occurs only after final verification, so this file does not assert the final combined commit or the current remote delivery outcome. Use `anvil handoff` for that authoritative operational result.
