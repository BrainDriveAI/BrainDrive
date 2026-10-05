# Spec 04 Milestone 3 verified package store and atomic install

Status: Implemented as a dormant kernel. Production process supervision, dynamic MCP registration, gateway routes, and UI activation remain gated.

This document records the Milestone 3 implementation governed by the accepted Spec 04 source, implementation plan, M1 contracts and verification evidence, and the M2 durable lifecycle kernel. The pre-existing feature branch contains later-milestone runtime code; none of the M3 modules below import or register that code.

## Trust and verification order

`VerifiedPackageVerifier` accepts a pinned public root, signed source index and signed revocation document plus a bounded transport. It emits only a fixed step, pass/fail outcome, and stable error code. It does not log source bodies, manifests, signatures, URLs, archive paths, credentials, tokens, or package output.

| Order | Gate | Rejection examples | Authority produced |
|---:|---|---|---|
| 1 | First-party environment/target allowlist and pinned root match | unknown environment/target/root | none |
| 2 | Strict source-index schema, authorized release key, Ed25519 signature | wrong key, altered index, unknown field/algorithm | none |
| 3 | Cached index monotonicity and exact signed version/digest/source selection | lower or equivocated sequence, missing target/source | immutable digest selection only |
| 4 | Bounded descriptor/archive retrieval | partial stream, timeout/error, declared or streamed oversize | non-executable bytes only |
| 5 | Strict descriptor schema, descriptor digest and package signature | malformed descriptor, wrong key, tampering | none |
| 6 | Archive byte length and SHA-256 against descriptor and index | altered/truncated archive | none |
| 7 | Strict canonical manifest/schema | unknown version/field/protocol/capability shape | none |
| 8 | Stored-ZIP structure and archive safety | traversal, absolute path, link/device, duplicate, case collision, expansion, CRC/central mismatch | inspected in memory only |
| 9 | Canonical embedded manifest, every file digest/mode, declared entrypoint, provenance and CycloneDX SBOM | missing/altered/undeclared file or executable surprise | verified file inventory |
| 10 | BrainDrive version, selected platform, MCP/Apps/data contract and host-supported capability set | incompatible range/platform/protocol/data/capability | none |
| 11 | Authorized signed monotonic last-verified revocation list, explicit match, 24-hour install freshness | invalid/older/stale/revoked authority | executable authorization only after all gates |
| 12 | Same-filesystem extraction with `0700` directories and `0400` files | ENOSPC/EACCES/write failure | disposable non-executable staging |

The accepted archive is stored ZIP only. Local and central headers must agree; compression, data descriptors, comments, extra fields, multi-disk records, links, device nodes, directories, duplicate/case-folded identities, more than 256 entries, or more than 64 MiB accepted archive/expanded content fail closed. No archive entry is written before all trust, digest, schema, inventory, compatibility, capability, and revocation checks pass.

## Storage and permissions

The constructor roots are injected; no package metadata can supply a host path. The M1 storage classes remain distinct:

```text
<root>/
  host-app-staging/verify-<random>/        0700 directories; 0400 files; never executable
  host-app-packages/<sha256>/             0555 immutable directories
    manifest.json                         0444
    payload/.../<declared-entrypoint>     0555 only after verified digest promotion
    provenance/...                        0444
    sbom/...                              0444
  host-app-state/package-metadata/        0400 immutable host metadata
  host-app-state/package-references/      0600 atomic reference sets
  host-app-state/package-reference-locks/ 0600 per-digest mutation leases
  host-app-state/verified-feed/            0600 last-verified signed index/revocations
  host-app-state/grants/                  0600 exact installation grants
  host-app-state/install-operations/      0600 durable install journals
  host-app-state/apps/...                 M2 checksummed lifecycle state/journals/pointers
```

Promotion uses same-filesystem rename from a fully verified non-executable stage to the SHA-256 directory. Only after the rename are declared entrypoints changed to `0555`; authority is not published until permissions and metadata complete. Package metadata is immutable `0400`; mutable host-only references, feed cache, grants, and journals are `0600`. An existing identical digest reuses immutable content. Per-digest cross-instance lock files serialize reference-set changes and preserve stale-lock evidence; reference sets contain unique opaque IDs, so an equivalent acquire is idempotent and two installation references cannot cause double deletion. M3 releases references during compensation but deliberately does not implement uninstall or shared-byte deletion.

## Inspection and grants

The owner decision callback receives a server-derived `PackageInspection` before grant creation. It contains only exact app/publisher/name/version/digest, trust root and signing-key IDs, source class/opaque source ID, compatibility contract, selected target, requested named capabilities, retention policy, and provenance/SBOM digests.

An approval must reproduce the requested capability array exactly and bind the authenticated actor. The resulting M1 `CapabilityGrant` is scoped to one owner, actor, installation, app, publisher, digest, decision, capability set, and optional opaque record scopes. It contains no token, credential, host path, URL, environment, or package-selected permission object. A denial returns no installation/grant identity, persists no grant, starts no fake runtime, keeps lifecycle `not_installed`, and leaves immutable cache content at reference count zero.

Redacted shape:

```json
{
  "grant_id": "<opaque-uuid>",
  "owner_id": "<opaque-uuid>",
  "actor_id": "<opaque-uuid>",
  "installation_id": "<opaque-uuid>",
  "app_id": "ai.braindrive.resume-builder",
  "publisher_id": "ai.braindrive",
  "package_digest": "sha256:<digest>",
  "capabilities": ["<exact declared capability names>"],
  "record_scopes": [],
  "decision": { "decision_id": "<opaque-uuid>", "outcome": "approved" }
}
```

## Atomic install and compensation

`AtomicPackageInstaller` has no process or MCP implementation. It depends only on the M1 `InstalledAppSupervisor` interface; tests provide a controllable fake. Its own fsynced journal binds the operation and canonical input to generated installation/grant/decision/reference and M2 transition IDs.

Success order is: verify, promote, inspect, explicit approval, acquire a non-active package reference, commit M2 `staged` with a null active pointer, fake start, fake readiness, fake registration, persist the exact grant, then commit the M2 active pointer/state. Only the last M2 commit publishes `active`. An equivalent terminal retry returns the same authority without another start; a changed input conflicts.

| Failure point | Compensation |
|---|---|
| Source/package/archive/compatibility/revocation | no stage or runtime authority; terminal safe error |
| Stage write or immutable promotion | remove partial stage/content; no lifecycle/grant/runtime authority |
| Owner denial | no grant/reference/runtime; remain `not_installed` |
| Staged persistence | use M2 reconciliation, release any store reference, remain/restore `not_installed` |
| Start rejection or ambiguous outcome | revoke operation/install token generation, cleanup by installation identity, restore M2 state and release reference |
| Readiness or registration | revoke, stop the known runtime, cleanup registrations/orphans, remove grant if present, restore M2 state/reference |
| Grant or active-pointer persistence | reconcile the M2 journal first; if not committed, revoke/stop/cleanup, remove grant, restore `not_installed`; if the active state and exact grant were durably committed, recover the successful response |
| Process interruption before active commit | restart reads the install and M2 journals, revokes/stops/cleans the fake authority, restores `not_installed`, releases the reference, and records terminal failure |

`cleanup` is the M1 supervisor boundary that removes registrations and orphan runtime authority; it is the interface-faithful equivalent of unregister during compensation. A real Spec 05 adapter is explicitly not constructed or injected by M3.

## Deterministic Docker fixture feed

`fixtures/m3-docker/` is a frozen repository fixture reachable inside the existing Docker development source mount. It contains only public keys, signed canonical JSON, a Base64 text encoding of the package archive, provenance, SBOM, and expected hashes. The one-time root/release private keys were discarded and no fixture generator or runtime signer exists.

| Artifact | SHA-256 |
|---|---|
| `trust-root.json` | `e3ad0a48f8ffb01a8040c12ff576901385f8375c58f02a05b188c4b0f807b969` |
| `source-index.json` | `a14c46bdf285b1d59b360300f5d5abee04b64202cff5db2b1e4b6dbe4590a25a` |
| `revocations.json` | `fdfa8202ef3de4d4dec4c2e8b6bade04027289779f15c92964e347930330224d` |
| `1.0.0.descriptor.json` | `7d1cbe972ce7b9ba3c4b8103bdeade6c0f92f1f042306731c73580dbee328966` |
| `1.0.0.bdapp.base64` text | `b9a607ad78299737e85a5c5b00868b577faca24710e18fc333afa30343e34213` |
| decoded `1.0.0.bdapp` | `760cdc911896cdb347ee7abed3b5c79decf7aa2cb46619a2b3f2cf40024d9454` |

The focused test recomputes every hash, verifies the trust chain plus provenance/SBOM, scans the fixture corpus for private-key markers, and checks deterministic archive/path/failure behavior. Existing fixed MCP services and Compose wiring are not changed.

## Verification and scope

From `builds/typescript`:

```bash
npm run test -- app-lifecycle
npm run test
npm run build
npm run lint
```

From `installer/docker` and the repository root:

```bash
docker compose -f compose.dev.yml config
git diff --check
```

M3 does not add a gateway import/route, public API/UI, process spawn, dynamic MCP registry, disable/enable, update/rollback, revocation fetch/quarantine, uninstall/reinstall, owner-data adapter, marketplace/upload, provider/model dependency, private key, or production feature enablement. Those remain later-milestone work even though this feature branch already contains older committed implementations outside the M3 diff.
