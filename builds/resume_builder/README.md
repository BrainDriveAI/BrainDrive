# Resume Builder package and sandboxed owner surface

This remains a separately buildable package. It declares the six app-visible inference operations, immutable purpose policy resource, pure durable-state workflow reducer, and the sandboxed owner resource at `resources/main.html`.

The resource uses only the MCP Apps bridge. It implements direct/Career preflight, a ten-topic plain-language interview, deterministic follow-up coaching, pause/resume, and a confirmed-fact review where owners can edit, remove, or add another item before generating a resume. Employment is captured one job at a time through labeled fields; the next question captures an accomplishment for that job, and additional accomplishments can be assigned to a selected saved job. Exact unchanged wording that is already confirmed is reused without creating another proposal or owner-confirmation prompt. It also implements general and tailored version review, pasted-job evidence states, preview/export, history, and retained-data reopen. Career/resume approval and PDF save actions are completed by BrainDrive's host-owned surface; inference, storage, deterministic rendering, and artifact lineage remain host services.

After a general resume is approved, BrainDrive exposes the latest approved version in Career as the read-only `General Resume` Markdown document. This uses the gateway's generic app-published document provider, not Resume Builder-specific Career UI. The host derives and refreshes the document path/content from the authoritative approved definition; the sandbox receives no project filesystem access and drafts cannot replace the published version.

The interview asks for contact details, direction, jobs with associated accomplishments, education, credentials, skills, projects, leadership or volunteering, and professional links. Owners may skip any topic and revisit skipped topics from review. Follow-ups help identify outcomes without requiring metrics and never invent information. Approval refreshes the authoritative workspace and opens Preview; Preview remains available for an approved definition and History remains available whenever a definition exists.

It intentionally has no independent provider adapter, credential access, owner filesystem authority, production lifecycle process, Docker service, or desktop sidecar. Provider execution stays inside BrainDrive's host broker. `RUNTIME_ENABLED` remains `false` for this package process, and it exposes no `start`, `dev`, or execution script; the installed signed fixture runtime is supervised by the app platform.

Commands:

```bash
npm run test
npm run build
```
