# BrainDrive

**AI that works for you, not Big Tech.**

BrainDrive is a personal AI system you own and control. Bring any model, keep Your Memory on your machine, extend with any tool. One install, no lock-in.

[Website](https://braindrive.ai) | [Docs](https://docs.braindrive.ai) | [Community](https://community.braindrive.ai) | [Architecture](https://github.com/BrainDriveAI/personal-ai-architecture)

## What You Get

- **Your data stays yours** -- conversations, Your Memory, and files live on your machine
- **Any AI model** -- OpenRouter for cloud models, Ollama for local, or both
- **A web interface that grows with you** -- chat, projects, tools, and onboarding built in
- **One command to install** -- runs in Docker on Linux, macOS, and WSL
- **MIT-licensed and open source** -- fork it, extend it, make it yours

## Quick Start

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose on Linux).

```bash
git clone https://github.com/BrainDriveAI/braindrive.git
cd braindrive
./scripts/install.sh local
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080), create your account, and start chatting.

> **Windows:** Use `.\scripts\install.ps1 local` in PowerShell.

## How It Works

BrainDrive implements the [Personal AI Architecture](https://github.com/BrainDriveAI/personal-ai-architecture) (PAA) -- an open spec for user-owned AI systems. Every component is swappable. Your Memory is the foundation; everything else can be replaced.

```
You --> Web Client --> Gateway (Fastify) --> Agent Loop --> Models
                          |                     |
                          +-- Auth               +-- Tools (MCP)
                          |
                          +-- Your Memory
                              (files on your machine)
```

The system runs as two Docker containers: an app server (Gateway + tools) and an edge proxy (web client + Caddy). Your Memory is stored as plain files in a Docker volume -- fully portable, fully yours.

## Lifecycle Commands

| Command | What it does |
|---------|-------------|
| `./scripts/install.sh local` | First-time setup -- builds images and starts everything |
| `./scripts/start.sh` | Start after stopping |
| `./scripts/stop.sh` | Stop without removing data |
| `./scripts/upgrade.sh local` | Rebuild from latest source |
| `./scripts/backup.sh` | Back up Your Memory and secrets |
| `./scripts/restore.sh memory <file>` | Restore from backup |

See [`installer/docker/README.md`](installer/docker/README.md) for production deployment, Windows equivalents, and advanced operations.

## Project Structure

```
braindrive/
+-- builds/typescript/       # Core: gateway, engine, auth, memory, web client
+-- builds/mcp_release/      # MCP tool services
+-- installer/docker/        # Docker compose, Dockerfiles, Caddy config
+-- scripts/                 # Top-level lifecycle commands
+-- docs/                    # Documentation
```

## Built With

- [Personal AI Architecture](https://github.com/BrainDriveAI/personal-ai-architecture) -- the foundation spec
- TypeScript, Fastify, React, Tailwind CSS
- Docker and Caddy for deployment
- [MCP](https://modelcontextprotocol.io/) for tool integration
- OpenRouter and Ollama for model access

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started, or join the discussion at [community.braindrive.ai](https://community.braindrive.ai).

## License

MIT -- see [LICENSE](LICENSE).
