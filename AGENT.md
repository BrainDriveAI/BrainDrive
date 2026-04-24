# BrainDrive — Agent Boot File

> Start here if you are a coding agent working in the `BrainDrive` code repository.

**Repo:** `~/BrainDrive/`

---

## What This Repo Is

This is the main BrainDrive product implementation repo.

BrainDrive is a user-owned AI system built on the Personal AI Architecture (PAA). This repo contains the running product: gateway, agent loop, auth, memory, web client, MCP tool services, and Docker installer/deployment assets.

This file is the public codebase boot document. It is meant to be sufficient for an agent working only from this repository.

Use this file for codebase orientation. Use `README.md`, `ROADMAP.md`, and `CONTRIBUTING.md` for public product and contribution context.

Do not assume access to any private BrainDrive planning repository, maintainer notes, or internal task tracker.

---

## Quick Start

Read these first:

1. `README.md`
2. `CONTRIBUTING.md`
3. `ROADMAP.md`
4. `builds/typescript/package.json`
5. The subsystem you are touching

Typical implementation entrypoints:

- `builds/typescript/gateway/server.ts` — main HTTP API and app wiring
- `builds/typescript/engine/loop.ts` — agent loop and streaming/tool-call flow
- `builds/typescript/tools.ts` — built-in tool discovery and MCP registration
- `builds/typescript/client_web/src/App.tsx` — React app root
- `builds/typescript/client_web/src/components/chat/ChatPanel.tsx` — chat UI wiring
- `builds/typescript/client_web/src/components/settings/SettingsModal.tsx` — settings flows
- `installer/docker/README.md` — Docker modes and lifecycle scripts

---

## Repo Shape

Top-level directories:

- `builds/typescript/` — main app runtime: gateway, engine, auth, memory, web client
- `builds/mcp_release/` — first-party MCP servers used by the runtime
- `installer/docker/` — Docker compose, images, lifecycle scripts, deployment wiring
- `docs/` — user and operator documentation
- `client/` — legacy or auxiliary client assets at repo root level; most active UI work is under `builds/typescript/client_web/`

Within `builds/typescript/`:

- `gateway/` — Fastify server routes and API behavior
- `engine/` — model loop, streaming, approvals, tool execution
- `auth/` — local JWT auth, authorization, bootstrap/signup logic
- `memory/` — file-backed memory, export/import/backup/history
- `memory-tools/` — file operation tools
- `mcp/` — MCP server config and registration
- `secrets/` — vault/master-key handling
- `client_web/` — React + Vite frontend
- `your-memory/` — local development memory fixture/state

---

## Agent Workflow

When starting work:

1. Read the relevant public docs and the subsystem you are about to change.
2. Confirm whether the task is backend, frontend, installer, memory, or MCP-related.
3. Prefer existing patterns in the touched subsystem over introducing a new abstraction.
4. Run the smallest relevant test set before and after substantial changes.

When making decisions:

- Prefer repo-local evidence over assumptions from older conversations or external summaries.
- Treat `README.md`, `ROADMAP.md`, and the code itself as the source of truth available to public contributors.
- If a task appears to depend on private business context, stop treating that context as required and solve from the public repo surface instead.

---

## Architecture Notes

Keep this mental model:

1. The gateway receives UI/client requests and loads runtime/config/auth state.
2. The engine runs the model loop, streams assistant text, and executes tool calls.
3. Tools operate against file-backed memory and other registered MCP sources.
4. The web client talks to the gateway over the local API surface.
5. Docker packages the app for local, dev, and prod modes.

Important behavior boundaries:

- BrainDrive supports both `local` and `managed` deployment modes.
- The UI changes behavior by mode, especially auth, settings, and model/provider flows.
- Memory is file-backed and git-aware. Avoid casual changes to path resolution, backup, restore, import/export, or history semantics.
- Secrets are handled separately from memory backup/restore.

---

## Development Commands

Common commands:

```bash
cd builds/typescript
npm test
npm run dev:server
```

Web client:

```bash
cd builds/typescript/client_web
npm test
npm run typecheck
npm run dev
```

MCP release package:

```bash
cd builds/mcp_release
npm test
```

Docker dev mode:

```bash
./scripts/start.sh dev
```

For broader installer and deployment flows, use:

- `installer/docker/README.md`

---

## Working Norms

- Read the local code before assuming the architecture from older docs.
- Prefer narrow, subsystem-local changes over broad cross-cutting edits unless the task requires them.
- Check for deployment-mode effects when changing auth, settings, onboarding, or model configuration.
- Check for backup/restore and migration implications when changing memory or secrets behavior.
- Keep public repo documentation self-contained.

Before finishing a change, run the most relevant tests for the touched area. Minimum common paths:

- `cd builds/typescript && npm test`
- `cd builds/mcp_release && npm test`
- `cd builds/typescript/client_web && npm test`

---

## Where To Look First

If the task is about:

- Chat/runtime behavior: `builds/typescript/engine/` and `builds/typescript/gateway/`
- Auth/account flows: `builds/typescript/auth/` and auth routes in `gateway/server.ts`
- Memory/files/export/backup: `builds/typescript/memory/`, `memory-tools/`, and `git.ts`
- Frontend behavior: `builds/typescript/client_web/src/`
- Installer/deployment: `installer/docker/`
- Tool registration or MCP behavior: `builds/typescript/tools.ts`, `builds/typescript/mcp/`, `builds/mcp_release/`

---

## Related Docs

- `README.md` — external-facing repo overview
- `CONTRIBUTING.md` — contributor workflow and baseline test commands
- `ROADMAP.md` — public roadmap
- `installer/docker/README.md` — deployment and lifecycle modes
- `builds/typescript/client_web/README.md` — web client details
- `builds/mcp_release/README.md` — first-party MCP server package

If this file drifts from the real code, update it.
