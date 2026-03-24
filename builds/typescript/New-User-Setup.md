# New User Setup

## Recommended

Linux/macOS/WSL:

    cd /home/hex/Project/BrainDrive-MVP/builds/typescript
    bash ./scripts/new-user-setup.sh

Windows PowerShell:

    cd $HOME/Project/BrainDrive-MVP/builds/typescript
    powershell -ExecutionPolicy Bypass -File .\scripts\new-user-setup.ps1

After setup:

1. Open http://127.0.0.1:5073
2. Complete provider onboarding for openrouter
3. Send Tell me a joke

## Script Options

Bash:

    bash ./scripts/new-user-setup.sh --help

PowerShell:

    .\scripts\new-user-setup.ps1 -SkipDocker -StartCli
