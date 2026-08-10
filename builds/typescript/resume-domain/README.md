# Resume Builder owner-data domain

This directory implements the Spec 2 Milestone 2 atomic owner-data store, Milestone 3 career-fact/source and placement behavior, Milestone 4 durable lineage, Milestone 5 restricted capability boundary, and Milestone 6 migration/retention adapters. Records, immutable revisions, CAS/idempotent atomic commits, deterministic migration/recovery, named data capabilities, bounded Career context, and Career return placement remain the storage boundary.

The physical namespace is `apps/resume-builder` below the configured memory root. App callers receive only opaque record/revision/operation identities and bounded record views. They never receive this path, a memory root, generic file operations, provider credentials, or internal permission objects.

Provider inference and wording generation remain in the separate host broker; this directory never resolves a model or credential. Rendering and browser save remain in the separate host broker and web owner surface. This domain only validates and records artifact/export lineage and performs no direct filesystem export, Docker supervision change, or desktop behavior.

Career return placement requires an operation UUID. Its private operation record captures canonical input plus before/after digests so a retry can distinguish not-written from committed state without putting operation IDs or paths into the owner-facing Career journal.

Career's readable `General Resume` document is separate from that narrow journal return. The gateway's generic published-document provider reads the latest approved general definition, renders a bounded Markdown projection, and refreshes it through the normal Career document tree before listing or reading. The immutable approved definition remains authoritative; this domain does not write the project file or grant the installed app filesystem access.

## Scoped capability service

The installed Resume Builder reaches this domain through exactly eleven data operations: `career.context.read`, `career.facts.read`, `career.facts.propose`, `career.facts.confirm`, `resume.definitions.read`, `resume.definitions.write`, `resume.jobs.read`, `resume.jobs.write`, `resume.artifacts.register`, `resume.export.request`, and `resume.operations.read`. `app.inference.request` remains a separate no-tools host broker and is rejected by the data router.

Each call carries a host-created restricted authority projection derived from a consumed one-use app token. The router revalidates it against the current lifecycle grant before parsing or locating records, then narrows the internal grant to one capability and the token's record scopes. Authority, confirmation, operation, schema/migration, provider/model, permission, and installation fields in app input are rejected. Inputs are bounded to 256 KiB. Operation reads are restricted to the same owner, actor, installation, original capability grant, and result-record scope. Missing, wrong-type, and out-of-scope record probes all return the same `not_found_within_scope` response.

Authenticated owner actions use `POST /apps/resume-builder/data/call`. A successful call returns `{ result }`. A failure returns the M1 `{ error, owner_state }` contract: only a stale-revision conflict includes `current_revision`, sets `refresh_required`, and records that the unsaved proposal is preserved. Other denial, cancellation, compatibility, validation, idempotency, and recoverable failures use stable safe messages with no record content, permission object, credential, destination, or path. Capability audit events are schema-validated and content-free before logging; the same allowlisted event is safe when copied into a support bundle.

## Career facts and sources

App/model input can create only `imported` or `suggested` facts. Confirmation, correction, and rejection require a non-serializable host-issued owner-decision witness bound to the owner, actor, operation, input revision, and individual decision. Group review remains one atomic M2 catalog transaction but carries one independently validated witness and immutable successor per fact. Rejected facts and all predecessor revisions remain available for review history; confirmed corrections point to the exact revision they supersede and preserve source references and the most restrictive inherited sensitivity.

Proposal classification is advisory and durable in the fact extension: exact normalized matches are `duplicate`; structured employment proposals for the same employer with different title or date fields are `conflict`; stored owner text, proposal state, provenance, and sensitivity are never normalized away. Sources contain an owner-readable safe label, capture metadata, digest, opaque reference, sensitivity, and an untrusted-data marker—not a source body or host path.

`career.context.read` projects exactly owner profile, Career spec, and Career plan. Each result is bounded to 16 KiB, uses a stable opaque reference, and reports present/missing state, digest, and modification time without a path. Instruction bases/overlays, journals, conversations, unrelated projects, and search are excluded. Direct entry makes no Career write. Career entry inserts only the versioned M-11 return summary; profile, Career spec, and Career plan remain byte-unchanged proposals/parent state.

## Resume, job, artifact, and export lineage

Every catalog read and commit derives and validates a graph across all immutable revisions. General definitions distinguish factual statements from presentation-only text, and their selected fact snapshot exactly matches factual support. Targeted definitions add one approved general parent and one immutable untrusted job snapshot; the atomic tailored-variant record holds the accepted evidence matrix and exact changed-statement identities. All selected or evidence-linked facts must resolve to confirmed revisions, including historical confirmed revisions superseded by later corrections.

Definition comparison returns opaque statement/fact changes and record digests without changing either input. Selection returns an exact immutable revision. Rollback creates a new coherent child under CAS; a targeted rollback or approval creates its matching variant in the same M2 catalog transaction. Retirement is an immutable lifecycle successor and is allowed only without inbound references. Destructive deletion of durable records is intentionally unavailable.

Accepted artifact metadata must match the approved definition's template and deterministic validation identity/findings digest and retains renderer, font-manifest, format, and artifact digests. Artifact bytes remain outside the record store. Export receipts require a matching accepted artifact and retain only the safe destination label and outcome, never a host path.

The host-managed Career Markdown projection is not an artifact record or export receipt. It is a readable, read-only view of the latest approved general definition, regenerated on project access so a newer approved definition cannot leave Career displaying an older resume.

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

## Atomic store and recovery

`manifest.json` fixes the version-1 store layout and integrity mode. `catalog.json` remains the only active-generation pointer. A commit writes canonical immutable revisions and the complete next catalog below a private transaction directory, verifies their digests and references, promotes revisions with exclusive-create semantics, then atomically replaces `catalog.json`. Git history is attempted afterward as best-effort evidence and cannot change the domain outcome.

Writers serialize in-process and acquire a bounded cross-process lease before rereading the active catalog, operation journal, and CAS precondition. A live lease returns a content-free retryable failure after the wait bound. An expired lease or a lease owned by a process that no longer exists is quarantined and reclaimed. Lease identity and expiry are rechecked immediately before the catalog switch.

Startup reconciliation runs under the same lease. A transaction whose operation is present in the verified active catalog is already committed and only its private stage is removed. Every other stage is uncommitted; promoted files not referenced by the active catalog and all invalid/incomplete stages are removed. Readers never enumerate transaction directories or orphan revisions. A missing initial catalog creates empty generation zero; malformed manifests/catalogs, digest failures, missing revisions, locator/reference mismatches, and newer schemas fail closed without replacing the retained state.

Cancellation before the pointer switch removes staged/promoted artifacts and leaves both generation and operation visibility unchanged. Cancellation or response loss after the switch returns or recovers the committed operation identity. Store errors and the optional Git-checkpoint diagnostic contain only stable error categories—never record content or physical paths.

## Migration, transfer, history, and retention

Schema version 1 is the active readable/writable version. A pre-contract version-0 catalog is supported only through the deterministic `resume-data.schema-0-to-1` transformer. Migration snapshots the prior catalog, writes and validates immutable revisions plus a complete staged catalog, records transformer/source/result/recovery provenance, and switches the catalog atomically. Injected failure at snapshot, record, staged-catalog, marker, or post-switch boundaries restores the exact version-0 catalog; restart is idempotent. A schema newer than the package's declared read/write range remains byte-unchanged and blocks activation, restart, update, or rollback with an owner-safe repair/export state.

Whole-memory migration export, migration import, remote backup, and backup restore call the same namespace validator. Export/backup reject a corrupt source graph; import/restore validate the staged graph before replacement and the live graph before success, using their existing rollback behavior. This does not change migration-archive vault/master-key semantics. Audit records contain logical identities, versions, digests, counts, outcomes, and error categories only; archive paths and record content are excluded.

`recordHistory` returns revision identity, sequence, type, lifecycle state, predecessor, timestamp, and digest without a locator or path. The explicit owner-data export contains the complete validated record/operation graph plus compatibility and retention policy in a private JSON file; its public receipt exposes only a safe file name, counts, schema version, and digest.

Lifecycle activation and active-runtime restart revalidate retained owner data against the verified package manifest. Default uninstall first revokes app authority, then removes only abandoned transaction/staged-catalog state through the owner-data adapter. Durable records, recovery snapshots, referenced provenance, metadata receipts, and owner exports remain. Reinstall creates a new installation and grant, validates the retained graph, and never revives the prior token or grant. Whole-memory import/restore and lifecycle mutations are mutually excluded by the gateway migration guard. No starter-pack files are changed by M6 because the namespace is isolated and existing customized owner files remain outside its migration transformer.
