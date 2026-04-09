# Development Guide

How to set up BrainDrive for local development — building from source with hot reload.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose on Linux)
- [Node.js 22+](https://nodejs.org/) (for running tests outside Docker)
- Git

## Dev Mode Setup

Dev mode builds from source and watches for changes (hot reload via `tsx watch` for the server, Vite HMR for the web client).

```bash
# Clone and enter the repo
git clone https://github.com/BrainDriveAI/BrainDrive.git
cd BrainDrive/installer/docker

# First-time install — creates .env, generates secrets, builds and starts everything
./scripts/install.sh dev
```

This starts two containers:

| Service | What it does | Port |
|---------|-------------|------|
| **app** | Gateway + Agent Loop + MCP servers, hot-reloading via `tsx watch` | 8787 (internal) |
| **web** | React SPA via Vite dev server with HMR | [127.0.0.1:5073](http://127.0.0.1:5073) |

Source directories are mounted into the containers, so edits to files under `builds/typescript/` are picked up automatically.

## After First Install

```bash
# Start (after stopping)
./scripts/start.sh dev

# Stop
./scripts/stop.sh dev

# Rebuild after dependency changes
docker compose -f compose.dev.yml up -d --build
```

## Install Modes

| Mode | Command | Use case |
|------|---------|----------|
| `dev` | `./scripts/install.sh dev` | Development — source-mounted, hot reload, Vite HMR |
| `local` | `./scripts/install.sh local` | Local build — builds images from source, no hot reload |
| `quickstart` | `./scripts/install.sh quickstart` | End-user install — pulls published images, no source needed |
| `prod` | `./scripts/install.sh prod` | Production — published images, TLS via Caddy, custom domain |

## Running Tests

Tests run outside Docker against the source directly:

```bash
# Server tests (gateway, auth, engine, memory)
cd builds/typescript && npm test

# MCP server tests
cd builds/mcp_release && npm test

# Web client tests
cd builds/typescript/client_web && npm test

# E2E tests (Playwright — requires running dev stack)
cd builds/typescript/client_web && npx playwright test
```

## Project Structure

```
BrainDrive/
├── builds/
│   ├── typescript/              # Main application
│   │   ├── gateway/             # HTTP API (Fastify server)
│   │   ├── engine/              # Agent Loop (AI reasoning cycle)
│   │   ├── auth/                # Authentication (JWT, accounts, permissions)
│   │   ├── adapters/            # Model provider abstraction (OpenAI-compatible)
│   │   ├── memory/              # Your Memory (file-based knowledge store)
│   │   ├── mcp/                 # MCP client (tool server connections)
│   │   ├── secrets/             # Encrypted credential vault
│   │   ├── tools/               # Native tools (project management)
│   │   ├── memory-tools/        # File operation tools
│   │   ├── client/              # CLI REPL client
│   │   ├── client_web/          # React SPA (web interface)
│   │   ├── config.ts            # Configuration loading + validation
│   │   ├── contracts.ts         # Shared type definitions
│   │   ├── main.ts              # Entry point
│   │   └── docker-compose.yml   # Legacy compose (use installer/ instead)
│   └── mcp_release/             # First-party MCP servers (memory, auth, project)
├── installer/
│   ├── docker/                  # Docker configs, Dockerfiles, Caddy
│   │   ├── compose.dev.yml      # Dev stack (hot reload)
│   │   ├── compose.local.yml    # Local build stack
│   │   ├── compose.quickstart.yml # Published images
│   │   ├── compose.prod.yml     # Production with TLS
│   │   ├── scripts/             # Lifecycle scripts (install, start, stop, upgrade, backup, restore)
│   │   └── .env.example         # Environment variable template
│   └── bootstrap/               # One-line install scripts (curl | bash)
├── docs/                        # Documentation
├── CONTRIBUTING.md              # Contribution guide
├── ROADMAP.md                   # Product roadmap
└── README.md                    # Project overview
```

## Key Entry Points

| What | File | Why you'd read it |
|------|------|-------------------|
| Server startup | `builds/typescript/gateway/server.ts` | All routes, middleware, and service initialization |
| Agent Loop | `builds/typescript/engine/loop.ts` | The core AI reasoning cycle: message → model → tools → repeat |
| Config schema | `builds/typescript/config.ts` | What's configurable and how it's validated |
| Type definitions | `builds/typescript/contracts.ts` | Shared types across all components |
| Web app root | `builds/typescript/client_web/src/App.tsx` | Auth flow → main interface |
| Memory init | `builds/typescript/memory/init.ts` | How memory layout and starter pack are seeded |
| Tool discovery | `builds/typescript/tools.ts` | How tools are registered (MCP, built-in, auth, memory, project) |

## Environment Variables

Key variables in `.env` (created from `.env.example` by `install.sh`):

| Variable | Purpose |
|----------|---------|
| `PAA_SECRETS_MASTER_KEY_B64` | Encryption key for the credential vault |
| `PAA_MEMORY_ROOT` | Memory storage path (default: Docker volume) |
| `PAA_AUTH_BOOTSTRAP_TOKEN` | First-account signup security token |
| `BRAINDRIVE_DEV_BIND_HOST` | Dev server bind address (default: 127.0.0.1) |
| `BRAINDRIVE_DEV_PORT` | Dev web client port (default: 5073) |

See `.env.example` for the full list with descriptions.

## Adding a New Tool

BrainDrive discovers tools from MCP servers defined in `builds/typescript/mcp/servers.full-mcp.json`. To add a tool:

1. Create an MCP server (see `builds/mcp_release/` for examples)
2. Add the server definition to `mcp/servers.full-mcp.json`
3. The Agent Loop will discover and use the tool automatically

Built-in tools are registered directly in `builds/typescript/tools.ts`.

## Architecture Reference

BrainDrive implements the [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture). See [ARCHITECTURE.md](ARCHITECTURE.md) for how the codebase maps to the architecture, or read the [PAA foundation spec](https://github.com/Personal-AI-Architecture/the-architecture/blob/main/docs/foundation-spec.md) for the full design.
