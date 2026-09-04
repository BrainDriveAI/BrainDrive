# Request, stream, tool, and persistence flows

**Status:** Current description of observed repository behavior; not a public API compatibility promise.  
**Parent:** [Architecture overview](README.md)  
**Related:** [Gateway integration](../integrations/gateway.md), [MCP and tools](../integrations/mcp-and-tools.md), [Modes, data, and trust](modes-data-and-trust.md)

BrainDrive does not have one universal request flow. The route, authentication mode, selected provider profile, tool availability, and client-side commands determine which participants run and which state changes.

## Trace A — web message through gateway, engine, tool, and persistence

### Participants

1. `useGatewayChat.ts` owns the web conversation state and consumes typed stream events.
2. `gateway-adapter.ts` sends `POST /api/message`; `runtime-api-base.ts` keeps `/api` in a browser or resolves the native Tauri gateway and desktop token.
3. Vite or the deployment proxy forwards browser `/api`; the Tauri client calls its embedded loopback gateway directly.
4. `gateway/server.ts` applies transport authorization when configured, then request authentication, validates the request, persists the user message, assembles the prompt, and opens the SSE response. It then resolves the request-time effective provider configuration/credential inside the stream try block, so those failures can be returned as SSE errors.
5. `runAgentLoop` calls the selected model adapter, exposes only tools allowed by the request auth context, and emits model/tool/approval events.
6. `ToolExecutor` invokes an in-process or configured MCP-backed tool. MCP clients use Streamable HTTP and forward the derived request context to a declared server.
7. The gateway records tool messages and assistant text in the conversation repository and formats client SSE events.

### Non-participants

- The web client does not call a model provider directly and does not read the secret vault.
- The model provider does not authorize tools or write BrainDrive memory by itself.
- MCP services do not select provider profiles or manage browser authentication.
- Memory backup and migration do not run merely because a message is streamed. The `after_changes` backup scheduler polls/debounces dirty Git status; it is not a callback that proves a completed mutation, and tool mutations that commit immediately may leave no dirty state for that trigger.

### Events and decisions

- `POST /message` becomes browser route `POST /api/message` through the client base.
- The response uses `text/event-stream`. Events include `text-delta`, `tool-call`, `tool-result`, `approval-request`, `approval-result`, `error`, and `done`.
- A tool marked `requiresApproval` waits unless preferences select `auto-approve`. The current web hook submits an approved decision when it receives `approval-request`; there is no human confirmation step on that client path. This is client behavior, not permission bypass. The gateway still requires approval authority on `POST /approvals/:requestId`.
- Repeat-call, safety-iteration, unavailable-tool, and permission guards can return error tool results without executing the requested mutation. A project-memory guard is passed into the loop, but `createBrainDriveMemorySafetyGuard` currently returns no restriction; do not present project chat metadata as enforced tool-path isolation.
- The loop passes the request abort signal to model adapters and returns without emitting a synthetic error if the request is already cancelled or becomes cancelled while streaming. Recoverable invalid-input tool failures are fed back to the model, but three consecutive schema/invalid-input failures end the turn with a plain-language `text-delta` and `done` event whose finish reason is `tool_input_invalid`.

### Trust boundary

The browser/Tauri-to-gateway hop is an authentication boundary. The gateway derives `request.authContext`; it does not accept model output as authority. Tool discovery classifies configured sources, and each tool is filtered by permissions before listing or execution. A desktop transport token authorizes the loopback transport, while the gateway auth middleware still constructs the trusted local auth context from initialized auth state.

### Persistence

- User, assistant, and tool messages are written through `GatewayConversationService` and the configured markdown conversation repository.
- Project association, prompt-audit artifacts, context-window summaries, and audit logs can write under the configured memory root when their features are active.
- Memory tools may write/delete owner memory and create Git commits. Their declarations and auth context determine approval and permission behavior.
- Provider credentials are resolved from environment references or the encrypted vault and are passed to the adapter in memory; they are not conversation content.

## Trace B — public `/config` mode discovery bypasses auth and the engine

### Participants

`config-adapter.ts` calls `/api/config` through `runtime-api-base.ts`. A browser keeps the relative `/api` path for its proxy; Tauri resolves the embedded gateway URL and may add its desktop token. The gateway public `GET /config` route reports deployment mode, gateway URL, install mode/location, version, and feature flags. The web adapter supplies its own billing URL fallback; the gateway response does not currently include `billing_url`.

### Non-participants

Request auth middleware, `POST /message`, `runAgentLoop`, the model adapter, provider credential resolution, conversations, approvals, and tools do not participate. No SSE stream opens and no owner state is written.

### Events, trust, and persistence

The route is explicitly exempt from transport-token and request-auth checks so a client can discover how to authenticate. It returns process/config-derived metadata and has no persistence. The web adapter retries failures and eventually defaults its client view to local mode; that fallback is degraded client behavior, not evidence that the server is local or healthy.

The independent deployment, install, auth, client-transport, and packaging dimensions are compared in the full [mode matrix](modes-data-and-trust.md); this bypass does not collapse them into one “mode.”

## Trace C — `/skills` command bypasses the chat/model path only

`useGatewayChat.ts` recognizes the exact `/skills` command, calls authenticated `GET /skills`, and updates local messages/loading/tool status. Gateway transport and request auth still apply, but `POST /message`, provider resolution, engine, tools, SSE, and conversation persistence do not. “Bypass” here does not mean authorization bypass.

### Source evidence

- Web request/stream handling: `builds/typescript/client_web/src/api/useGatewayChat.ts`, `gateway-adapter.ts`, `runtime-api-base.ts`, and their tests.
- Gateway assembly and persistence: `builds/typescript/gateway/server.ts`, `conversations.ts`, `context-window.ts`, and gateway tests.
- Engine and approvals: `builds/typescript/engine/loop.ts`, `tool-executor.ts`, `approval-store.ts`, plus `loop.test.ts`.
- Tool/MCP discovery: `builds/typescript/tools.ts`, `mcp/config.ts`, `mcp/client.ts`, and `mcp/registry.ts`.

### Focused checks

From `builds/typescript`: `npm test`, `npm run build`, `npm run web:typecheck`, and `npm run web:test`. From `builds/mcp_release`: `npm test` and `npm run build` when MCP/tool claims change.
