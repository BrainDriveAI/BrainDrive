# Contributing to BrainDrive

Thank you for your interest in BrainDrive. We're building a user-owned AI system, and contributions from the community make it better for everyone.

## Discussion and Feedback

The easiest way to contribute is to engage with the project -- ask questions, report problems, or propose ideas.

- **GitHub Issues** -- Report reproducible bugs using the [bug report form](https://github.com/BrainDriveAI/BrainDrive/issues/new/choose)
- **Community forum** -- Get setup help, ask questions, and discuss feature ideas at [community.braindrive.ai](https://community.braindrive.ai)
- **Security reports** -- Report suspected vulnerabilities privately by following [SECURITY.md](SECURITY.md), never in a public issue

The issue tracker is for actionable, reproducible bugs. Support requests,
troubleshooting, questions, and early feature proposals belong on the community
forum so they can be discussed before becoming implementation work.

Before participating, read and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Code and Documentation

We welcome pull requests for bug fixes, improvements, documentation, and new features.

1. Fork the repository
2. Create a branch from `dev`
3. Make your changes
4. Run lint and tests:
   ```bash
   cd builds/typescript && npm run lint && npm test
   cd builds/mcp_release && npm test
   cd builds/typescript/client_web && npm run lint && npm test
   ```
5. Submit a pull request with a clear description of what you changed and why

For larger changes (new components, architectural modifications, protocol
changes), discuss the approach on the community forum before implementation.

### Branch and Release Model

`dev` is the integration branch for ongoing development, while `main` contains released code. Releases are promoted from `dev` to `main` on a weekly cadence and tagged with date-based versions such as `26.7.23`.

## Secret Scanning

Run the pinned, redacted scanner against current repository content and
reachable Git history:

```bash
tools/security/scan-secrets.sh --current
tools/security/scan-secrets.sh --history
```

Use `tools/security/scan-secrets.sh --self-test` to verify canary detection,
redaction, checksum/version enforcement, deleted-history coverage, and
shallow-clone rejection. See [Repository Security](docs/repository-security.md)
for finding triage and evidence rules. Never paste a matched value into an
issue, pull request, or log.

## Local Development

The fastest way to run BrainDrive locally:

```bash
./installer/docker/scripts/install.sh local
```

This builds and starts everything in Docker. See the [README](README.md) for prerequisites and details.

## Build on It

BrainDrive is built on the [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture) and is MIT-licensed. You can use it, extend it, and build on it without waiting for permission.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
