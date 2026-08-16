# Memory and secrets lifecycle

**Status:** Current source-backed lifecycle map.  
**Parent:** [Architecture overview](README.md)  
**Related:** [Developer security](../security.md), [MCP and tools](../integrations/mcp-and-tools.md), [Safe debugging](../debugging.md)

Memory and secrets are separate authorities even when one workflow coordinates them.

| State | Default/selected location | Contents and authority |
|---|---|---|
| Memory root | `config.json` resolved relative to the runtime, or `PAA_MEMORY_ROOT` | Owner documents, conversations, preferences, auth state, skills, exports, diagnostics, system metadata, and a local Git repository. |
| Resume Builder owner-data namespace | `apps/resume-builder` below the configured memory root | Versioned immutable owner records—including submitted user-visible interview turns—atomic catalog heads, completed operation lookup, migration recovery metadata, and no provider or runtime credentials. Lifecycle uninstall reaches it only through a narrow adapter that removes abandoned stages and retains durable records. |
| App-published project documents | `documents/<project-id>/published/<publisher-id>/<logical-id>.md` | Host-managed Markdown projections of authoritative app records. The gateway refreshes registered projections atomically before project listing/read, exposes them through the ordinary document viewer, and rejects project-file API edits under the reserved `published/` namespace. |
| Secrets home | `PAA_SECRETS_HOME` or the platform configuration default | Encrypted `vault.json` and, unless supplied by environment, `master-key.json`. Files are written private where the platform supports modes. |
| Master key environment | `PAA_SECRETS_MASTER_KEY_B64` plus optional key id | Replaces file loading for the active process; never belongs in memory/preferences/docs. |

## Initialization and updates

`initializeMemoryLayout` creates declared root directories and seeds missing starter-pack files. Normal startup skips existing templates except for specific root-agent compatibility cleanup; there is no general automatic updater for customized files. The separate `memory:init --force` path can overwrite initialized content and is destructive. Gateway startup calls `ensureGitReady` after layout initialization to initialize the memory root as a Git repository and create the initial commit when needed; standalone `memory:init` does not establish Git. In-process first-party memory file tools commit their mutations; conversation appends use atomic file replacement but do not commit each append.

A starter-pack default change is paired work: update the corresponding tracked default/test fixture and provide an explicit non-overwriting migration/update path for existing owners. Do not make startup overwrite a customized owner file merely to align it with a new default. Until an updater is explicitly authorized and implemented, a changed starter instruction affects new memory roots and tracked test fixtures only; existing owner instructions remain untouched.

Published project documents are not starter-pack defaults and are not editable copies. A provider supplies bounded Markdown plus publisher/logical identity; the host derives the path, updates it only when content changes, and records the memory Git checkpoint. The current Resume Builder provider projects the latest approved general resume into Career. Proposed drafts do not replace it, and opening or listing Career refreshes the projection before it can be displayed. The app receives neither the resulting filesystem path nor generic file authority.

Preferences may store `secret_ref` and optional environment-reference names, never provider secret values. At provider startup/request time the resolver checks an allowed environment reference, then the encrypted vault, then an optional one-time prompt according to policy. Missing required material fails closed.

## History, export, backup, restore, and migration

- Git history records memory changes and supports per-path history. It is not the secret vault and does not protect plaintext accidentally written into memory.
- The current gateway `GET /export` calls `exportMemory`, which delegates to migration export. It creates a sensitive archive under the memory root's `exports` area containing memory plus any available external encrypted vault and master-key files.
- Remote memory backup validates any Resume Builder graph, commits the memory repository, and pushes the dedicated backup branch. Its repository token is resolved by `secret_ref`; the token is not written into the remote URL. The external vault and master-key files are not copied, but every tracked value already inside memory—including auth metadata, diagnostics, or accidental plaintext—is eligible for commit/push.
- Backup restore clones and validates the selected backup commit, validates any staged Resume Builder graph, then replaces memory content through a staged/rollback workflow and revalidates it before success. It is destructive to the current memory target and requires explicit owner authority, verified source, and recovery planning.
- Migration export is the portability implementation behind the current export route. Migration v1 intentionally packages memory plus available encrypted vault and master-key files and requests archive mode `0600` where supported; that mode setting is best effort on platforms that reject it.
- Migration export validates any Resume Builder graph before copying it. Migration import stages memory, validates any staged Resume Builder graph, snapshots current memory and secret files, replaces the targets, revalidates the live graph, and rolls back both memory and secrets on failure. A legacy memory-only archive produces a warning and does not restore secrets.
- Resume Builder owner data lives below the memory root, so current Git backup, backup restore, and migration export/import include it without a parallel archive mechanism. This includes the exact submitted user-visible interview question/answer/follow-up audit trail and skipped turns; it excludes hidden prompts, unsent input, and credentials. These records are owner provenance, not entries in BrainDrive conversation history or content emitted to capability/lifecycle diagnostics and support bundles. Its domain validator verifies schema, catalog/revision digests, references, and lineage at each transfer boundary. Lifecycle mutations are blocked while the gateway migration/import flag is active.
- App-published Markdown lives inside the ordinary project document tree and therefore follows the existing memory Git, backup, restore, and migration behavior. Its authoritative app record remains separately validated; the materialized Markdown is a readable derived projection and is regenerated from the current approved record on access.
- Import validates a basic archive layout and the Resume Builder graph when present, but has no archive signature/authenticity contract; accept only a trusted archive from an authorized source.
- Migration export/import excludes `.git` and therefore carries current memory contents, not the memory repository's Git history. Remote backup restore selects content from a validated remote commit, preserves the target `.git` directory, and records the restored content in a new local commit.

The phrase “not included” above applies to remote Git memory backup, not the current gateway export. The export is a migration archive and can contain both the vault and master key; it must be handled as secret-bearing material. Export/migration and remote backup must not be used as interchangeable terms.

## Sensitive and destructive boundaries

Never inspect an owner's memory, backup, vault, master key, exported archive, or migration payload merely to validate documentation. Do not run restore, import, `memory:init --force`, `secrets init --force`, key rotation, deletion, or remote push without explicit authority and an isolated/verified target. Key rotation is not documented as atomic. Losing the only master key can make vault entries unreadable; copying the vault without the corresponding key is not a usable secret backup. Deleting/restoring a working-tree path does not erase its prior local or remote Git history.

When the in-process first-party memory file tool source is configured, its built-in `memory_export` tool is classified `readOnly`/no approval in `tools.ts`, yet it writes the same secret-bearing migration archive. It is gated by tool and memory permissions, not gateway administration permission. By contrast, gateway `GET /export` requires both `memory_access` and `administration`. “Read-only” here is approval classification, not side-effect-free execution.

General audit logs default under memory `diagnostics/audit`; optional prompt audits use `diagnostics/prompt-audit`. Both are memory data and can enter exports/backups. Path validation is not a claim of sandbox-grade or symlink-proof filesystem isolation.

Owner-created support bundles are a narrower diagnostic export. Before audit JSONL enters a bundle, `memory/support-bundle.ts` rewrites each event through a metadata allowlist; absolute paths, credentials/tokens, messages, permissions, raw metadata, and content-bearing objects are omitted or redacted. The bundle also includes `metadata/lifecycle-diagnostics.jsonl`, a projection of `app.lifecycle.*` events containing only operation/install/state/decision/deletion/retention/error classes. This sanitization does not make ordinary memory export or remote backup content-safe.

Source evidence: `builds/typescript/memory/{init,paths,history,export,backup,backup-git,backup-restore,migration}.ts`, `builds/typescript/secrets/{paths,key-provider,crypto,vault,resolver}.ts`, gateway backup/import routes and schedulers, in-process first-party memory file tools, and their tests. Safe verification uses unit tests with synthetic temporary roots; it does not read owner state.
