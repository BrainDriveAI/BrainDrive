# Resume Builder deterministic renderer and export broker

This directory implements the Resume Builder-owned deterministic renderer and export broker for Milestone 7 clean-text-first preview plus PDF and `.txt` export after host-owner approval. Every render path recomputes the deterministic quality report and requires its digest, input digest, validator identity, and validator version to match the approval evidence. A missing, stale, or failing report blocks preview, export, artifact registration, and the generic Career-published document binding.

`logicalResumeEntries` is the renderer's single logical representation. `renderApprovedResumeCleanText`, `renderApprovedResumeMarkdown`, and `renderApprovedResume` derive from those entries without independently rewriting resume content. Separately, `parity.ts` reconstructs an ordered manifest directly from the approved definition and independently parses preview lines, clean text, PDF tokens, and Career Markdown; it deliberately imports none of the renderer's logical-entry or parse-back helpers. Manifest identities include role, section, statement, supporting-fact revisions, ordinal, and normalized text. The clean-text result is exact UTF-8 text with stable lines and digests. PDF layout wraps only after that boundary, emits a deterministic PDF 1.4 document with the pinned regular and bold core-font manifest, enforces the accepted two-page ceiling, and parses the PDF back to prove exact logical order, including Unicode text. Preview and PDF output use a larger bold name, bold standard section and job headings, unbulleted contact/summary lines, and concise bullets for responsibilities and accomplishments. The optional statement display role is presentation metadata only; factual support and approval validation remain unchanged.

`renderApprovedResumeMarkdown` applies the same approved-definition and text-sanitization boundary to a readable Markdown document. The gateway uses it for generic app-published project documents; it escapes Markdown control characters, preserves the resume's logical section order, and never makes the published document the resume source of truth.

`ResumeExportBroker` keeps the approved definition as the source of truth. Every preview or export persists a strict five-representation `artifact_parity_report` bound to the exact approved revision, policy, representation revisions, manifest digests, and check time. A mismatch blocks only the unsafe preview, copy/text, PDF, or Career side effect; a PDF failure can therefore preserve verified preview and clean-text recovery. Preview produces clean text first and returns it with a safe version label even when PDF generation fails. Export accepts only a `.pdf` or `.txt` filename, never a path, and requires explicit confirmation for replacement intent. The broker prepares strict `application/pdf` or `text/plain;charset=utf-8` bytes plus immutable app-owned artifact lineage; the generic app artifact/export service then registers the prepared artifact under owner/app/installation authority, mediates the host-owned browser or native save boundary, and records a replayable content-safe receipt. A cancelled chooser therefore cannot produce a completed receipt. The sandbox receives only safe labels, opaque parity lineage, allowed-side-effect enums, definition version, format, clean text, PDF status, generic artifact identity, digest, and safe receipt identity--never a filesystem path or document content in diagnostics.

Focused verification from `builds/typescript`:

```bash
npm run test -- resume-renderer resume-domain app-platform/mcp-host
npm run build
```

The disposable browser journey is run from `client_web`:

```bash
node scripts/run-isolated-e2e.mjs e2e/resume-builder.spec.ts --project=desktop-chrome
```

That journey uses an explicit synthetic no-tools provider flag. It does not create production model compatibility evidence. Packaged Windows separately invokes the Tauri native chooser; its command strictly validates the bounded PDF or UTF-8 text payload, atomically replaces only the selected destination, and returns no raw path.
