# Documentation validation

This dependency-free Node.js tooling validates the repository-native developer documentation contract. The canonical metadata source is [`docs/developers/catalog.json`](../../docs/developers/catalog.json); prose, source, tests, and package scripts remain their own authorities.

Run from `builds/typescript/`:

```bash
npm run docs:test
npm run docs:check
npm run docs:verify
```

Run `node tools/docs/sync-generated.mjs --check` from the repository root to verify declared visible catalog projections. `--write` changes only declared generated blocks and is never part of ordinary verification.

Run `node tools/docs/release-check.mjs` from the repository root as a final-evidence precursor. It keeps claimed-platform and current-candidate AI evidence separate from the DA-01 through DA-18 structural report and fails closed for either family. It is not complete release adjudication: Milestone 7 must separately decide all G-01 through G-14 gates, genuine human review, exact-candidate GitHub/Actions/settings evidence, immutable lineage, full-history security disposition, retention, and readiness-record completeness. Neither a structural `docs:verify` pass nor a passing precursor can override those gates.

Candidate enumeration begins with `git ls-files --cached --others --exclude-standard -z` and is then restricted to catalog/governance inputs. The checker does not recursively crawl ignored data. Diagnostics name a rule and repository path without printing suspected secret content.

`node tools/docs/check.mjs --report <safe-temporary-path>` exclusively creates a mode-`0600` sanitized JSON report beneath the operating-system or GitHub runner temporary root; it refuses existing files, symlinks, and destinations outside those roots. The report is validated by `tools/docs/schemas/verification-report.schema.json` and includes the Git input boundary, redacted scoped candidate manifest, an exact DA-01 through DA-18 result matrix, and redacted actionable diagnostics. CI removes the temporary report after writing the job summary. DA-17 rejects website-only embedded constructs, non-descriptive inline or reference navigation, Markdown/HTML images without alternatives, and Mermaid diagrams without their own adjacent plain-text alternative while ignoring literal code examples.
