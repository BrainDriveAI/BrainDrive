# Getting Started (OpenRouter + Core MCP)

Use this file for quick startup in BrainDrive-MVP.

## One Command Setup

Linux/macOS/WSL:

    cd /home/hex/Project/BrainDrive-MVP/builds/typescript
    bash ./scripts/new-user-setup.sh

Windows PowerShell:

    cd $HOME/Project/BrainDrive-MVP/builds/typescript
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
