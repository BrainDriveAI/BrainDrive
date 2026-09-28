# Integration and extension inventory

**Status:** Current inventory; individual interface maturity remains evidence-bound.  
**Parent:** [Developer documentation](../README.md)  
**Related:** [Architecture overview](../architecture/README.md), [Developer security](../security.md)

The OPEN-02 maintainer decision defines explicit beta/internal boundaries. Implementation presence still means shipped behavior, not an unrestricted external compatibility promise.

| Surface | Observed role | Maturity |
|---|---|---|
| Gateway HTTP/SSE | Bundled web/Tauri/runtime contract | Internal beta; same-tagged-release clients only; no public third-party or cross-version API promise |
| Provider profiles | Runtime-selected BrainDrive Models, BYOK OpenRouter, or Ollama configuration | Beta-supported built-in profiles; no generic OpenAI-compatible, model, or provider-wide guarantee |
| Main-workspace MCP client | Loads declared Streamable HTTP servers and exposes permission-filtered tools | Internal beta for standard same-release orchestration; custom/external MCP is experimental |
| First-party MCP services | Memory, auth, and project services used by orchestrated runtimes | Internal beta application component; not an SDK or plugin ABI |
| Reviewed installed apps | Runs separately packaged app workflows through verified lifecycle, sandbox, capabilities, and credential-isolated app-owned inference | Internal beta for reviewed same-release apps; not yet a public marketplace or plugin ABI |
| Docker/Tauri/native packaging | Places the same core components into different process/network/data layouts | Current development implementation, not a third-party extension promise |

Choose [gateway](gateway.md), [providers](providers.md), [MCP and tools](mcp-and-tools.md), [installed apps](installed-apps.md), or [deployment](deployment.md). Each page names source, tests, failure behavior, and safe verification. Tier A checks are read-only/static, Tier B starts or mutates controlled development state, and Tier C requires specific credentials or external authority; see [change verification](../verification.md).
