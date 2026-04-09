# Contributing to BrainDrive

Thank you for your interest in BrainDrive. We're building a user-owned AI system, and contributions from the community make it better for everyone.

## Discussion and Feedback

The easiest way to contribute is to engage with the project -- ask questions, report problems, or propose ideas.

- **Issues** -- Report bugs, request features, or ask questions via [GitHub Issues](https://github.com/BrainDriveAI/braindrive/issues)
- **Community** -- Join the conversation at [community.braindrive.ai](https://community.braindrive.ai)

## Code and Documentation

We welcome pull requests for bug fixes, improvements, documentation, and new features.

1. Fork the repository
2. Create a branch from `main`
3. Make your changes
4. Run the tests:
   ```bash
   cd builds/typescript && npm test
   cd builds/mcp_release && npm test
   cd builds/typescript/client_web && npm test
   ```
5. Submit a pull request with a clear description of what you changed and why

For larger changes (new components, architectural modifications, protocol changes), please open an issue first to discuss the approach.

## Local Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for full setup instructions. The quick version:

```bash
cd installer/docker
./scripts/install.sh dev
```

This builds from source with hot reload. See [DEVELOPMENT.md](DEVELOPMENT.md) for all install modes, running tests, and project structure.

## Build on It

BrainDrive is built on the [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture) and is MIT-licensed. You can use it, extend it, and build on it without waiting for permission.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
