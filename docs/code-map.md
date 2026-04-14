# Code Map: BrainDrive → Personal AI Architecture

How the BrainDrive codebase maps to the [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture) components. Use this to find where things live when working on a specific part of the system.

All paths are relative to `builds/typescript/` unless noted otherwise.

---

## Your Memory

> The platform layer. Everything depends on memory; memory depends on nothing.

**PAA spec:** [memory-spec.md](https://github.com/Personal-AI-Architecture/the-architecture/blob/main/docs/memory-spec.md)

| File | Purpose |
|------|---------|
| `memory/init.ts` | Memory layout initialization, starter pack seeding |
| `memory/paths.ts` | Path resolution utilities |
| `memory/conversation-store-markdown.ts` | Conversation persistence (markdown files + SQLite index) |
| `memory/conversation-repository.ts` | Repository interface for conversation storage |
| `memory/auth-state.ts` | Auth state stored within memory |
| `memory/skills.ts` | Skill discovery from memory files |
| `memory/history.ts` | Conversation history access |
| `memory/export.ts` | Data portability (export memory) |
| `memory/backup.ts` | Memory backup orchestration |
| `memory/backup-git.ts` | Git-based backup to remote repo |
| `memory/backup-restore.ts` | Restore memory from backup |
| `memory/migration.ts` | Memory format migrations |
| `memory/starter-pack/` | Pre-loaded content: project templates, skills, preferences |

**Data layout** (inside Docker volume):
```
your-memory/
├── AGENT.md                    # Root system prompt
├── me/profile.md               # Owner profile (built through conversations)
├── conversations/              # Markdown conversation files + index
├── documents/projects.json     # Project manifest
├── preferences/                # User preferences (default model, approval mode)
├── skills/                     # Active skill definitions
└── exports/                    # Exported data
```

---

## Gateway

> HTTP API layer. Routes requests, manages resources. Content-agnostic — doesn't interpret message semantics.

**PAA spec:** [gateway-spec.md](https://github.com/Personal-AI-Architecture/the-architecture/blob/main/docs/gateway-spec.md)

| File | Purpose |
|------|---------|
| `gateway/server.ts` | Fastify server — all routes, middleware, service initialization |
| `gateway/conversations.ts` | Conversation CRUD service |
| `gateway/projects.ts` | Project manifest management |
| `gateway/skills.ts` | Skill discovery, binding, composition into prompts |
| `gateway/memory-backup-scheduler.ts` | Scheduled memory backup coordination |

**Key routes:**
| Route | What it does |
|-------|-------------|
| `POST /api/conversations/:id/messages` | Send message → streams Agent Loop events via SSE |
| `GET /api/conversations` | List conversations |
| `POST /api/projects` | Create project |
| `GET /api/gateway/settings` | Read settings (model, provider, preferences) |
| `PUT /api/gateway/settings` | Update settings |
| `POST /api/gateway/auth/signup` | Create account |
| `POST /api/gateway/auth/signin` | Sign in |
| `/health` | Health check |

---

## Agent Loop

> The AI reasoning cycle. Generic — no product logic, no BrainDrive-specific behavior.

**PAA spec:** [engine-spec.md](https://github.com/Personal-AI-Architecture/the-architecture/blob/main/docs/engine-spec.md)

| File | Purpose |
|------|---------|
| `engine/loop.ts` | Core `runAgentLoop` async generator: message → model → tools → repeat |
| `engine/tool-executor.ts` | Tool execution with auth context and permission checks |
| `engine/approval-store.ts` | Tool execution approval workflow (ask-on-write mode) |
| `engine/errors.ts` | Provider error classification (context overflow, rate limits, etc.) |
| `engine/stream.ts` | SSE event formatting for streaming responses |

**The loop:** Receives a message, calls the model, checks if the response includes tool calls. If yes, executes tools and feeds results back to the model. Repeats until the model produces a final text response (no more tool calls). Streams everything as SSE events.

---

## Auth

> Identity and access control. Validates every request, authorizes every tool call.

**PAA spec:** [auth-spec.md](https://github.com/Personal-AI-Architecture/the-architecture/blob/main/docs/auth-spec.md)

| File | Purpose |
|------|---------|
| `auth/local-jwt-auth.ts` | Account store, JWT generation, refresh token rotation |
| `auth/middleware.ts` | Request authentication middleware |
| `auth/authorize.ts` | Permission checking against actor policy |
| `auth/jwt.ts` | Token lifecycle (sign, verify, refresh) |
| `auth/headers.ts` | HTTP auth header parsing |
| `auth/signup-bootstrap.ts` | First-account bootstrap security (token or loopback) |
| `auth/account-store.ts` | File-based account persistence |
| `auth/session-store.ts` | Session tracking |
| `auth/password.ts` | Bcrypt password hashing and verification |

**Auth modes:** `local` (owner-only with JWT), `local-owner` (simplified), `managed` (multi-tenant, future).

---

## Model Adapters

> Provider abstraction. Swap models by changing config, not code.

**PAA spec:** [adapter-spec.md](https://github.com/Personal-AI-Architecture/the-architecture/blob/main/docs/adapter-spec.md)

| File | Purpose |
|------|---------|
| `adapters/base.ts` | `ModelAdapter` interface — `complete()` and `completeStream()` |
| `adapters/index.ts` | Factory: creates adapter based on `provider_adapter` config |
| `adapters/openai-compatible.ts` | OpenAI-compatible API adapter (OpenRouter, Ollama, Anthropic, etc.) |
| `adapters/gateway-openai-compatible.ts` | Gateway-level adapter setup |
| `adapters/openai-compatible.json` | Adapter config schema |

**Adding a new provider:** Implement `ModelAdapter` interface from `base.ts`, register in the factory in `index.ts`. The OpenAI-compatible adapter already covers most providers.

---

## Tools

> Model-driven capabilities. The AI decides what tools to use; Auth controls what's allowed.

**PAA spec:** [tools-spec.md](https://github.com/Personal-AI-Architecture/the-architecture/blob/main/docs/tools-spec.md)

| File | Purpose |
|------|---------|
| `tools.ts` | Tool discovery and registration (MCP, built-in, auth, memory, project) |
| `mcp/client.ts` | MCP server connection, tool listing, tool calling |
| `mcp/registry.ts` | Tool discovery from MCP servers |
| `mcp/config.ts` | MCP server configuration loading |
| `memory-tools/file-ops/server.ts` | File operation tools (read, write, list, delete, search, edit) |
| `tools/project-tools.ts` | Project management tools |

**First-party MCP servers** (in `builds/mcp_release/`):
| Server | Port | Tools |
|--------|------|-------|
| mcp-memory | 8911 | Read, write, edit, delete, search, list, history, export |
| mcp-auth | 8912 | Whoami, check permissions, export auth state |
| mcp-project | 8913 | List projects |

**Tool call flow:** Model response includes tool calls → Agent Loop extracts them → Auth checks permissions → Tool executor runs them (MCP call or built-in) → Results fed back to model.

---

## Secrets

> Encrypted credential management. Not a PAA component — BrainDrive-specific.

| File | Purpose |
|------|---------|
| `secrets/vault.ts` | AES-256-GCM encryption/decryption |
| `secrets/key-provider.ts` | Master key initialization and loading |
| `secrets/crypto.ts` | Encryption primitives |
| `secrets/resolver.ts` | Secret resolution at startup |
| `secrets/paths.ts` | Secret file paths |
| `secrets/cli.ts` | CLI for managing secrets |

---

## Web Client

> React SPA — the primary user interface.

| File | Purpose |
|------|---------|
| `client_web/src/App.tsx` | Root component (deployment detection → auth flow → main interface) |
| `client_web/src/components/layout/AppShell.tsx` | Main layout (sidebar + chat panel) |
| `client_web/src/components/layout/Sidebar.tsx` | Project navigation sidebar |
| `client_web/src/components/chat/ChatPanel.tsx` | Chat interface (messages, composer, approvals) |
| `client_web/src/components/chat/EmptyState.tsx` | Landing state for new conversations |
| `client_web/src/components/settings/SettingsModal.tsx` | Settings (model, provider, backup, credits) |
| `client_web/src/components/auth/AuthFlow.tsx` | Login/signup flow |
| `client_web/src/api/gateway-adapter.ts` | API client for Gateway |
| `client_web/src/api/auth-adapter.ts` | Auth API client |
| `client_web/src/hooks/useProjects.ts` | Project state management |
| `client_web/src/api/useGatewayChat.ts` | Chat state + SSE streaming |

---

## Configuration

> How settings flow through the system.

| File | Purpose |
|------|---------|
| `config.ts` | Config loading, Zod validation schemas, defaults |
| `config.json` | Runtime config (memory root, adapter, auth mode, tool sources) |
| `installer/docker/.env.example` | Environment variable template |
| `mcp/servers.full-mcp.json` | MCP server definitions (loaded at startup) |

**Config precedence:** Environment variables → `.env` file → `config.json` → defaults in `config.ts`.

---

## Request Flow (end to end)

```
User types message in web UI
  → client_web/src/api/useGatewayChat.ts   POST /api/conversations/:id/messages
  → gateway/server.ts                       Auth middleware → load context → call Agent Loop
  → engine/loop.ts                          Send to model via adapter
  → adapters/openai-compatible.ts           Stream completion from provider
  → engine/loop.ts                          Model returns tool calls?
    → Yes: engine/tool-executor.ts          Execute tools (MCP or built-in)
           → auth/authorize.ts              Check permissions
           → mcp/client.ts                  Call MCP server
           → engine/loop.ts                 Feed results back to model, repeat
    → No:  Stream final text to client
  → memory/conversation-store-markdown.ts   Save conversation
  → client_web/src/components/chat/ChatPanel.tsx   Render response
```
