# Personal AI Ecosystem prototypes

Runnable, isolated feasibility experiments for owner-controlled Memory, identity, messaging, discovery/trust, mock purchases, and provider replacement. This package does not change the BrainDrive runtime or establish product readiness. See [PLAN.md](PLAN.md) for authority, existing-system mapping, and acceptance boundaries, and [evidence/validation.md](evidence/validation.md) for results and limitations.

## Reproduce

Use Node 24 or newer, npm, Python 3, and OpenSSL. Tests use synthetic data, generated local keys, loopback HTTP/HTTPS/WebSocket services, and mock payments. No account credentials, hosted services, model, or funds are required.

```sh
cd builds/personal-ai-ecosystem
npm ci
npm run verify
npm run format:check
npm run demo -- evidence
npm audit
```

The package-local `.npmrc` disables lifecycle scripts and uses legacy peer resolution for the pinned tooling. Run these commands with Node 24 on PATH: the SQLite API and HTTPS certificate test require it. The demo retains a task-owned temporary directory for inspection, prints its path, and writes a sanitized report under `evidence/`. Test fixtures are removed automatically. Demo test keys are generated separately under that temporary root with protected file permissions; they are never included in the portable package or committed evidence. Remove only the printed temporary root when finished.

## Implemented surfaces

| Module                             | Behavior                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core.ts`                      | Signed exact-offer grants, separate recovery authority, atomic one-use consumption/shared budget, durable pre-effect journal, independent mock seller, authenticated reconciliation without blind retries |
| `src/identity.ts`                  | did:webvh history creation, pre-rotation, address continuity, local verification, explicit binding to experiment authority                                                                                |
| `src/messaging.ts`, `src/relay.ts` | NIP-17 encrypted synthetic messages, owner-approved contacts and content, durable outbox/inbox, duplicate suppression, local WebSocket relay replacement                                                  |
| `src/discovery.ts`                 | Replaceable directories, direct provider access, bounded description fetching, explicit endpoint/key/payee checks, categorized provenance and trust records                                               |
| `src/portability.ts`               | Signed secret-free inventory, hash/schema/path checks, plain readable Memory import, current-state authority verification, source fencing, historical message restoration                                 |
| `scripts/verify-package.py`        | Independent standard-library reader verifies inventory and raw hashes; it does not verify the owner signature or activate authority                                                                       |
| `scripts/demo.ts`                  | Combined purchase/recovery, relay replacement, readable export, separately recovered secrets, source shutdown and fresh second-host actions                                                               |

Messaging permissions and current identity bindings now use the same Authority owner and epoch as grants. Owner recovery invalidates old contacts, approvals and queued messages; historical records remain readable. Purchase-result continuity uses a certificate signed by the independent recovery key originally pinned in the exact-offer grant, plus fresh replacement-owner possession proof. These certificates authorize retrieval only.

Owner/admin signers remain in the trusted fixture harness; simulated agent operations receive only scoped grants and proofs. Memory stores durable public records, rather than signing secrets. Imported message history cannot become a send queue, and contacts require a fresh owner binding. A lost external response remains unknown/reserved until authenticated status establishes an outcome.

## Boundaries

These are experimental APIs and local test evidence. Public did:webvh hosting/witness interoperability, protocol conformance, hostile-host resistance, production forward secrecy, real/test-fund payment providers, independent live implementation interoperability, UI/runtime integration, and Software Factory qualification remain open. NIP-17 static-key ciphertext can be decrypted after recipient-key compromise; a passing test demonstrates this limitation. Identity HTTPS tests trust only a temporary fixture certificate in the isolated worker and restore the previous trust list; they do not disable TLS verification.

Authority transfer fences the source before activating the target. A failure between those steps may interrupt availability. There is no distributed handoff coordinator, hardware-backed signing, externally witnessed revocation, or root-adversary defense. `statusAvailable` and its freshness timestamp model a checked authority service; they are not a public revocation feed. Unknown payments conservatively reserve budget. Successful mock settlement does not establish any provider's real payment guarantees.

## Documentation impact

The developer catalog registers the experiment guide, plan and evidence as experimental. Existing runtime topics need no revision: this self-contained package is not imported by the product, changes no runtime behavior/configuration, accepted contract, provider, migration route, or release guidance. Its own README, plan, source, tests, and evidence describe the experiment. An accepted product package and integration review are required before moving behavior into BrainDrive.

## Review remediation

The October 4 Fabel review found split messaging authority, action-unbound admin signatures and a missing resolver-side attack test. Independent probing also found that owner-key replacement stranded an already-paid result. The follow-up fixes those boundaries and adds cross-capability recovery, tampered/unrelated entitlement, forged-history, shared-version identity-binding and recovery-chain migration tests. The dedicated `.github/workflows/personal-ai-prototypes.yml` runs this package's build, tests, formatting and demo on Node 24. Existing product jobs use Node 22; integrating or replacing this package requires an explicit runtime compatibility decision. It does not upgrade the product runtime.

Experimental persisted schemas changed (recovery certificates, grant recovery root and seller entitlement root). Reproduction uses fresh task-owned fixture roots. No automatic conversion of earlier disposable fixture databases is provided. The seller verifies lineage, not a live authority feed: superseded owner keys retain retrieval of already-paid results until provider-side revocation is implemented. Some standalone peer fixtures default their recovery key to their owner key; independent compromise recovery is asserted only for fixtures that configure a separate protected root. The protected independent recovery key remains a static fixture root; externally witnessed revocation, recovery-root rotation and production entitlement credentials remain unimplemented.

Shared authority freshness is fail-closed after 60 seconds; the trusted fixture harness must refresh its modeled observation before further messaging. No status-refresh service is implemented. Checked identity bindings require caller-supplied resolution from the latest verified log; the checker does not itself discover the latest DID location or history. The message store pins the persistent Authority ID so an unrelated authority cannot be attached accidentally. Admin proof verification and mutation share one immediate transaction.
