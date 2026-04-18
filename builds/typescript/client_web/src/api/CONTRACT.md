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
> - `GET /api/export`
> Update routes:
> - `GET /api/updates/status` (public)
> - `GET /api/updates/session` (admin auth required)
> - `POST /api/updates/conversation/start` (admin auth required)
> - `POST /api/updates/code` (admin auth required)
> - `POST /api/updates/restart` (admin auth required)
> Streaming canonical event fields are `text-delta.delta` and `tool-call.input`.

This document describes the current local-mode contract between the V1 interface and the standalone BrainDrive gateway behind the Vite `/api` proxy.

## Base URL

- Development base URL: `/api`
- Vite rewrites `/api/*` to the standalone gateway on `http://127.0.0.1:3000/*`

## Update Files and Runtime State

These files define update state and are consumed by `/api/updates/*` routes:

- `memory/system/version.json`
  - Source of truth for local app version metadata (`version`, `released`, `channel`).
  - Read by `GET /api/updates/status` and `GET /api/config`.
- `memory/system/updates/manifest.md`
  - Cumulative migration manifest shipped with starter-pack updates.
  - Read by `POST /api/updates/conversation/start` and startup migration resume logic.
- `memory/system/updates/applied.json`
  - Tracks applied migration items and run outcomes.
  - Read by update planning; written by migration apply/resume.
- `memory/system/updates/session.json`
  - Durable code-update session contract (phase/status lifecycle).
  - Read by `GET /api/updates/session`; resumed on gateway startup.

## Endpoints

### `GET /api/updates/status`

Returns current update availability status.

Behavior:

- Public route (no auth required).
- `stable` channel compares local `system/version.json` against latest GitHub stable release tag.
- `dev` channel never performs remote checks and always reports `update_available: false`.
- Responses are cached in-memory for 24 hours from the last successful/failed check.

Response example:

```json
{
  "channel": "stable",
  "current_version": "26.4.18",
  "latest_stable_version": "26.4.19",
  "update_available": true,
  "last_checked_at": "2026-04-18T15:00:00.000Z",
  "diagnostic": null
}
```

Possible `diagnostic` values:

- `local_version_metadata_unavailable`
- `local_version_unparseable`
- `remote_fetch_failed`
- `remote_version_unparseable`
- `unsupported_channel`

### `GET /api/updates/session`

Returns durable code-update session state.

Auth:

- Admin auth required.

Response example:

```json
{
  "session": {
    "update_id": "update-a1b2c3",
    "correlation_id": "update-a1b2c3",
    "from_version": "26.4.18",
    "target_version": "26.4.19",
    "phase": "migration_pending",
    "status": "in_progress",
    "started_at": "2026-04-18T12:00:00.000Z",
    "updated_at": "2026-04-18T12:01:00.000Z",
    "last_error": null
  }
}
```

`session` may be `null` when no session file exists.

### `POST /api/updates/conversation/start`

Starts or resumes the BD+1 assistant-first update conversation.

Auth:

- Admin auth required.

Request body:

- Empty JSON object or omitted body.

Response example:

```json
{
  "status": "started",
  "project_id": "braindrive-plus-one",
  "conversation_id": "f39dca8a-2d4d-49ee-958a-72a01fa2e5b2",
  "update_id": "update-faf303dbd7914f67",
  "bootstrap_sent": true
}
```

Response `status` values:

- `started`: new bootstrap conversation created and seeded.
- `resumed`: existing unresolved update conversation reused.
- `completed`: no pending migrations, no bootstrap sent.

Bounded bootstrap context payload:

- Persisted in the seeded system message after marker `[braindrive-update-context:v1]`.
- Schema and limits:
  - `update_id`: string, `1..200` chars
  - `current_version`: string, `1..120` chars
  - `target_version`: string, `1..120` chars
  - `migration_items`: array, max `80` items
  - Per item:
    - `item_id`: string, `1..200` chars
    - `summary`: string, `1..2000` chars
    - `source_file_paths`: array of strings, max `20`, each `1..400` chars
    - `target_file_paths`: array of strings, max `20`, each `1..400` chars

### `POST /api/updates/code`

Starts host-level code update execution.

Auth:

- Admin auth required.

Request body:

```json
{
  "target_version": "26.4.19"
}
```

`target_version` is optional; when omitted, current local version is used as target.

Success response:

- `202 Accepted`

```json
{
  "update_id": "update-a1b2c3",
  "session": {
    "phase": "code_update_complete",
    "status": "in_progress"
  }
}
```

Fallback response when host execution is unavailable:

- `503 Service Unavailable`

```json
{
  "error": "host_execution_unavailable",
  "update_id": "update-a1b2c3",
  "command": "./installer/docker/scripts/upgrade.sh local",
  "detail": "Host-level upgrade execution is unavailable in this runtime. Run the fallback command on the host.",
  "session": {
    "phase": "host_execution_unavailable",
    "status": "failed"
  }
}
```

Conflict response when another non-terminal update session is active:

- `409 Conflict`
```json
{
  "error": "update_session_active",
  "update_id": "active-update-123",
  "session": {
    "phase": "code_update_complete",
    "status": "in_progress"
  }
}
```

### `POST /api/updates/restart`

Requests container restart for the active update session.

Auth:

- Admin auth required.

Request body:

```json
{
  "update_id": "update-a1b2c3"
}
```

`update_id` is optional; when provided, it must match the active non-terminal session.

Responses:

- `202 Accepted` on restart dispatch.
- `503 Service Unavailable` with canonical fallback `command` when host execution is unavailable.
- `409 Conflict` with:
  - `error: "no_active_update_session"` or
  - `error: "update_session_mismatch"`

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
