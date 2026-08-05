# Modes, data, and trust boundaries

**Status:** Current source/configuration description.  
**Parent:** [Architecture overview](README.md)  
**Related:** [Request flows](request-flows.md), [Deployment integration](../integrations/deployment.md), [Developer security](../security.md)

Deployment, install, authentication, and transport are separate dimensions. Do not infer one from another.

| Dimension | Values evidenced in source | Effect |
|---|---|---|
| Deployment location | `local`, `managed` | `BD_DEPLOYMENT_MODE=managed` changes config reporting and can enable selected upstream account proxies. |
| Install mode | `dev`, `local`, `prod`, `unknown` | Records packaging/lifecycle context; it does not itself grant authority. |
| Auth mode | `local-owner`, `local`, `managed` | Chooses header-validated local owner or local JWT; the intended managed injected-header branch has a source inconsistency and is not validated as working. |
| Client transport | browser proxy, Tauri loopback gateway | Selects `/api` proxying or the runtime-reported loopback URL plus desktop transport token. |
| Packaging | native processes, Docker, Tauri | Changes process, mount, network, and data-root placement; core gateway/engine boundaries remain.

## Authentication variants

- `local-owner`: the client supplies the expected owner headers and the gateway compares the full actor/mode/permission context with persisted auth state.
- `local JWT`: public bootstrap/login/refresh routes establish a local account; protected routes require a bearer access token. A valid desktop transport token can establish a trusted local context only after the account is initialized.
- `managed`: source comments expect an upstream gateway to inject local-owner headers, but the tracked parser accepts `x-auth-mode: local-owner` while persisted managed auth state is normalized to `managed`. No focused tracked test demonstrates an authorized protected request through this branch. Treat managed protected-route authentication as an unresolved source-level inconsistency, not an evidenced working contract. Separately, `BD_DEPLOYMENT_MODE=managed` has tests for selected upstream account proxies.

In managed deployment, `PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES` defaults to enabled. That default exempts `/account`, `/account/change-password`, `/account/change-email`, `/account/portal-session`, and `/account/topup` from BrainDrive gateway request auth so the upstream account service can apply its cookie/session boundary. It does not exempt the optional transport-token hook: when a desktop or internal transport token is configured, that earlier hook still applies. Setting the option to `false` restores gateway request auth, which then encounters the unresolved managed-auth inconsistency above. “Public” here means unauthenticated by this gateway, not unauthenticated by the upstream session.

Transport authorization does not bypass request authorization. When desktop or internal transport tokens are configured, the first gateway hook rejects other requests except `/health` and `/config`. The subsequent request-auth hook normally derives a BrainDrive auth context, with the explicit managed account-proxy exemptions described above. `/health` and `/config` are deliberately public at both layers.

## Packaging and data placement

- Native development runs the three MCP services, gateway, and Vite as local processes. `PAA_MEMORY_ROOT` and `PAA_SECRETS_HOME` can isolate task-owned state.
- Docker development bind-mounts memory and uses a separate secrets mount/path. Container startup can change ownership and install dependencies; see the [Docker command contract](../setup/docker-development.md).
- Tauri launches Vite during development and an embedded Rust-managed runtime with a dynamically selected loopback gateway. The web bundle does not become a privileged Rust implementation; it changes its API base after calling the Tauri command.
- Managed deployment can add upstream account/credits traffic. It does not make provider credentials, memory, or tool authority browser-owned.

## Trust and non-participants

The model provider supplies completions, not authorization. The web client renders state, not secrets. Docker/Tauri packaging does not redefine memory as secrets. The source intends an upstream proxy to establish managed identity through injected headers, but that protected-route contract is currently unvalidated/inconsistent; untrusted clients must never be described as able to inject trusted headers directly.

Source evidence: `builds/typescript/config.ts`, `auth/middleware.ts`, `auth/headers.ts`, `gateway/server.ts`, `client_web/src/api/config-adapter.ts`, `local-auth.ts`, `runtime-api-base.ts`, `installer/docker/compose*.yml`, and `src-tauri/src/main.rs`. Focused checks are the relevant runtime, web, Docker static/config, and desktop tests listed in [change verification](../verification.md).
