# Local experiment validation — October 4, 2026

This is sanitized execution evidence, not protocol conformance, human review, product acceptance, or release qualification. Code is scoped to `builds/personal-ai-ecosystem`; the catalog registers its three Markdown files as experimental. Base revision: `df735040e35c2b6e45d66b8c2b3a97c93d32807f`, branch `codex/personal-ai-ecosystem-prototypes`. The containing Git commit identifies the final experiment source; these are worktree checks rather than immutable release-candidate checks.

Environment: macOS Darwin arm64, Node v24.19.0 (bundled runtime for experiment), npm 10.9.9, Python 3.9.6, OpenSSL 3.6.5. Separate dev clone (full history fetched for revision-bound repository checks); main checkout and its untracked runs preserved. Task-owned temporary data, generated test keys and loopback services only. No provider credentials or funds.

## Results

| Surface             | Implemented and locally verified                                                                                                                                                                      | Still missing                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Durable Memory      | Readable JSON; write failures; persisted pending/final records; separately protected authority and keys                                                                                               | Integrated BrainDrive Memory schema/tool access and production durability                                               |
| Delegation/recovery | Exact-offer, agent/audience/action/cost/expiry binding; one-use grants; concurrent OS-process consumption and shared budget; owner/agent compromise invalidation; independent recovery proof          | Hardware/remote authority, witnessed revocation, hostile-root protection, complete entitlement model                    |
| Identity            | didwebvh-ts 2.8.0 signatures, pre-rotation, SCID continuity; actual local HTTPS hosts and independent resolver after original address shutdown                                                        | Public hosting, witnesses, external resolver interoperability and protocol conformance                                  |
| Messaging           | nostr-tools 2.25.2 NIP-17 synthetic wrapping; real loopback WebSocket relays; failover, offline/restart, durable duplicate suppression, imported inbox history, explicit contact/content approval     | Production relay interoperability, human-read receipts, forward secrecy/post-compromise security                        |
| Discovery/trust     | Two fixture directories, direct HTTP access, signed bounded descriptions, endpoint/key/payee/offer checks, separate provenance/trust categories                                                       | Public protocol/registry adoption, verified provider quality, general SSRF protection for arbitrary remote destinations |
| Mock payment        | Durable exact authorization before effect; separate payment/delivery state; authenticated status, restart and SIGKILL recovery, no blind resubmit                                                     | Coinbase/Turnkey/Stripe/Crossmint integration, funds, settlement guarantees, definitive failure budget-release design   |
| Portability         | Signed secret-free export; strict inventory/hash/path/symlink checks; independent Python reader; current-state checks, source fencing, pending/revoked/consumed history and fresh second-host actions | Independent live implementation, distributed crash-safe handoff, hostile-host migration                                 |

The messaging compromise test positively demonstrates that a recovered static recipient key decrypts older stored ciphertext. This is a limitation, not a passing privacy guarantee. Historical imported outbox rows are inert and cannot be resent. Imported contacts never regain permissions automatically.

Authority state is transactional SQLite, and the external-action marker is persisted before calling the mock seller. A real child process is killed with SIGKILL after the seller commits its effect; the restarted buyer reconciles the original result with exactly one charge. These tests exercise OS process boundaries, not just sequential promises.

## Commands and interventions

Run package commands in `builds/personal-ai-ecosystem` with Node 24 on PATH.

- `npm ci --cache /private/tmp/personal-ai-prototype-npm-cache`: clean pinned install passed; 79 audited packages, zero reported vulnerabilities. `.npmrc` resolves optional tooling peer dependency installation and suppresses dependency lifecycle scripts.
- `npm run verify`: TypeScript build passed; 48 tests across 8 files passed, zero failures.
- `npm run demo -- evidence`: combined local scenario passed; see [demo-report.json](demo-report.json). Independent Python validated nine files/seven Memory records. Original authority was fenced and closed, valid permissions preserved, revoked/consumed history retained, unresolved payment stayed unknown/reserved, and fresh mock purchase/message succeeded with separately recovered fixture keys.
- Formatting, documentation inventory validation/projection checks and repository secret scan are recorded at the final checkpoint below.

During development: an initial tool-version audit finding was resolved by pinning patched Vitest 4.1.11; no audit override. NodeNext exposed extensionless dependency declarations, so this standalone experiment uses TypeScript Bundler resolution. The didwebvh library fetches HTTPS despite older localhost HTTP examples; the test now supplies a temporary private CA using Node's worker-local trust list and restores it afterward. The SIGKILL test originally killed a tsx child wrapper; direct `node --import tsx` now verifies the actual killed worker. An initial broader docs check correctly rejected unregistered experiment Markdown; all three files and their retain disposition were added to the catalog as experimental, without changing runtime topics or accepted contracts. A release-evidence test initially could not resolve historical source revisions in the shallow clone; fetching full history resolved that environment limitation.

## Cleanup and limitations

Unit tests remove their task roots and close services. The demo leaves its printed temporary root for inspection; it contains only generated synthetic data and protected fixture keys. No key or sqlite database enters Git. `demo-report.json` replaces the machine-local path with a placeholder. The independent Python reader checks inventory and hashes, not owner signatures or live authority. Export requires a quiesced single writer. Source fencing occurs before target activation, so a crash in the transfer window can interrupt availability. The status-freshness flag is a local service fixture; no distributed trust guarantee is asserted.

Main product runtime/web/desktop checks were not run: no product source, UI, provider configuration, or runtime import changed. This package has its own full build/test/demo suite; the repository documentation/projection/secret checks cover its repository impact. No product release gate or frozen evidence was refreshed.

## Final checkpoint

`npm run format:check` passed; `npm audit` reported zero vulnerabilities. From repository root, `node tools/docs/check.mjs` passed (225 candidates, zero diagnostics), `node tools/docs/sync-generated.mjs --check` passed, and `tools/security/scan-secrets.sh --current` passed with pinned Gitleaks 8.30.1 and zero findings. `npm run docs:verify` in `builds/typescript` passed: 163 tests passed, one existing skip, zero failures; catalog validation passed. Branch push/PR and Library reconciliation follow this evidence checkpoint; Git and the PR identify the preserved source without a self-referential hash.

## Pull-request freshness correction

The initial GitHub CI run passed runtime, web, MCP, Docker, installer and secret checks but failed two documentation tests: its PR-aware freshness check required the mapped developer front door to accompany the changed catalog. Local checks had not loaded a pull-request event, so they did not exercise that comparison. The follow-up adds an explicitly experimental guide link to `docs/developers/README.md` and reruns documentation validation with a synthetic event containing the real PR base/head and body. CI status remains separate from local evidence and must be checked after push.
