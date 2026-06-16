# BrainDrive Agent Instructions

Coding agents must read this before working in this repo. Working code only. Plausibility is not correctness.

This is the canonical root agent instruction file. Do not create or maintain a parallel root `AGENT.md`; starter-pack template `AGENT.md` files under `builds/typescript/memory/starter-pack/` are product artifacts and are separate.

## 0. Non-Negotiables

1. No flattery or filler. Start with the answer or action.
2. Never fabricate file paths, commands, test results, API names, commit hashes, or runtime behavior. Read the repo or run the command.
3. Touch only what the task requires. No drive-by refactors, broad formatting, or unrelated cleanup.
4. If there are two plausible interpretations and the choice affects code, ask before editing.
5. Do not claim done without verification. If verification cannot run, say why.

## 1. Before Editing

- State the goal and verification plan before making non-trivial edits.
- Read the files you will touch and the files that call them.
- Prefer repo-local evidence over assumptions from older conversations, external summaries, or private planning context.
- Match existing TypeScript, React, Tauri, and test patterns.
- Check the current branch and working tree before changing files.
- Treat provider configuration, owner keys, and gateway URLs as security-sensitive.

## 2. Implementation Rules

- Make the smallest diff that satisfies the request.
- Write or update focused tests before implementation where practical.
- Keep behavior scoped to the accepted spec or user request.
- Clean up only artifacts created by your own changes.
- Do not suppress errors to make tests pass. Fix the root cause.

## 3. Verification Rules

- Run focused checks during iteration and broader checks before handoff.
- Read test output; do not summarize from memory.
- For UI changes, run typecheck/build and inspect the affected surface when practical.
- For provider changes, verify no BrainDrive-owned provider keys are introduced into client config.
- If a command cannot run because dependencies or platform tooling are missing, report the blocker exactly.

## 4. Communication

- Be direct and concise.
- Surface assumptions explicitly.
- Report files changed, checks run, results, and remaining risk.
- If blocked by secrets, production/staging access, missing environment, or an unresolved product decision, stop and say exactly what is needed.

## 5. Project Context

### What This Repo Is

This is the main BrainDrive product implementation repo.

BrainDrive is a user-owned AI system built on the Personal AI Architecture. This repo contains the running product: gateway, agent loop, auth, memory, web client, MCP tool services, and Docker installer/deployment assets.

Use `README.md`, `ROADMAP.md`, and `CONTRIBUTING.md` for public product and contribution context. Do not assume access to private planning repositories, maintainer notes, or internal task trackers.

### Stack

- Main TypeScript app/runtime: `builds/typescript/`.
- Web client: React + TypeScript + Vite in `builds/typescript/client_web/`.
- Desktop shell: Tauri in `builds/typescript/src-tauri/`.
- MCP release package: TypeScript in `builds/mcp_release/`.
- Test runner: Vitest for TypeScript/web tests; Playwright exists for web E2E; Cargo tests for Tauri/Rust where relevant.

### Branching

- Primary development base branch: `dev`.
- For the OpenRouter/Nemotron related work, use `feature/openrouter-nemotron-migration`; it is based on `dev`.
- This repo is not the Managed-Hosting staging/main deploy pipeline. Do not assume pushing here deploys Hosted.

### Commands

- Common dev server:
  ```bash
  cd builds/typescript
  npm run dev
  ```
- Gateway/server only:
  ```bash
  cd builds/typescript
  npm run dev:server
  ```
- Main TypeScript build:
  ```bash
  cd builds/typescript
  npm run build
  ```
- Main TypeScript tests:
  ```bash
  cd builds/typescript
  npm run test
  ```
- Web typecheck:
  ```bash
  cd builds/typescript
  npm run web:typecheck
  ```
- Web tests:
  ```bash
  cd builds/typescript
  npm run web:test
  ```
- Web build:
  ```bash
  cd builds/typescript
  npm run web:build
  ```
- Desktop preflight:
  ```bash
  cd builds/typescript
  npm run desktop:preflight
  ```
- MCP release build:
  ```bash
  cd builds/mcp_release
  npm run build
  ```
- MCP release tests:
  ```bash
  cd builds/mcp_release
  npm run test
  ```
- Docker dev mode:
  ```bash
  ./scripts/start.sh dev
  ```

### Layout

- `README.md`: external-facing repo overview.
- `CONTRIBUTING.md`: contributor workflow and baseline checks.
- `ROADMAP.md`: public roadmap.
- `builds/typescript/adapters/openai-compatible.json`: provider profiles, including `braindrive-models`, `openrouter`, and `ollama`.
- `builds/typescript/config.ts`: runtime config surface.
- `builds/typescript/gateway/`: Fastify server routes and API behavior.
- `builds/typescript/gateway/server.ts`: main HTTP API and app wiring.
- `builds/typescript/engine/`: model loop, streaming, approvals, and tool-call flow.
- `builds/typescript/engine/loop.ts`: agent loop implementation.
- `builds/typescript/tools.ts`: built-in tool discovery and MCP registration.
- `builds/typescript/auth/`: local JWT auth, authorization, bootstrap, and signup logic.
- `builds/typescript/memory/`: file-backed memory, export/import/backup/history.
- `builds/typescript/memory-tools/`: file operation tools.
- `builds/typescript/mcp/`: MCP server config and registration.
- `builds/typescript/secrets/`: vault and master-key handling.
- `builds/typescript/client_web/`: web UI.
- `builds/typescript/client_web/src/api/`: gateway/client API integration.
- `builds/typescript/client_web/src/App.tsx`: React app root.
- `builds/typescript/client_web/src/components/chat/ChatPanel.tsx`: chat UI wiring.
- `builds/typescript/client_web/src/components/settings/SettingsModal.tsx`: settings flows.
- `builds/typescript/src-tauri/`: desktop shell.
- `builds/mcp_release/`: MCP release package.
- `installer/`: install and bootstrap assets.
- `installer/docker/`: Docker compose, images, lifecycle scripts, and deployment wiring.
- `installer/docker/README.md`: Docker modes and lifecycle scripts.
- `docs/`: user and operator documentation.
- `client/`: legacy or auxiliary client assets; most active UI work is under `builds/typescript/client_web/`.

### Architecture Model

Keep this mental model:

1. The gateway receives UI/client requests and loads runtime, config, auth, and memory state.
2. The engine runs the model loop, streams assistant text, and executes tool calls.
3. Tools operate against file-backed memory and registered MCP sources.
4. The web client talks to the gateway over the local API surface.
5. Docker packages the app for local, dev, and prod modes.

Important behavior boundaries:

- BrainDrive supports both `local` and `managed` deployment modes.
- UI behavior changes by mode, especially auth, settings, onboarding, and model/provider flows.
- Memory is file-backed and git-aware. Avoid casual changes to path resolution, backup, restore, import/export, or history semantics.
- Memory template changes are paired work. When changing files in the local test memory fixture (`builds/typescript/your-memory/`), make the corresponding starter-pack change under `builds/typescript/memory/starter-pack/` so new users receive the same baseline.
- When starter-pack defaults change, account for existing users through the memory update/migration flow. Preserve customized owner files and avoid overwrites unless explicitly approved.
- Secrets are handled separately from memory backup/restore.

### Where To Look First

- Chat/runtime behavior: `builds/typescript/engine/` and `builds/typescript/gateway/`.
- Auth/account flows: `builds/typescript/auth/` and auth routes in `builds/typescript/gateway/server.ts`.
- Memory/files/export/backup: `builds/typescript/memory/`, `builds/typescript/memory-tools/`, and relevant git/history helpers.
- Frontend behavior: `builds/typescript/client_web/src/`.
- Installer/deployment: `installer/docker/`.
- Tool registration or MCP behavior: `builds/typescript/tools.ts`, `builds/typescript/mcp/`, and `builds/mcp_release/`.

### Do Not Modify Unless Explicitly Requested

- Generated or vendored files: `node_modules/`, built artifacts, release outputs, Tauri generated icons/assets.
- Provider secrets, owner API keys, or local credential files.
- Installer/release packaging when the task is limited to provider profile or runtime behavior.

### Project-Specific Forbidden Moves

- Do not put BrainDrive-owned OpenRouter provider keys in client config.
- Do not make BrainDrive Models credits required for Ollama or BYOK OpenRouter.
- Do not treat full BrainDrive client provider/settings regression as part of the Nemotron hosted-provider migration unless explicitly promoted.
- Do not remove Ollama or BYOK OpenRouter provider choices while changing BrainDrive Models behavior.
- Do not hard-code production/staging hosted URLs without checking existing config patterns.

## 6. Project Learnings

- BrainDrive-Test-01 uses `dev` as the base branch for this work; Managed-Hosting deployment branch rules do not apply here.
