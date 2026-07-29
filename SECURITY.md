# Security Policy

## Supported Versions

BrainDrive is currently in beta and changes frequently. Security fixes are released for the latest version; older versions may not receive backports. See the [releases page](https://github.com/BrainDriveAI/BrainDrive/releases) for the current version.

## Reporting a Vulnerability

Please report suspected vulnerabilities through [GitHub Private Vulnerability Reporting](https://github.com/BrainDriveAI/BrainDrive/security/advisories/new). Do not disclose a vulnerability in a public issue, discussion, pull request, community post, or log.

Include enough information for maintainers to understand and reproduce the issue safely:

- the affected version, commit, and deployment mode;
- the affected component and potential impact;
- clear reproduction steps or a minimal proof of concept;
- any known mitigations or conditions required for exploitation; and
- whether you intend to coordinate public disclosure.

Do not include live API keys, passwords, tokens, personal memory, private conversations, or other sensitive data. Use redacted placeholders and synthetic test data. If a credential you control may be exposed, revoke or rotate it through its provider immediately.

Maintainers will acknowledge the report, investigate it privately, and coordinate remediation and disclosure with the reporter. Please allow reasonable time for a fix before publishing details.

## Safe Testing

Test only against systems and accounts you own or are explicitly authorized to assess. Do not access other users' data, disrupt services, use exposed credentials, perform social engineering, or degrade availability. Stop testing and report immediately if you encounter sensitive data.
