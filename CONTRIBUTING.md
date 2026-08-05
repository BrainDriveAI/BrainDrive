# Contributing to BrainDrive

BrainDrive accepts focused code, documentation, test, and repository-workflow contributions against the `dev` integration branch. Start by classifying the request so public support and security routes remain safe.

## Classify the request

| Request | Route |
|---|---|
| Reproducible product bug | Use the [bug report form](https://github.com/BrainDriveAI/BrainDrive/issues/new/choose) with a minimal public-safe reproduction. |
| Documentation defect or focused improvement | Use the [documentation report form](https://github.com/BrainDriveAI/BrainDrive/issues/new/choose) with the exact page, revision, expected result, and actual result. |
| Setup help, troubleshooting, or question | Use the [BrainDrive community forum](https://community.braindrive.ai). |
| Early feature or architecture proposal | Discuss it on the [community forum](https://community.braindrive.ai) before implementation. |
| Accepted implementation work | Link the actionable issue or recorded maintainer decision in the pull request. |
| Suspected vulnerability | Stop public discussion and follow [SECURITY.md](SECURITY.md) for GitHub Private Vulnerability Reporting. Never place sensitive evidence in an issue, pull request, forum post, or log. |

Read and follow the [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Prepare a focused change

1. Fork or update your repository and create a focused branch from `dev`.
2. Read the root `AGENTS.md` and every applicable `AGENTS.md` scope before editing.
3. Locate the canonical topic in the [developer documentation index](docs/developers/README.md) and catalog. Inspect the implementation source, callers, configuration, tests, persistence or migration boundary, and source-to-document mapping that participate in the change.
4. Preserve unrelated working-tree changes. Do not edit generated artifacts, vendored dependencies, runtime data, owner memory, backups, or credentials.
5. Make the smallest change that satisfies the accepted request. Avoid drive-by refactors, broad formatting, and unrelated cleanup.
6. Add or update focused tests first where practical, then run the focused check and the applicable broader checks from the [verification matrix](docs/developers/verification.md).
7. Apply the [same-PR documentation rule](docs/developers/governance.md#same-pr-truth-and-documentation-impact): update each affected canonical page and catalog mapping, or provide a substantive reviewed no-impact reason.
8. Open a pull request targeting `dev` and complete every evidence and impact field in the template.

Material contract, security, migration, provider, and release documentation changes require review from the relevant public role in the [governance ownership map](docs/developers/governance.md#role-ownership-and-review). Named GitHub handles, CODEOWNERS enforcement, and required-check settings are not established by repository files unless separately evidenced.

## Verification and handoff

Report exact commands and actual results. Separate automated results from manual checks; state `Not run` with a concrete reason when a check is inapplicable or unavailable. Include:

- changed files and the request they satisfy;
- automated command, working directory, exit/result, and public-safe CI link when available;
- manual environment, steps, expected result, actual result, and sanitized evidence;
- documentation impact or a substantive no-impact reason;
- migration, configuration, provider, security, and release implications; and
- blockers, follow-up evidence, and remaining risk.

Common documentation checks are:

```bash
cd builds/typescript
npm run docs:test
npm run docs:check
npm run docs:verify
```

Run product checks in proportion to the changed surface. The repository CI currently exercises runtime lint/test/build, web lint/typecheck/test/build, MCP test/build, Docker image smoke, installer integrity, documentation validation, and secret scanning. Do not claim GitHub required-check enforcement from the workflow file alone.

## Branch, tag, and release truth

- `dev` is the primary integration branch for ongoing development.
- `main` and release tags preserve released source. Documentation on a branch describes that branch; documentation in a tag must remain matched to that tag.
- Application releases use date-based versions such as `26.7.23` and same-day corrections may use `YY.M.D.N`. Other repository artifacts have separate version domains; see [Release and version truth](docs/developers/releases.md).
- Do not run publishing, signing, production, or release commands without separate authority.

## Secret scanning

From the repository root, run the pinned redacted scanner in the modes applicable to the checkout:

```bash
tools/security/scan-secrets.sh --self-test
tools/security/scan-secrets.sh --current
```

Run `tools/security/scan-secrets.sh --history` only in a full-history clone. Follow [Repository Security](docs/repository-security.md) for triage and evidence rules. Never paste a matched value into an issue, pull request, or log.

## Local development

Use the [native TypeScript/web](docs/developers/setup/native.md), [Docker developer](docs/developers/setup/docker-development.md), or [Tauri desktop](docs/developers/setup/tauri-desktop.md) journey. Docker `local` pulls published images; Docker `dev` builds and runs the hot-reload source workspace. These are different contracts.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
