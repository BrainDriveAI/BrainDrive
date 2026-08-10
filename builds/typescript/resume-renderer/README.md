# Resume Builder deterministic renderer and export broker

This directory owns Milestone 6 preview and PDF export after host-owner approval. `renderApprovedResume` accepts only an approved definition with validation evidence and the pinned `resume.single-column@1` template. It sanitizes bounded logical text, lays it out in section order, emits a deterministic PDF 1.4 document with the pinned regular and bold core-font manifest, enforces the accepted two-page ceiling, and parses the PDF back to prove exact logical order. Preview and PDF output use a larger bold name, bold standard section headings, unbulleted contact and summary content, and bullets for resume-detail sections.

`renderApprovedResumeMarkdown` applies the same approved-definition and text-sanitization boundary to a readable Markdown projection. The gateway uses it for generic app-published project documents; it escapes Markdown control characters, preserves the resume's logical section order, and never makes the projection the resume source of truth.

`ResumeExportBroker` keeps the approved definition as the source of truth. Preview returns bounded lines and safe version labels. Export accepts only a filename, never a path, and requires explicit confirmation for replacement intent. The broker prepares validated PDF bytes and immutable artifact lineage, then the host saves through the browser or native chooser and finalizes exactly one completed, cancelled, or failed receipt. A cancelled chooser therefore cannot produce a completed receipt. The sandbox receives only the safe destination label, definition version, and parse-back result.

Focused verification from `builds/typescript`:

```bash
npm run test -- resume-renderer resume-domain app-platform/mcp-host
npm run build
```

The disposable browser journey is run from `client_web`:

```bash
node scripts/run-isolated-e2e.mjs e2e/resume-builder.spec.ts --project=desktop-chrome
```

That journey uses an explicit synthetic no-tools provider flag. It does not create production model compatibility evidence. Packaged Windows separately invokes the Tauri native chooser; its command validates the bounded PDF, atomically replaces only the selected destination, and returns no raw path.
