# Deployment integration boundary

**Maturity:** current packaging behavior; no public extension compatibility promise.

| Path | Process/network shape | State boundary |
|---|---|---|
| Native development | Local MCP processes, gateway on loopback, Vite web server/proxy | Configured task/owner memory root and separate secrets home |
| Docker development | Source-mounted app/web with Compose network, private Internet Search sidecar service, and published development web port | Bind-mounted memory, secrets/dependency volumes; startup may change ownership/install packages |
| Docker local | Packaged app on a local bind with private Internet Search sidecar service | Named memory and secrets volumes plus master-key environment material |
| Docker prod | App plus edge/proxy safeguards | Production configuration and authority required; not a documentation-test target |
| Tauri | Native shell plus embedded loopback MCP/gateway runtime and webview | Platform app data/config/secrets/log roots |
| Managed | Core gateway may proxy selected upstream account/credits routes | Local core memory/secrets remain distinct from upstream account/provider state |

Packaging changes connectivity and lifecycle effects. It does not make gateway APIs public, expose the Internet Search sidecar as a consumer contract, make MCP services safe on an untrusted network, merge memory with secrets, or grant provider credentials.

Use [native setup](../setup/native.md), [Docker development](../setup/docker-development.md), or [Tauri desktop](../setup/tauri-desktop.md) for command contracts. Production helpers, publishing, release signing, destructive volume cleanup, and managed access are not authorized by this page.

Source/config/tests: `builds/typescript/scripts/dev-runtime.mjs`, `installer/docker/compose*.yml`, Docker entrypoint/lifecycle scripts and tests, `builds/typescript/src-tauri/src/main.rs`, `tauri.conf.json`, and desktop tests. A focused automated test for the core Tauri dynamic API-base handoff is absent; do not infer it from optional bridge tests.
