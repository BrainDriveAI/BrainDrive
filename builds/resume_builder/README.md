# Resume Builder package and sandboxed owner surface

This remains a separately buildable package. It declares the six app-visible inference operations, immutable purpose policy resource, pure durable-state workflow reducer, and the sandboxed owner resource at `resources/main.html`.

The resource uses only the MCP Apps bridge. It implements direct/Career preflight, one-topic interview and pause/resume, confirmed-fact review, general and tailored version review, pasted-job evidence states, preview/export, history, and retained-data reopen. Career/resume approval and PDF save actions are completed by BrainDrive's host-owned surface; inference, storage, deterministic rendering, and artifact lineage remain host services.

It intentionally has no independent provider adapter, credential access, owner filesystem authority, production lifecycle process, Docker service, or desktop sidecar. Provider execution stays inside BrainDrive's host broker. `RUNTIME_ENABLED` remains `false` for this package process, and it exposes no `start`, `dev`, or execution script; the installed signed fixture runtime is supervised by the app platform.

Commands:

```bash
npm run test
npm run build
```
