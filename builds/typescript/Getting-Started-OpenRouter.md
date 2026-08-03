# Getting Started (OpenRouter + Core MCP)

> **Status: Legacy — not a current setup route.** This page is preserved for historical context and may describe retired services or defaults. Start with the [developer documentation index](../../docs/developers/README.md) and [current TypeScript runtime workspace](README.md); detailed setup reconciliation continues in Milestone 2.

The commands below describe the former BrainDrive-MVP quick-start flow.

## One Command Setup

Linux/macOS/WSL:

    cd <repo-root>/builds/typescript
    bash ./scripts/new-user-setup.sh

Windows PowerShell:

    cd <repo-root>\builds\typescript
    powershell -ExecutionPolicy Bypass -File .\scripts\new-user-setup.ps1

Then open http://127.0.0.1:5073.

## Services Included

1. mcp-memory
2. mcp-auth
3. mcp-project
4. paa-runtime
5. paa-web

## Health Checks

    docker compose ps
    curl -sSf http://127.0.0.1:8787/health
    curl -sSf http://127.0.0.1:8911/healthz
    curl -sSf http://127.0.0.1:8912/healthz
    curl -sSf http://127.0.0.1:8913/healthz
