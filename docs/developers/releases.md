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
| app/web/Tauri | `builds/typescript/package.json`, `builds/typescript/client_web/package.json`, `builds/typescript/src-tauri/tauri.conf.json`, date Git tags, and `CHANGELOG.md` | Release tooling expects the app and web package version to match `YY.M.D` or `YY.M.D.N`; tagged desktop metadata is reviewed with them. |
| MCP release | `builds/mcp_release/package.json` and tagged MCP source | This application-component version is independent. It is not a public SDK stability promise while OPEN-02 remains unresolved. |
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

The verified help path does not verify production preflight or a release. Actual preflight can recreate ignored dependency trees and build images. The release helper can switch/pull branches, rewrite tracked version/bootstrap files, log in to a registry, build and push images, move tags, use signing authority, create artifacts, and prepare publication. Those are restricted Tier C operations for release-maintainers with an exact target, clean immutable candidate, prerequisites, recovery plan, and separate authorization.

## Restricted maintainer boundary

The public escalation role is `release-maintainers`. OPEN-04 remains open because the authorized private procedure location and approved public escalation wording are not confirmed. OPEN-05 remains open because evidence-retention duration and the restricted evidence store are external facts. This page does not invent either location.

OPEN-08 also remains open: workflow files show checks that run, but only GitHub repository settings can prove required-check, branch-protection, or ownership enforcement.
