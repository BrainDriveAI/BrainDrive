# Getting Started Testing Guide (OpenRouter + Docker + Web UI)

This guide is the clean-start onboarding path for BrainDrive-MVP.

## Before You Start

1. Docker Desktop installed and running.
2. OpenRouter API key.
3. Git installed.

## Fast Path (Recommended, Linux/macOS/WSL)

    cd <repo-root>/builds/typescript
    bash ./scripts/new-user-setup.sh

## Fast Path (Recommended, Windows PowerShell)

    cd <repo-root>\builds\typescript
    powershell -ExecutionPolicy Bypass -File .\scripts\new-user-setup.ps1

The setup scripts:

1. Create/update .env with memory + secrets paths.
2. Initialize vault key material.
3. Prompt for OpenRouter API key and store it encrypted.
4. Seed memory defaults for openrouter + secret_ref.
5. Start Docker stack and verify runtime health.

Then open:

1. http://127.0.0.1:5073

## In-App Onboarding

1. Sign in or create a local account.
2. Keep provider profile on openrouter.
3. Paste OpenRouter API key.
4. Click Save and Continue.
5. Send: Tell me a joke in one sentence.

## Manual Startup (Optional)

    cd <repo-root>/builds/typescript
    docker compose up -d --build

## Quick Troubleshooting

1. If runtime is unhealthy:
   docker compose logs --tail 120 paa-runtime
2. If page does not load:
   docker compose ps, then refresh http://127.0.0.1:5073
3. If key save fails:
   open Settings -> Model Provider and save key again.
