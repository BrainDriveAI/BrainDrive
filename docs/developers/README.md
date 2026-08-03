# BrainDrive developer documentation

<!-- catalog-contract:start developer-documentation-index -->
> **Document contract**
> - Purpose: Route developer audiences, journeys, and components to current repository authority.
> - Audience: First-time contributors, Recurring contributors, Integrators, Maintainers, Security researchers, Release engineers, AI coding agents, Verification agents and human reviewers.
> - Status: Current on `dev`; Milestone 1.
> - Owner role: documentation-maintainers.
> - Expected outcome: The reader reaches the current page, source, tests, and adjacent context for a task.
> - Prerequisites: Repository access; Applicable AGENTS.md files.
> - Parent: [README.md](../../README.md).
> - Adjacent topics: [Developer terminology and status vocabulary](./terminology.md); [Repository map](./repository-map.md); [Architecture overview](./architecture/README.md).
> - Keywords: `developer documentation`, `persona index`, `journey index`, `component index`.
> - Sources: [`docs/developers/catalog.json`](./catalog.json); [`README.md`](../../README.md).
> - Tests: [`tools/docs/test/orientation.test.mjs`](../../tools/docs/test/orientation.test.mjs); [`tools/docs/test/links.test.mjs`](../../tools/docs/test/links.test.mjs).
<!-- catalog-contract:end developer-documentation-index -->

This is the GitHub-first front door for people and coding agents working on BrainDrive. Start here from a repository file view or plain source. [`catalog.json`](catalog.json) is the machine-readable route and authority registry; source, tests, schemas, package scripts, and policies remain authoritative for the executable contracts they define.

## Start by persona

| Persona | First route | What it answers |
|---|---|---|
| First-time contributor | [Repository map](repository-map.md) | Where the product code and closest tests live |
| Recurring contributor | [Native setup](setup/native.md) and [change verification](verification.md) | Which development path and proportional checks to use |
| Integrator | [Architecture overview](architecture/README.md#providers-and-mcp) | Where providers and MCP participate; compatibility promises remain unresolved under OPEN-02 |
| Maintainer | [Documentation scope instructions](../AGENTS.md) | How authority, catalog updates, and documentation impact are governed |
| Security researcher | [Security policy](../../SECURITY.md) | How to report privately and provide sanitized evidence |
| Release engineer | [Changelog](../../CHANGELOG.md) and [bootstrap reference](../../installer/bootstrap/README.md) | Where version history and pinned installer trust live; detailed release guidance arrives in Milestone 5 |
| AI coding agent | [Root instructions](../../AGENTS.md), then [repository map](repository-map.md) | Which instructions, source, tests, and verification apply |
| Verification reviewer | [Validation tooling](../../tools/docs/README.md) | Which deterministic checks and evidence templates apply |

Normal BrainDrive owners looking to install or use the product should use the [product README](../../README.md), not this developer corpus.

## Start by journey

| Journey | Current route | Maturity boundary |
|---|---|---|
| Orient | [Repository map](repository-map.md) and [terminology](terminology.md) | Current |
| Run | [Native TypeScript/web](setup/native.md), [Docker development](setup/docker-development.md), or [Tauri desktop](setup/tauri-desktop.md) | Current provider-independent setup contracts; evidence remains environment-specific |
| Contribute | [Contribution policy](../../CONTRIBUTING.md) | Current |
| Trace | [Architecture overview](architecture/README.md) | Current component overview; detailed flows expand in Milestone 3 |
| Integrate | [Providers and MCP](architecture/README.md#providers-and-mcp) | Orientation only; public stability remains OPEN-02 |
| Secure | [Security policy](../../SECURITY.md) and [repository scanning](../repository-security.md) | Current policy |
| Maintain documentation | [Documentation instructions](../AGENTS.md), [catalog](catalog.json), and [validator](../../tools/docs/README.md) | Current |
| Release | [Changelog](../../CHANGELOG.md), [Docker reference](../../installer/docker/README.md), and [bootstrap trust](../../installer/bootstrap/README.md) | Current source-adjacent truth; cohesive release journey arrives in Milestone 5 |

## Start by component

| Component | Responsibility | Source-adjacent route |
|---|---|---|
| Web client | React/Vite interface and gateway API adapters | [Web client README](../../builds/typescript/client_web/README.md) |
| Gateway and API | HTTP routes, auth enforcement, state loading, and streaming | [Architecture: gateway](architecture/README.md#gateway-and-api) |
| Engine and tools | Model loop, assistant streaming, approvals, and tool execution | [Architecture: engine and tools](architecture/README.md#engine-and-tools) |
| Auth and config | Deployment-mode, authentication, runtime, and provider preferences | [Architecture: auth and configuration](architecture/README.md#authentication-and-configuration) |
| Memory and secrets | File-backed memory and separately protected secret material | [Architecture: memory and secrets](architecture/README.md#memory-and-secrets) |
| Providers and MCP | Model adapter profiles and registered external tool services | [Architecture: providers and MCP](architecture/README.md#providers-and-mcp) |
| Docker and installer | Dev, local, and production packaging and lifecycle scripts | [Docker installer README](../../installer/docker/README.md) |
| Tauri desktop | Native shell and embedded local runtime for the web client | [Tauri subsystem README](../../builds/typescript/src-tauri/README.md) |
| Tests and CI | Workspace checks plus repository CI composition | [Change verification matrix](verification.md) |
| Security and release | Reporting, scanning, version history, and installer trust | [Repository map: security and release](repository-map.md#security-and-release) |

## Search terms

GitHub search should find the vocabulary contributors actually use: web client, gateway, API, engine, tools, auth, config, local-owner, local, managed, BrainDrive Models, BYOK OpenRouter, Ollama, providers, MCP, file-backed memory, secrets, Docker dev, Docker local, Docker prod, installer, Tauri desktop, tests, CI, security, release, documentation impact, and sanitized evidence.

## Authority and status

- [Terminology](terminology.md) defines current, legacy, historical, internal, experimental, deprecated, removed, unsupported, and unresolved.
- Exactly one current canonical page is declared for each topic. A legacy or unresolved page cannot silently become a current persona, journey, or component route.
- A material conflict with executable repository evidence is a defect. Use the linked source and tests for exact behavior.
- Milestone records are sanitized, revision-bound execution traces, not product or technical authority.
- Global gates G-01 through G-14 remain open until Milestone 7 final adjudication.
