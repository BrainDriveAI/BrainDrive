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

Restricted maintainer procedures remain outside this public corpus. This page intentionally does not name or link a private location, because OPEN-04 has no recorded authorized location or escalation wording. Ask the responsible maintainer through an already authorized channel without copying restricted details.

Safe checks are `tools/security/scan-secrets.sh --self-test` followed by `tools/security/scan-secrets.sh --current`, plus the affected unit/documentation tests. A green scan does not prove runtime isolation or authorize access to secret-bearing state.

