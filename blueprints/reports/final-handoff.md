# Final handoff

## Outcome

BrainDrive Live Remote Pilot 2026-08-01 was implemented, documented, and verified locally.

## Run and test

Follow `README.md` for the project run instructions. Re-run the exact registered verification commands in order. First confirm the accepted runtime requirements:

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

# web-npm-ci (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm ci

# web-lint (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm run lint

# web-typecheck (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm run typecheck

# web-test (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm test

# web-build (cwd: builds/typescript/client_web)
cd builds/typescript/client_web
npm run build

# mcp-npm-ci (cwd: builds/mcp_release)
cd builds/mcp_release
npm ci

# mcp-test (cwd: builds/mcp_release)
cd builds/mcp_release
npm test

# mcp-build (cwd: builds/mcp_release)
cd builds/mcp_release
npm run build
```

## Result

- Local result branch: `anvil-pilot/braindrive-anvil-live-remote-pilot-request-add-a-documentation-3811263234`
- Verified code/documentation commit: `7d16df0f7a1f3ddb8a0c33a144f303b47fc8cfcf`
- Published project knowledge: `blueprints/`

## Known limits

No remote publication was performed.
