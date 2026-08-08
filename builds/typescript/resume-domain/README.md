# Resume Builder owner-data domain

This directory implements the Milestone 4 durable owner-data foundation, Milestone 5 validation-backed approval transaction, and Milestone 6 renderer/export lineage registrations. Records, immutable revisions, CAS/idempotent atomic commits, first-release migration/recovery, named data capabilities, bounded Career context, and Career return placement remain the storage boundary.

The physical namespace is `apps/resume-builder` below the configured memory root. App callers receive only opaque record/revision/operation identities and bounded record views. They never receive this path, a memory root, generic file operations, provider credentials, or internal permission objects.

Provider inference and wording generation remain in the separate host broker; this directory never resolves a model or credential. Rendering and browser save remain in the separate host broker and web owner surface. This domain only validates and records artifact/export lineage and performs no direct filesystem export, Docker supervision change, or desktop behavior.

Career return placement requires an operation UUID. Its private operation record captures canonical input plus before/after digests so a retry can distinguish not-written from committed state without putting operation IDs or paths into the owner-facing Career journal.

## Durable record matrix

| Record | Authority and lineage | Retention |
|---|---|---|
| source / career fact | Source digest and immutable source revision; only a host-mediated owner proof creates a confirmed fact revision | durable provenance / durable owner data |
| resume definition / tailored variant | Exact confirmed fact revisions; general predecessor or general parent plus immutable job revision; approved revisions atomically carry validator/policy/input/output/findings digests | durable owner data |
| job description | Owner-pasted text stored as untrusted immutable data with a verified digest | durable provenance while referenced |
| artifact / export receipt | Definition, validator, renderer, template, font, artifact, operation, and safe destination metadata only | durable owner data |
| interview progress | CAS-protected declared draft and topic progress | durable owner data |
| migration | Source/result digests and recovery snapshot identity | rollback recovery window |

Every durable mutation uses an operation UUID, canonical input digest, installation identity, named capability, and expected revision where an existing record is updated. Equivalent retries reuse the committed revisions; mismatched input conflicts. The catalog pointer is the visibility boundary for multi-record commits.
