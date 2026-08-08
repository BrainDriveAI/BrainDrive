# Resume Builder Milestone 4 implementation decisions

Status: Accepted by DJJones, Project Owner, 2026-08-07.

Authorities: accepted Spec 2 (`/home/hex/Reference/Designs/BrainDrive-Tools/Resume-Builder/MVP/spec-02-career-facts-resume-versions-and-artifacts.md`), accepted MVP plan and Milestone 4 prompt, accepted verification plan (`/home/hex/Reference/Designs/BrainDrive-Tools/Resume-Builder/MVP/test-plan.md`), and M1 ADR-RB-003/005/018.

## ADR-RB-019 — Owner-data namespace and atomic catalog

Use the existing M2 mapping `apps/resume-builder` below the configured memory root. Immutable JSON revision files live under `records/<type>/<record-id>/<revision-id>.json`; `catalog.json` is the only visibility pointer and is atomically replaced after every referenced revision validates. The catalog carries current heads, revision locators, and completed operation outcomes. Files staged before a failed pointer swap are unreachable and therefore not domain-visible. Lifecycle code does not enumerate or remove this namespace.

This is the narrowest repository-consistent implementation of the accepted host-owned namespace plus atomic-index decision. It automatically participates in whole-memory Git history, backup restore, and migration export/import without changing those generic mechanisms.

## ADR-RB-020 — First-release migration and downgrade behavior

Version 1 is the first released Resume Builder data schema. A missing namespace initializes empty version 1 state. A pre-contract version-0 fixture exists only to exercise deterministic staging, recovery snapshot, validation, pointer commit, interruption reconciliation, and rollback. Current version-1 extensions round-trip only through explicit `extensions`; newer/unknown schema versions fail closed and remain untouched.

## ADR-RB-021 — Capability and owner-confirmation boundary

Named capability operations validate the installed grant, installation, record scopes, strict input schema, operation identity, CAS precondition, and immutable lineage before record lookup or commit. Bridge calls may read, propose, and save drafts, but app-originated booleans cannot confirm facts or approve definitions. Those transitions require the separately authenticated host-owner action path. Denials are non-enumerating and return no physical path or permission object.

## ADR-RB-022 — Career projection and return placement

Both direct and Career entry use the same deterministic projection of exactly `me/profile.md`, Career `spec.md`, and Career `plan.md`, each bounded to 16 KiB and represented by an opaque reference, kind, status, digest, timestamp, and content—never its path. Career-originated results insert one summary into Career `journal.md` through its existing anchor protocol. Direct-origin results make no Career write. A retained operation record under the app's private owner-data namespace stores only operation and before/after content digests; it makes retry and interrupted-write recovery deterministic without adding identifiers or hidden markers to the Career journal. The adapter never automatically changes profile, Career spec, or Career plan, and no starter template changes are required.
