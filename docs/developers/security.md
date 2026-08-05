# Developer security routing

**Status:** Current router to existing policy and safe development boundaries.  
**Parent:** [Developer documentation](README.md)

Do not report a suspected vulnerability in a public issue. Follow the repository [security policy](../../SECURITY.md) for private reporting, supported-version policy, and response expectations.

For repository secret scanning, synthetic test patterns, remediation expectations, and contributor checks, use [repository security guidance](../repository-security.md). Never paste a credential or raw scanner match into documentation, chat, an issue, a milestone record, or a pull request.

## Development boundaries

- Treat provider credentials, vault/master-key material, auth tokens, backup repository tokens, owner memory, exports/migration archives, support bundles, audit/prompt traces, and private endpoints as sensitive.
- Use task-owned synthetic memory and secrets roots for tests. Documentation validation must not traverse ignored owner state.
- Review gateway bind/proxy/transport settings and MCP network placement before exposing any development service. First-party MCP services do not independently authenticate callers.
- Restore/import, secret deletion or rotation, remote backup push, destructive Compose cleanup, production, release, and signing actions require separate authority.
- Security, data, compatibility, provider, migration, or production conflicts stop documentation work; they are not corrected by changing product behavior under a docs prompt.

The approved location class for restricted maintainer procedures and evidence is a BrainDriveAI-controlled private operations system administered by `@DJJones66`, the confirmed security reviewer and access owner. Suspected vulnerabilities use GitHub Private Vulnerability Reporting and Security Advisories; restricted release or production questions go to an authorized BrainDriveAI security or release maintainer. The exact private locator, procedures, credentials, and signing material are intentionally absent from public documentation.

## Current dependency disposition

The web audit's React Router finding has upstream high severity but applies to unstable React Server Components APIs. BrainDrive currently uses browser routing and has no identified React Router RSC integration. Authorized BrainDriveAI security reviewer `@DJJones66` accepts **not affected in the current architecture**. Rerun this disposition if React Server Components or router server actions are adopted, the router/build architecture changes, a supported patched release becomes available, or the next scheduled dependency review occurs.

Safe checks are `tools/security/scan-secrets.sh --self-test` followed by `tools/security/scan-secrets.sh --current`, plus the affected unit/documentation tests. A green scan does not prove runtime isolation or authorize access to secret-bearing state.
