# Documentation validation

This dependency-free Node.js tooling validates the repository-native developer documentation contract. The canonical metadata source is [`docs/developers/catalog.json`](../../docs/developers/catalog.json); prose, source, tests, and package scripts remain their own authorities.

Run from `builds/typescript/`:

```bash
npm run docs:test
npm run docs:check
npm run docs:verify
```

Run `node tools/docs/sync-generated.mjs --check` from the repository root to verify declared visible catalog projections. `--write` changes only declared generated blocks and is never part of ordinary verification.

Candidate enumeration begins with `git ls-files --cached --others --exclude-standard -z` and is then restricted to catalog/governance inputs. The checker does not recursively crawl ignored data. Diagnostics name a rule and repository path without printing suspected secret content.
