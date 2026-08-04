# Integration and extension inventory

**Status:** Current inventory; individual interface maturity remains evidence-bound.  
**Parent:** [Developer documentation](../README.md)  
**Related:** [Architecture overview](../architecture/README.md), [Developer security](../security.md)

OPEN-02 has no recorded maintainer compatibility decision. Therefore implementation presence means “shipped behavior,” not a supported external API. Unknown never means supported.

| Surface | Observed role | Maturity |
|---|---|---|
| Gateway HTTP/SSE | Internal web/Tauri/runtime contract | Unresolved public compatibility |
| Provider profiles | Runtime-selected BrainDrive Models, BYOK OpenRouter, or Ollama configuration | Internal configuration; public extension compatibility unresolved |
| Main-workspace MCP client | Loads declared Streamable HTTP servers and exposes permission-filtered tools | Internal |
| First-party MCP services | Memory, auth, and project services used by orchestrated runtimes | Internal application component; not an SDK |
| Docker/Tauri/native packaging | Places the same core components into different process/network/data layouts | Current development implementation, not a third-party extension promise |

Choose [gateway](gateway.md), [providers](providers.md), [MCP and tools](mcp-and-tools.md), or [deployment](deployment.md). Each page names source, tests, failure behavior, and safe verification. Tier A checks are read-only/static, Tier B starts or mutates controlled development state, and Tier C requires specific credentials or external authority; see [change verification](../verification.md).

