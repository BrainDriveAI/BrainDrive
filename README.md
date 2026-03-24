# BrainDrive-MVP

Minimal runnable BrainDrive MVP for local onboarding with:

1. OpenRouter credential onboarding in the web UI
2. Core runtime (paa-runtime)
3. Required first-party MCP services (mcp-memory, mcp-auth, mcp-project)
4. Web client (paa-web)

## Repository Structure

- builds/typescript - runtime + web app + onboarding scripts
- builds/mcp_release - first-party MCP service implementation used by compose
- docs/onboarding/getting-started-testing-openrouter-docker.md - clean start instructions

## Fast Start

Linux/macOS/WSL:

    cd /home/hex/Project/BrainDrive-MVP/builds/typescript
    bash ./scripts/new-user-setup.sh

Windows PowerShell:

    cd $HOME/Project/BrainDrive-MVP/builds/typescript
    powershell -ExecutionPolicy Bypass -File .\scripts\new-user-setup.ps1

Then open http://127.0.0.1:5073.
