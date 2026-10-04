# Isolated Personal AI Ecosystem experiment

Owner authorization: Dave W, October 4, 2026, in the Codex goal conversation. Build runnable isolated prototypes using local test keys, synthetic messages/data and mock payments. Codex owns implementation and reproduction; production scope and protocol adoption remain owner decisions.

This is a feasibility experiment, outside product release/qualification. The user-authorized isolated scope does not satisfy the Software Factory's accepted-package gate for new product integration. No runtime integration, accepted contract revision, qualification, release or real transaction is attempted. The experiment informs the missing product package rather than bypassing that gate.

## Finish line

A fresh Node 24 environment can install pinned dependencies, run deterministic failure/recovery tests and a combined demo, read a secret-free package using independent Python tooling, and reproduce the documented evidence. Provide a branch/draft PR for review, with all missing live/public interoperability claims explicit.

## Governing context

- `AGENTS.md`, `CONTRIBUTING.md`, `docs/developers/README.md`, `docs/developers/catalog.json`, `docs/developers/verification.md` from BrainDrive dev `df735040e35c2b6e45d66b8c2b3a97c93d32807f`.
- `docs/developers/architecture/memory-and-secrets.md`, `builds/typescript/auth/authorize.ts`, `builds/typescript/contracts.ts`, `builds/typescript/engine/approval-store.ts`, `builds/typescript/memory/migration.ts`.
- PAA repository `88bc5ba6eace26b451af7b7af782cfac37c5bfb7`, `docs/in-depth-overview/auth-spec.md` and `lockin-gate.md`. Shared contract source baseline remains `c4eb0d475d1200448098729c801964bc8ccce7ec`.
- Accepted Docs inspected at `c48ac907e075af9b31438be426d49f85e82fa868`: `docs/platform/app-platform/` six contracts and `docs/software-factory/software-factory-workflow.md`; no pins modified.
- Full working functionality spec and provider comparison in BrainDrive-Library October 4 capture commit `e94ecc83fc84080072757fb663ed645d128e55fa` are proposed experiment requirements.

## Existing system mapping and gaps

| Boundary               | Existing source evidence                                  | Experiment                                                                                                                      |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Authenticate/Authorize | AuthContext and permission checks; owner runtime baseline | Explicit synthetic owner/admin and audience-bound agent grants, separate from readable records; no claim this exists in product |
| Owner approval         | ApprovalStore is in-process Map                           | Signed exact-offer approval persisted before external mock effect                                                               |
| Durable state          | File Memory and migration archive                         | SQLite transactional authority/operation journal; readable JSON/Markdown Memory; reconcile after crashes                        |
| Secrets                | Protected vault separate from Memory                      | Test keys held in separate protected test directory; no keys/sessions in export                                                 |
| Export                 | Current product migration includes vault and master key   | Independent experiment secret-free package; don't reuse that migration route or change it                                       |
| Agent Loop/tools       | Generic loop executes authorized tool definitions         | Narrow experiment APIs only; no signing/admin APIs exposed to simulated agent                                                   |
| Protocols              | No evaluated identity/messaging/commerce mapping here     | Pinned didwebvh and NIP-17 library feasibility, mock discovery and seller                                                       |

## Build order and verification

1. Durable journal and typed portable Memory; reject invalid paths/schema and protect authority state. Test transactions, restarts and corrupted packages.
2. Owner/agent proof, exact one-use grants, revocation and compromise recovery. Test concurrent replay, wrong audience, altered request, expiry, stale/unavailable status and fresh affected approval.
3. Persistent mock seller and purchaser with separate payment/delivery status. Test dropped response, seller/buyer restart, failed memory writes, concurrent budget, changed offers and no duplicate external effect.
4. did:webvh creation/update/resolution/portability/pre-rotation local feasibility. Verify signatures and continuity from local histories; HTTPS/witness and stolen-host resistance remain unproved.
5. NIP-17 synthetic encrypted messages, durable outbox/inbox and deduplication; local relay failover. Test sender bindings, tampering, offline recipient, receipts and malicious content as inert data.
6. Direct HTTP provider description plus two fixture directories and fresh offers. Test mismatch, stale data, unsafe destinations and provenance/trust categorization.
7. Consistent export/import; independent Python reader/verifier, stale-state rejection and fresh post-migration mock action. Include pending operation/revoked grant and all source evidence.

## Execution checkpoint

Overall objective: complete the runnable experiment and preserve code/evidence for review.
Current: all seven local experiment surfaces implemented; clean pinned install, 55 tests, combined demo, formatting, audit, documentation and secret checks passed.
Remaining: review follow-up push/CI and Library reconciliation with verified pushes.
Blocked branches: public identity/witness interoperability, production messaging security, real/test-fund payments, independent live implementation, and product qualification remain outside this authorized experiment.
Next safe action: preserve this reviewed experiment source on its scoped branch, create a draft PR targeting dev, then reconcile Library state. Later product integration requires accepted scope and owner review.

## October 4 review follow-up

Dave W requested Fabel review and then authorized remediation. Shared owner authority/epoch now governs messaging and checked identity bindings; admin proofs bind the exact action/target. Independent recovery certificates preserve paid-result entitlement through owner changes and portable authority snapshots. Resolver-side old-key forgery is rejected. A dedicated Node 24 prototype CI workflow covers the package; Node 22 product compatibility remains an integration decision. Remaining public/production gates are unchanged.
