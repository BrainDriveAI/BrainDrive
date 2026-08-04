# Developer documentation governance

> - Status: Current repository governance contract for `dev`; external GitHub enforcement remains explicitly unconfirmed.
> - Parent: [Developer documentation index](README.md)
> - Sources: [`catalog.json`](catalog.json), [`CONTRIBUTING.md`](../../CONTRIBUTING.md), repository Git history, and GitHub workflow/template files
> - Tests: [`github.test.mjs`](../../tools/docs/test/github.test.mjs), [`freshness-versioning.test.mjs`](../../tools/docs/test/freshness-versioning.test.mjs), and [`governance-release.test.mjs`](../../tools/docs/test/governance-release.test.mjs)

## Catalog authority

[`catalog.json`](catalog.json) is the sole machine-readable registry for current topic authority, lifecycle status, routes, role ownership, source-to-document mappings, aliases, controlled projections, version domains, and migration dispositions. Source, configuration, schemas, tests, package scripts, policies, and Git history remain executable authority for their own behavior.

Each topic has one current canonical path. Cross-cutting pages link to that path instead of copying its contract. A mirror, alias, pointer, generated block, or historical copy must be declared before it is retained.

## Role ownership and review

| Public role | Responsibility | Required review examples |
|---|---|---|
| Repository maintainers | Contribution policy, root instructions, and public governance | Branch policy, GitHub workflow/template, and repository-wide contract changes |
| Documentation maintainers | Catalog, developer corpus, validation, and evidence templates | Canonicality, freshness, migration disposition, and validator changes |
| Runtime maintainers | Runtime, web, desktop, gateway, auth, memory, and source-adjacent truth | Material runtime contract, data-lifecycle, migration, or desktop guidance |
| MCP maintainers | First-party MCP package and tool integration truth | MCP configuration, exposure, permission metadata, and compatibility wording |
| Installer maintainers | Bootstrap, Docker, lifecycle, deployment, and installer trust | State-changing installer or deployment guidance |
| Security maintainers | Vulnerability policy, scanning, secrets, auth, data, and trust boundaries | Any public security-sensitive guidance or sanitized security evidence |
| Release maintainers | Branch/tag/version, artifact, signature, deprecation, and public release truth | Material release, version, compatibility, or deprecation guidance |

The catalog declares roles, not people. OPEN-01 remains open because no authoritative current repository evidence confirms GitHub users or teams for these roles. No `.github/CODEOWNERS` file is added until real handles are confirmed. OPEN-08 remains open because local files cannot prove CODEOWNERS review enforcement, branch protection, or which Actions checks GitHub marks required.

## Required review

Material contract, security, migration, provider, and release documentation changes require the corresponding technical role review plus documentation-maintainer review. A security-sensitive or restricted-boundary change also requires security-maintainer review. A release/tag/version change requires release-maintainer review. AI review can find defects but is not human area-owner, security-aware, release-maintainer, or GitHub-platform evidence.

## Same-PR truth and documentation impact

Behavior, contracts, configuration, compatibility, migration, security, provider, and release processes change with their canonical documentation in the same pull request. The catalog's `sourceMappings` identifies the minimum mapped authority. Contributors must also inspect adjacent effects instead of assuming one mapping is exhaustive.

The pull request declares either:

- the exact canonical pages and catalog mappings updated; or
- `No documentation impact` plus a substantive reason explaining why all relevant contracts remain unchanged.

The Documentation job evaluates changed paths against source mappings on pull requests. On pushes and manual dispatch it evaluates repository structure without inventing a PR body. Repository files do not prove that GitHub makes this job required.

## Generated projections and duplication

Visible document-contract blocks declared as projections are derived from the catalog. Check them from the repository root:

```bash
node tools/docs/sync-generated.mjs --check
```

The check reads declared files and does not write. `--write` is an explicit documentation migration action, not an ordinary verification step. Hand-maintained duplicate contracts are prohibited; concise safety warnings and links are allowed where the authoritative target remains clear.

## Freshness and correction workflow

1. Record the conflicting documentation and executable evidence.
2. Stop before a security, data, compatibility, provider, production, migration, or release behavior change if authority is material or ambiguous.
3. Correct the catalog/source mapping, canonical page, tests, and inbound routes together.
4. Preserve unrelated work and useful history.
5. Run focused fixtures, full `docs:verify`, projection checks, applicable product checks, and sanitized security checks.
6. Report exact results, unresolved facts, and remaining risk. Do not hide a failing journey behind passing automation.

## Branch truth and tag truth

- Documentation on `dev` describes the current `dev` source and may discuss unreleased behavior only as development truth.
- Documentation on `main` describes the released source present on `main`.
- Documentation stored in a release tag describes that tag. A tag must not silently route readers to later `dev` instructions.
- Changes carried between branches or tags require source/diff review. Similar version text is not proof of identical behavior or ancestry.

## Deprecation and historical separation

A deprecation records the subject, lifecycle status, replacement, migration guidance, compatibility implications, and removal state. Removed or legacy behavior leaves current navigation and examples. Useful diagnostic or migration context may remain at a stable pointer or under `docs/developers/history/`, visibly non-authoritative.

## Migration disposition matrix

Every Git-derived non-fixture Markdown candidate is inventoried in the catalog. Exactly one classification-based policy resolves its disposition:

| Disposition | Covered material | Rule |
|---|---|---|
| Retain | Current authorities, policies, governance, validators, evidence records/templates, operator references, and product artifacts | Keep the declared role and current lifecycle; do not promote product/operator artifacts into developer authority. |
| Relocate | Material whose current authority moves to a new canonical path | Create and validate the target, update inbound links, then retain a stable pointer or history before removing old authority. |
| Reclassify | Legacy entries, normal-user/operator guides, unresolved package references, and migration pointers | Keep the file at its stable path with an explicit non-current or non-developer classification. |
| Retire | Content with no remaining migration, diagnostic, policy, or link value | Remove only after current routes, inbound links, history needs, and deprecation review pass. No current file is assigned silent retirement. |

`docs/tailscale-remote-access.md` remains a normal-user/operator guide. Developer pages may link to it only for desktop remote-access testing or diagnosis; it is not a developer canonical authority.

## Security and evidence

Vulnerabilities route only through [GitHub Private Vulnerability Reporting](../../SECURITY.md#reporting-a-vulnerability). Public issues, pull requests, Actions output, milestone records, and release notes contain only sanitized evidence. Validators use Git-derived candidates and exclude ignored owner data, backups, credentials, generated output, vendored content, and the restricted documentation boundary without opening those contents.
