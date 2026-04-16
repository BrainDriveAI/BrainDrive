# Gateway Contract

> Status (2026-03-23): This file contains legacy examples from the original test-team client.
> C1 runtime now uses canonical Gateway contract routes:
> - `POST /api/message` (with optional `X-Conversation-ID`)
> - `GET /api/conversations`
> - `GET /api/conversations/:id`
> - `POST /api/approvals/:requestId`
> Project/document routes remain under `/api/projects/*`.
> Settings and ownership routes:
> - `GET /api/settings`
> - `GET /api/settings/models?provider_profile=<id>`
> - `PUT /api/settings`
> - `GET /api/settings/onboarding-status`
> - `PUT /api/settings/credentials`
> - `PUT /api/settings/twilio-sms`
> - `POST /api/settings/twilio-sms/test-send`
> Twilio ingress (external, no `/api` prefix):
> - `POST /twilio/sms/webhook` (public Twilio webhook route; signature-validated)
> - Twilio webhook intake now reuses the same canonical Gateway message-processing path as `POST /api/message`.
> - Auto-reply uses the shared Gateway processing flow, applies per-sender sequential processing, and enforces per-sender round-trip rate limits with one cap notice SMS per active window.
> - `GET /api/export`
> Streaming canonical event fields are `text-delta.delta` and `tool-call.input`.

This document describes the current local-mode contract between the V1 interface and the standalone BrainDrive gateway behind the Vite `/api` proxy.

## Base URL

- Development base URL: `/api`
- Vite rewrites `/api/*` to the standalone gateway on `http://127.0.0.1:3000/*`

## Endpoints

### `POST /api/conversations/messages`

Creates a new in-memory conversation and streams assistant events.

Request body:

```json
{
  "message": {
    "role": "user",
    "content": "Help me plan next week"
  },
  "metadata": {
    "project": "finance"
  }
}
```

Notes:

- `metadata` is optional
- if `metadata.project` is a string, the gateway stores it on the created conversation as `project`

Response:

- `200 OK`
- `Content-Type: text/event-stream`

### `POST /api/conversations/:id/messages`

Appends a user message to an existing conversation and streams assistant events.

Request body:

```json
{
  "message": {
    "role": "user",
    "content": "Revise the plan"
  },
  "metadata": {
    "project": "finance"
  }
}
```

Notes:

- `metadata` is optional
- if `metadata.project` is a string, the gateway stores it on the conversation as `project`

Response:

- `200 OK`
- `Content-Type: text/event-stream`

404 response:

```json
{
  "code": "not_found",
  "message": "Conversation not found: abc123"
}
```

### `GET /api/conversations`

Lists conversation summaries.

Response example:

```json
[
  {
    "id": "abc123",
    "created_at": "2026-03-18T21:00:00.000Z",
    "updated_at": "2026-03-18T21:05:00.000Z",
    "message_count": 4,
    "project": "finance"
  }
]
```

### `GET /api/conversations/:id`

Returns a single conversation with all stored messages.

Response example:

```json
{
  "id": "abc123",
  "created_at": "2026-03-18T21:00:00.000Z",
  "updated_at": "2026-03-18T21:05:00.000Z",
  "project": "finance",
  "messages": [
    {
      "role": "user",
      "content": "Help me plan next week"
    },
    {
      "role": "assistant",
      "content": "Let's break the week into three priorities."
    }
  ]
}
```

404 response:

```json
{
  "code": "not_found",
  "message": "Conversation not found: abc123"
}
```

### `DELETE /api/conversations/:id`

Deletes an in-memory conversation.

Response:

- `204 No Content`

404 response:

```json
{
  "error": "Conversation not found"
}
```

### `GET /api/projects`

Lists the hardcoded project navigation entries and links each one to the first matching in-memory conversation whose `project` field matches the project `id`.

Response example:

```json
[
  {
    "id": "getting-started",
    "name": "Getting Started",
    "icon": "rocket",
    "conversation_id": null
  },
  {
    "id": "finance",
    "name": "Finance",
    "icon": "dollar-sign",
    "conversation_id": "abc123"
  }
]
```

### `GET /api/projects/:id/files`

Returns the hardcoded file list for a known project.

Response example for `/api/projects/finance/files`:

```json
[
  {
    "name": "spec.md",
    "path": "finance/spec.md"
  },
  {
    "name": "budget.md",
    "path": "finance/budget.md"
  }
]
```

404 response:

```json
{
  "error": "Project not found"
}
```

### `GET /api/projects/:id/file-content?path=<relative-path>`

Reads a file from the library root after validating that the requested path is relative and stays inside `LIBRARY_PATH`.

Response example for `/api/projects/finance/file-content?path=finance/spec.md`:

```json
{
  "content": "# Finance\n\n## Goals\n- Build 6-month emergency fund\n..."
}
```

400 response:

```json
{
  "error": "Invalid path"
}
```

404 response:

```json
{
  "error": "File not found"
}
```

### `PUT /api/projects/:id/file-content?path=<relative-path>`

Writes a file into the library root after validating that the requested path is relative and stays inside `LIBRARY_PATH`. Parent directories are created automatically when missing.

Request body:

```json
{
  "content": "# Updated file contents"
}
```

Response:

```json
{
  "ok": true
}
```

400 response:

```json
{
  "error": "Invalid path"
}
```

```json
{
  "error": "content must be a string"
}
```

## SSE Events

The gateway uses standard server-sent events:

```text
event: <name>
data: <json>

```

The `event` value matches the JSON `type` field.

### `text-delta`

```json
{
  "type": "text-delta",
  "content": "Let's"
}
```

### `tool-call`

```json
{
  "type": "tool-call",
  "id": "tool_1",
  "name": "memory_write",
  "arguments": {
    "path": "plans/week.md",
    "content": "..."
  }
}
```

### `tool-result`

```json
{
  "type": "tool-result",
  "id": "tool_1",
  "output": "{\"success\":true}"
}
```

Errorful tool results may instead include `error`.

### `error`

```json
{
  "type": "error",
  "code": "provider_error",
  "message": "Model unavailable"
}
```

### `done`

```json
{
  "type": "done",
  "finish_reason": "stop",
  "conversation_id": "abc123",
  "usage": {
    "prompt_tokens": 123,
    "completion_tokens": 45
  }
}
```

## Known Gaps

- No pagination on `GET /conversations`
- No message IDs in stored conversation payloads
- No thread title field in gateway responses
- Conversation persistence is in-memory only
- 404 response shapes are not fully uniform across routes

## Adapter Notes

The files in `client/src/api/` normalize the current gateway behavior for the UI:

- `/api` is the only client-facing base URL
- non-streaming 404s become typed `GatewayNotFoundError` instances
- SSE payloads are parsed into typed chat events
- the custom chat hook hides the gateway's low-level streaming details from components
