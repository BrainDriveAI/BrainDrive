# BrainDrive Architecture

A 5-minute overview of how BrainDrive is built — for developers who want to understand the system before diving into code.

## The Big Idea

BrainDrive is built on the [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture) (PAA) — an open standard for user-owned AI systems. PAA defines *what* the components are and how they interact. BrainDrive is one implementation of that standard.

The core design principle: **everything the AI knows about you lives on your machine, in plain files, under your control.** No cloud dependency, no vendor lock-in, no data you can't move.

## Components

```
┌─────────────────────────────────────────────────────────────┐
│  Clients (Web UI, CLI, SMS, future: mobile, voice)          │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼──────────────────────────────────────┐
│  Gateway                                                     │
│  Routes requests, manages conversations/projects/settings    │
│  Knows nothing about AI — just HTTP plumbing                 │
├──────────────────────┬──────────────────────────────────────┤
│  Auth                │  Validates every request              │
│  JWT, accounts,      │  Controls who can do what             │
│  permissions         │  Sits between Gateway and everything  │
└──────────────────────┘  else                                 │
┌──────────────────────▼──────────────────────────────────────┐
│  Agent Loop                                                  │
│  The AI reasoning cycle:                                     │
│    message → model completion → tool calls → repeat          │
│  Generic — no product logic, no BrainDrive-specific behavior │
└──────────┬───────────────────────────────┬──────────────────┘
           │                               │
┌──────────▼──────────┐    ┌───────────────▼──────────────────┐
│  Model Adapters     │    │  Tools (MCP + built-in)           │
│  OpenAI-compatible  │    │  File ops, memory, auth, project  │
│  API adapter        │    │  management, external services     │
│  (OpenRouter,       │    │                                    │
│   Ollama, Anthropic,│    │  Tool calls are model-driven:     │
│   any provider)     │    │  the AI decides what to use        │
└─────────────────────┘    └───────────────┬──────────────────┘
                                           │
┌──────────────────────────────────────────▼──────────────────┐
│  Your Memory                                                 │
│  Plain markdown files + SQLite conversation index            │
│  Conversations, projects, specs, plans, skills, preferences  │
│  Stored in a Docker volume — portable, exportable, yours     │
└─────────────────────────────────────────────────────────────┘
```

## How a Conversation Works

1. **User sends a message** → Web client POSTs to Gateway
2. **Gateway authenticates** → Auth middleware validates JWT
3. **Gateway loads context** → Reads system prompt from memory (AGENT.md + active skills), loads conversation history
4. **Gateway calls Agent Loop** → Passes message + context + available tools
5. **Agent Loop calls model** → Sends to configured provider via adapter (streaming SSE)
6. **Model responds** → Either text (streamed to user) or tool calls
7. **Tool calls execute** → Agent Loop runs tools (file reads/writes, MCP calls), feeds results back to model
8. **Loop repeats** → Until the model is done (no more tool calls)
9. **Conversation saved** → Messages persisted as markdown in Your Memory

## Key Design Decisions

**Memory is plain files.** Conversations are markdown. Projects are folders with AGENT.md, spec.md, plan.md. Preferences are JSON. No database required — everything is readable, greppable, and portable.

**Models are swappable.** A single adapter interface (`ModelAdapter`) abstracts all providers. Switch from OpenRouter to Ollama to a direct API by changing a config value. No code changes.

**Tools use MCP.** The [Model Context Protocol](https://modelcontextprotocol.io/) is the default tool interface. First-party tools (memory, auth, project) run as MCP servers. External tools plug in the same way.

**The Agent Loop is generic.** It knows how to call models and execute tools. It doesn't know what BrainDrive is, what a "project" means, or what coaching methodology to use. All product behavior comes from the system prompt (loaded from memory) and the tools available.

**Auth controls everything.** Every request goes through Auth. Every tool call is authorized. The permission model controls what the AI can read, write, and execute on behalf of the user.

## Runtime Architecture

BrainDrive runs as two Docker containers:

| Container | What's inside |
|-----------|--------------|
| **app** | Gateway (Fastify) + Agent Loop + MCP servers + tool runtime |
| **edge** | Web client (React SPA) + Caddy reverse proxy |

Your Memory and encrypted secrets are stored in Docker volumes.

## Where to Go Next

| I want to... | Read this |
|--------------|-----------|
| Set up a dev environment | [DEVELOPMENT.md](DEVELOPMENT.md) |
| See which code implements which component | [docs/code-map.md](docs/code-map.md) |
| Read the full architecture spec | [PAA Foundation Spec](https://github.com/Personal-AI-Architecture/the-architecture/blob/main/docs/foundation-spec.md) |
| Build with AI assistance | [Architecture Primer](https://github.com/Personal-AI-Architecture/the-architecture/tree/main/docs/ai) — hand these files to your AI agent |
| Contribute code | [CONTRIBUTING.md](CONTRIBUTING.md) |
