# Release and version truth

> - Status: Current public release contract for repository source; restricted release execution requires separate authority.
> - Parent: [Developer documentation index](README.md)
> - Sources: [`CHANGELOG.md`](../../CHANGELOG.md), package/Tauri version files, Git tags, bootstrap trust source, installer release scripts, and CI
> - Tests: [`freshness-versioning.test.mjs`](../../tools/docs/test/freshness-versioning.test.mjs), [`governance-release.test.mjs`](../../tools/docs/test/governance-release.test.mjs), and installer integrity scripts in [CI](../../.github/workflows/ci.yml)

## Public trust contract

A public BrainDrive release ties a Git tag to the source stored in that tag and, where applicable, to published installer assets and digest-pinned container images. Public verification may describe tags, checksums, digests, signatures, artifact names, and verification results. It must not disclose signing credentials, private infrastructure, production access, embargoed work, or restricted procedures.

Release documentation never makes `dev` guidance true for an older tag. Read tagged documentation from the tag itself and compare source paths before carrying evidence forward.

## Version domains

Repository evidence defines separate domains; matching them without source authority would create a false compatibility promise.

| Domain | Public sources | Contract |
|---|---|---|
| app/web/Tauri | `builds/typescript/package.json`, `builds/typescript/client_web/package.json`, both lockfile roots, `builds/typescript/src-tauri/tauri.conf.json`, date Git tags, and `CHANGELOG.md` | `normalize-release-version.mjs` updates or checks app, web, lockfile, and Tauri versions together at `YY.M.D` or `YY.M.D.N`. |
| MCP release | `builds/mcp_release/package.json` and tagged MCP source | This internal-beta application-component version is independent. It is not a public SDK or cross-version stability promise. |
| installer release | Bootstrap tag markers, Docker release scripts, published release assets, and signed release manifest | Installer image/tag and manifest compatibility are evidenced by the specific published release. A local ignored release cache is not repository authority. |

Date tags may use `YY.M.D`; same-day corrections may use `YY.M.D.N`. Tags with a `v0.1.x` shape also exist in Git history and must be evaluated in their own artifact context rather than normalized into the app date domain.

## Branch and tag comparison

From a full repository clone, these Tier A read-only commands compare representative tracked sources without executing a release:

```bash
BRAINDRIVE_RELEASE_TAG=26.7.23
git show "${BRAINDRIVE_RELEASE_TAG}:builds/typescript/package.json"
git show "${BRAINDRIVE_RELEASE_TAG}:builds/typescript/client_web/package.json"
git show "${BRAINDRIVE_RELEASE_TAG}:builds/typescript/src-tauri/tauri.conf.json"
git show "${BRAINDRIVE_RELEASE_TAG}:CHANGELOG.md"
git diff --name-only "${BRAINDRIVE_RELEASE_TAG}..HEAD" -- docs builds/typescript installer .github
```

Replace the example value with the locally available tag under review. Prerequisites: Git, that tag, and a known candidate revision. Side effects: none; these commands read Git objects. Expected result: the reviewer identifies each version domain and every intervening documentation/behavior path. Failure or missing objects means tag evidence is incomplete; fetch the required public history in an authorized clone and rerun. A non-ancestor tag is comparison evidence only, not proof of release lineage.

## Deprecation review

Before release, each deprecated or historical surface must state its replacement, migration guidance, compatibility effect, and removal state. Current examples and navigation must not point to removed behavior. The catalog records the legacy provider-first entry pages and the historical gateway-client contract separately from current authority.

## Release readiness boundary

Public repository evidence supports static review of the release helpers. Both `preflight-production-build.sh` and `release-production.sh` are tracked mode `100644`; direct `./...` execution is therefore not the repository contract. The safe non-direct help probes are:

```bash
bash ./installer/docker/scripts/preflight-production-build.sh --help
bash ./installer/docker/scripts/release-production.sh --help
```

Working directory: repository root. Prerequisites: Bash and a repository checkout. Side effects: help text only; the scripts exit before dependency installation, Git changes, Docker login/build/push, package rewrites, signing, or publication. Expected result: usage text and exit 0. Recovery: none.

The verified help path does not verify production preflight or a release. Normalization is now a separate `--normalize-only` stop point: it requires a clean starting tree, updates app/web/lock/Tauri versions and bootstrap markers, then exits so the changes can be reviewed and committed. Publication never normalizes tracked source. It requires a clean immutable candidate, records full `CANDIDATE_REVISION`, checks every version and bootstrap marker, and fails closed if the tree or revision changes.

An authorized release then preflights that commit, publishes versioned images, generates/signs/verifies the manifest, and archives `installer/docker` from exactly `CANDIDATE_REVISION`. Mutable `latest` tags move only after manifest and asset verification. Git tag creation and GitHub release publication remain manual restricted boundaries at the same candidate revision. The helper's `--dry-run --skip-git-sync` path validates a clean normalized candidate and prints this ordering without checkout, pull, login, build, push, sign, tag, or publication. Failure recovery leaves `latest` and the Git tag untouched; the maintainer must inspect any already-published immutable version refs and resume only under the authorized procedure.

Actual preflight may recreate ignored dependency trees and build images. Normalization mutates tracked source. Publication can sync Git, authenticate to a registry, build/push versioned and mutable images, use signing authority, and create release assets. Those remain restricted Tier C operations for release-maintainers with an exact target, prerequisites, recovery plan, and separate authorization.

## Restricted maintainer boundary

Suspected vulnerabilities must be reported through [GitHub Private Vulnerability Reporting](../../SECURITY.md#reporting-a-vulnerability). Restricted release and production procedures are available only to authorized BrainDriveAI security or release maintainers. Public contributors must stop at the documented safe checks and request the applicable maintainer review.

The approved procedure and restricted-evidence location class is a BrainDriveAI-controlled private operations system administered by `@DJJones66`, the confirmed security reviewer and restricted-evidence access owner. Vulnerability collaboration uses GitHub Private Vulnerability Reporting and Security Advisories. Credentials and signing material remain in an approved secret manager, never in either Git repository. The exact private locator is distributed out of band and must not appear in this public corpus. This resolves OPEN-04 without publishing restricted location details.

## Evidence retention

| Evidence class | Retention | Public boundary |
|---|---|---|
| Canonical sanitized source, platform, AI, human, and release evidence | Indefinite through normal Git history | Schema-valid public repository evidence only |
| Hosted CI artifacts and job summaries | At least 90 days | Canonical results are also summarized in the repository evidence record |
| Restricted release evidence | 36 months after release or 12 months after support ends, whichever is later | BrainDriveAI private operations system administered by `@DJJones66`; authorized security/release-maintainer access only |
| Private vulnerability records | Through remediation plus at least 36 months | GitHub private vulnerability/security-advisory system |
| Raw transient diagnostic logs | No more than 30 days unless an active investigation or legal hold requires longer | Restricted store only; delete as soon as the retained decision can stand without them |

Access is reviewed annually and when a maintainer leaves. A legal, contractual, or insurance obligation may lengthen these periods but must not silently shorten them. The owner decision resolves OPEN-05's durations, storage category, and access owner. Evidence of the configured GitHub Actions retention value remains OPEN-08 Step 7/9 work.

OPEN-08 remains a Step 7/9 external proof obligation: workflow and CODEOWNERS files show intended checks and owners, but only GitHub repository settings can prove required-check, branch-protection, or ownership enforcement.
