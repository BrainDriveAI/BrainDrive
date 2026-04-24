# BrainDrive

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

BrainDrive is a personal AI system that helps you define, set, and reach your goals. Self-hosted and MIT licensed.

![BrainDrive — checking in on fitness goals](docs/images/braindrive-screenshot.png)

<p align="center">
  <a href="https://braindrive.ai">Website</a> · <a href="https://community.braindrive.ai">Community</a> · <a href="ROADMAP.md">Roadmap</a>
</p>

## What Is BrainDrive?

BrainDrive is a personal AI system that partners with you to improve your career, relationships, fitness, finances — whatever matters to you. It interviews you to understand your goals, builds a structured spec and action plan, then works with you over time to follow through. Every conversation builds Your Memory, so the more you use it, the better it knows you.

Other AI tools chat. BrainDrive partners with you to get things done.

- **For everyone** — designed so anyone can start benefiting from AI, not just developers
- **Compounding** — your AI gets smarter with every interaction, and that value belongs to you
- **Private** — Your Memory lives on your machine, not in someone else's cloud

## What You Get

- **A structured path to your goals** — interview → spec → action plan → ongoing partnership
- **Life areas built in** — Career, Relationships, Fitness, Finance, plus create your own projects
- **Your data stays yours** — conversations, memory, and files live on your machine
- **Memory backup modes** — push memory snapshots to your own Git repo (manual or scheduled)
- **Any AI model** — cloud models via API, local models via Ollama, or both
- **One install** — runs in Docker on Linux, macOS, and WSL
- **MIT licensed** — fork it, extend it, make it yours

## Quick Start

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose on Linux).

Local quick start uses published Docker images (no local source build required).

macOS/Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.sh | bash
```

Windows PowerShell:
```powershell
irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.ps1 | iex
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080), create your account, and start talking to your BrainDrive.

Quick update:

macOS/Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/update.sh | bash
```

Windows PowerShell:
```powershell
irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/update.ps1 | iex
```

## How It Works

1. **Land on BrainDrive+1** — your primary AI assistant. It knows everything across all your projects and helps you get started.
2. **Explore life areas** — Career, Relationships, Fitness, Finance are ready to go. Create new projects for anything else.
3. **Interview** — your AI asks the right questions to understand your situation, goals, and what success looks like.
4. **Spec** — it organizes what it learned into a clear, structured document — your goals, context, and success criteria.
5. **Plan** — the spec becomes an action plan with concrete steps, phases, and milestones.
6. **Partner** — come back anytime. Your AI remembers everything and helps you stay on track, adjust plans, and make progress.

## For Developers

BrainDrive is built on the [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture) (PAA) — an open, MIT-licensed standard for user-owned AI systems. Think of PAA as the spec and BrainDrive as the implementation. Anyone can build on the architecture; BrainDrive is our take on it.

| I want to... | Start here |
|--------------|------------|
| **Understand the architecture** | [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture) — foundation spec, component contracts, conformance tests, zero lock-in by design |
| **Build with AI assistance** | [Architecture Primer](https://github.com/Personal-AI-Architecture/the-architecture/tree/main/docs/ai) — token-optimized reference files designed to hand directly to your AI agent. Compliance matrix, component primers, audit playbooks, canonical examples. |
| **Hack on BrainDrive** | [CONTRIBUTING.md](CONTRIBUTING.md) — fork, build, run tests, submit a PR |

## Architecture

```mermaid
flowchart LR
    C[Clients external] -->|Gateway API| G[Gateway component]
    G -->|Auth middleware check| A[Auth component]
    A -->|POST engine chat and SSE stream internal contract D137| E[Agent Loop component]
    E -->|Model API| M[Models external]

    G -->|Conversation store tool D152| CST[Conversation Store Tool internal]
    CST -->|Read and write conversations| YM[Your Memory platform]

    E -->|Model-driven tool calls| TR[Tool Runtime MCP CLI Native]
    TR -->|Memory tools read write edit delete search list history| YM
    TR -->|External tools| EX[External services and external memory]

    A -.->|Authorizes tool actions by actor policy| TR
```

The system runs as two Docker containers: an app server (Gateway + tools) and an edge proxy (web client + Caddy). Your Memory is stored as plain files in a Docker volume — fully portable, fully yours.

## Lifecycle Commands

| Command | What it does |
|---------|-------------|
| `./installer/docker/scripts/install.sh local` | First-time local setup — pulls prebuilt images and starts everything |
| `./installer/docker/scripts/install.sh dev` | Developer setup — builds from source and starts hot-reload stack |
| `./installer/docker/scripts/install.sh prod` | Production setup on managed hosting infrastructure |
| `./installer/docker/scripts/start.sh local` | Start local stack after stopping |
| `./installer/docker/scripts/stop.sh local` | Stop local stack without removing data |
| `./installer/docker/scripts/upgrade.sh local` | Upgrade local stack to latest published images |
| `./installer/docker/scripts/backup.sh` | Back up Your Memory and secrets |
| `./installer/docker/scripts/support-bundle.sh local 24h` | Create a redacted support bundle archive for sharing with support |
| `./installer/docker/scripts/restore.sh memory <file> local` | Restore from backup (local stack) |

See [`installer/docker/README.md`](installer/docker/README.md) for production deployment, Windows equivalents, and advanced operations.

## Memory Backup (MVP)

BrainDrive includes a local-only **Memory Backup** settings tab for backing up memory snapshots to your own HTTPS Git repository.

What it supports:

1. Configure repository URL, token, and frequency in **Settings -> Memory Backup**
2. Run immediate backup with **Save Now**
3. Run scheduled backups in `after_changes`, `hourly`, or `daily` modes
4. Restore memory from backup branch snapshots

Important safety behavior:

1. Restore is **memory-only**. Secrets are not restored from git backup.
2. Backup repository URL must be `https://` (SSH URLs are rejected).
3. Token is stored as a vault secret reference, not plaintext preferences.

Setup and validation instructions:

1. Operator notes: [`installer/docker/README.md`](installer/docker/README.md)
2. Step-by-step local test flow: [`docs/onboarding/getting-started-testing-openrouter-docker.md`](docs/onboarding/getting-started-testing-openrouter-docker.md)

## Operator Quick Usage

Support bundle script:

- Linux/macOS/WSL:
  - `./installer/docker/scripts/support-bundle.sh local 24h`
- Windows PowerShell:
  - `.\installer\docker\scripts\support-bundle.ps1 -Mode local -SinceWindow 24h`

Gateway support-bundle API (local JWT auth mode only):

- `POST /api/support/bundles` creates a memory-local support bundle archive.
- `GET /api/support/bundles` lists generated support bundle archives.
- `GET /api/support/bundles/:fileName` downloads a specific archive.

## Project Structure

```
braindrive/
├── builds/typescript/       # Core: gateway, engine, auth, memory, web client
├── builds/mcp_release/      # MCP tool services
├── installer/docker/        # Docker compose, Dockerfiles, Caddy config
├── installer/docker/scripts/ # Canonical lifecycle and release scripts
└── docs/                    # Documentation
```

## Built With

- [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture) — the open foundation spec
- TypeScript, Fastify, React, Tailwind CSS
- Docker and Caddy for deployment
- [MCP](https://modelcontextprotocol.io/) for tool integration

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started, or join the discussion at [community.braindrive.ai](https://community.braindrive.ai).

## License

MIT — see [LICENSE](LICENSE).
