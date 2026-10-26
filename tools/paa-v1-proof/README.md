# PAA v1 product runtime probe

This probe exercises a running BrainDrive Gateway against selected PAA v1
acceptance criteria. It records passes and failures separately. A controlled
OpenAI-compatible provider gives deterministic responses; it does not prove a
live third-party provider, a local model, or full PAA conformance.

Use a task-owned memory root and secrets home. Start the two controlled providers:

```bash
PAA_PROOF_PROVIDER_LOG=/tmp/paa-v1-proof/provider-requests.jsonl \
  node tools/paa-v1-proof/controlled-provider.mjs
```

In another shell, after installing the TypeScript and MCP release dependencies:

```bash
cd builds/typescript
PAA_MEMORY_ROOT=/tmp/paa-v1-proof/memory \
PAA_SECRETS_HOME=/tmp/paa-v1-proof/secrets \
BRAINDRIVE_PORT=8799 \
OPENROUTER_BASE_URL=http://127.0.0.1:8801/v1 \
OLLAMA_BASE_URL=http://127.0.0.1:8802/v1 \
npm run dev:server
```

Create a local test account in that isolated Gateway, then put its bearer token
in a mode-0600 JSON file as `{"token":"..."}`. Do not commit the token or the
provider request log. Run from the repository root:

```bash
PAA_PROOF_AUTH_FILE=/path/to/protected-auth.json \
PAA_PROOF_CANDIDATE_SHA="$(git rev-parse HEAD)" \
node tools/paa-v1-proof/probe.mjs
```

The process exits nonzero when a check fails. Current PAA Gateway contract
checks are expected to fail on the existing BrainDrive API; the result is a
measured gap, not an accepted exception.

For a separate tool-source refresh check, start a second Gateway on port 8800
with `MCP_SERVERS_FILE` pointing to a task-owned JSON file initially containing
`{"servers":[]}`. Keep the three first-party MCP processes running. After
signing up to that isolated Gateway and storing its token in a protected auth
file, run:

```bash
PAA_PROOF_GATEWAY_URL=http://127.0.0.1:8800 \
PAA_PROOF_AUTH_FILE=/path/to/protected-auth.json \
PAA_PROOF_SOURCE_FILE=/path/to/task-owned-sources.json \
PAA_PROOF_PROVIDER_LOG=/path/to/provider-requests.jsonl \
node tools/paa-v1-proof/refresh-probe.mjs
```

This checks tool addition, execution and removal without a Gateway restart.
The source file is overwritten, so use only a task-owned fixture.
