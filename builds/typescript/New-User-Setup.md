# New User Setup

## Recommended

Linux/macOS/WSL:

    cd <repo-root>/builds/typescript
    bash ./scripts/new-user-setup.sh

Windows PowerShell:

    cd <repo-root>\builds\typescript
    powershell -ExecutionPolicy Bypass -File .\scripts\new-user-setup.ps1

After setup:

1. Open http://127.0.0.1:5073
2. Complete provider onboarding for openrouter
3. Send Tell me a joke

## Bootstrap Security

For internet-exposed deployments, set a signup bootstrap token before first run:

    PAA_AUTH_BOOTSTRAP_TOKEN="<strong-random-token>"

When this token is configured, first-account signup requires the header:

    x-paa-bootstrap-token: <strong-random-token>

If the token is not configured, first-account signup is restricted to loopback clients only.

## Script Options

Bash:

    bash ./scripts/new-user-setup.sh --help

PowerShell:

    .\scripts\new-user-setup.ps1 -SkipDocker -StartCli
