# Developer terminology and status vocabulary

<!-- catalog-contract:start terminology -->
> **Document contract**
> - Purpose: Define repository terms, component names, deployment modes, and document lifecycle labels.
> - Audience: First-time contributors, Recurring contributors, Integrators, Maintainers, AI coding agents, Verification agents and human reviewers.
> - Status: Current on `dev`; Milestone 1.
> - Owner role: documentation-maintainers.
> - Expected outcome: The reader interprets repository language and maturity labels consistently.
> - Prerequisites: Repository access.
> - Parent: [docs/developers/README.md](./README.md).
> - Adjacent topics: [Repository map](./repository-map.md); [Architecture overview](./architecture/README.md).
> - Keywords: `terminology`, `current`, `legacy`, `deployment mode`.
> - Sources: [`docs/developers/catalog.json`](./catalog.json); [`builds/typescript/config.ts`](../../builds/typescript/config.ts).
> - Tests: [`tools/docs/test/orientation.test.mjs`](../../tools/docs/test/orientation.test.mjs); [`builds/typescript/config.test.ts`](../../builds/typescript/config.test.ts).
<!-- catalog-contract:end terminology -->

Use these terms consistently in developer pages, issues, reviews, and AI-agent instructions. For exact configured values, follow the linked source rather than inferring behavior from a label.

## Document status

| Term | Meaning |
|---|---|
| Current | The catalog declares this as the canonical route for its stated branch and applicability. |
| Legacy | Retained for history or transition, but not a current entry point. |
| Historical | Records a past state and makes no claim about current behavior. |
| Internal | Relevant to repository or maintainer work, not a public product contract. |
| Experimental | Present for evaluation and subject to change without a compatibility promise. |
| Deprecated | Still present, but readers should move to the declared replacement. |
| Removed | No longer shipped; references exist only to explain the transition. |
| Unsupported | Explicitly outside the supported surface. |
| Unresolved | Repository evidence is mixed or a maturity decision remains open. Consult source and tests; do not infer a promise. |

## Runtime and deployment terms

- **local-owner**: a gateway authentication mode intended for one local owner and guarded by local transport assumptions.
- **local**: a deployment classification used by runtime configuration and by Docker image mode. The surrounding noun matters.
- **managed**: the hosted deployment classification used by runtime configuration; it does not erase provider or authentication boundaries.
- **Docker dev**: source-mounted gateway plus Vite hot reload.
- **Docker local**: published-image, localhost-oriented deployment.
- **Docker prod**: public deployment packaging with an edge service and production safeguards.
- **Tauri desktop**: native shell that starts or connects to a local runtime and hosts the web client.

## Component terms

- **web client**: the React/Vite user interface under `builds/typescript/client_web/`.
- **gateway** or **API**: the Fastify server and route composition under `builds/typescript/gateway/`.
- **engine**: model loop, streaming, approvals, and tool-call execution under `builds/typescript/engine/`.
- **tools**: built-in memory operations plus registered MCP capabilities assembled by `builds/typescript/tools.ts`.
- **auth** and **config**: authentication/authorization modules and runtime configuration. They are related, not interchangeable.
- **file-backed memory**: user-owned files and git-aware history handled under `builds/typescript/memory/` and `memory-tools/`.
- **secrets**: protected credential material under `builds/typescript/secrets/`; secrets are not part of ordinary memory backup semantics.
- **providers**: model adapter profiles. Current configured choices include BrainDrive Models, BYOK OpenRouter, and Ollama; BrainDrive-owned provider keys must not enter client configuration.
- **MCP**: Model Context Protocol services registered as tool sources. The shipped package is discoverable, while public interface maturity remains unresolved under OPEN-02.

## Governance terms

- **documentation impact**: the source-to-documentation consequence recorded in the catalog and pull request contract.
- **sanitized evidence**: a result record with credentials, private paths, private network identifiers, and user data removed.
- **catalog projection**: a visible document-contract block generated from `docs/developers/catalog.json` and checked for drift.

Continue with the [repository map](repository-map.md) or [architecture overview](architecture/README.md).
