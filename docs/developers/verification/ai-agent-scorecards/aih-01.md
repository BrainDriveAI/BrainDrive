# AIH-01 scorecard

## Historical evidence note

The earlier scorecard attempt bound to revision `79fd0e3de2cd137b38b624552478d2ab13f775f1` was recorded as passing for that earlier candidate. It remains historical only and is not relabeled as current evidence.

## Current-candidate execution

The substantive result comes from the fresh isolated read-only execution at `6ff2c50fe6294fa1768754a434c5cccfb84da2ff`. The compatibility classifier compared that source to `05999a1803809ff3f0a62930e9752df8c86095fa` and selected no rerun for this scenario, so the result is carried forward and rebound to the current candidate. Prior scorecards were excluded, and earlier attempts remain historical without relabeling.

- Scenario ID: AIH-01
- Candidate revision: `05999a1803809ff3f0a62930e9752df8c86095fa`
- Candidate state proof: `candidate-content sha256 4a750b03b233a2fde3dd9317d39a81b37d2b0ebf74ed830c0b8e7ff882bbe65a; entries 619; head 05999a1803809ff3f0a62930e9752df8c86095fa`
- SOURCE_TEST_REVISION: `05999a1803809ff3f0a62930e9752df8c86095fa`
- SOURCE_CANDIDATE_PROOF: `source-candidate sha256 4a750b03b233a2fde3dd9317d39a81b37d2b0ebf74ed830c0b8e7ff882bbe65a; entries 619; revision 05999a1803809ff3f0a62930e9752df8c86095fa`
- Task prompt: From the repository root, identify every applicable coding-agent instruction for work under docs/developers, classify CLAUDE.md, GEMINI.md, tracked starter-pack AGENT.md files, and any ignored owner AGENT.md candidates, and explain which files may govern the change. Stay read-only and prove ignored paths were excluded without opening them.
- Starting path and allowed context: `.`; tracked and non-ignored repository candidates; Git modes, symlink targets, and ignore metadata.
- Prohibited inputs/actions confirmed: Ignored owner/runtime content and private planning were not opened; no file was modified; mirrors and product artifacts were not promoted to independent authority.
- Evaluator role: Fresh isolated read-only AI evaluator using only the public checkout and scenario context.

## Trace summary

- Authorities consulted: `AGENTS.md`, `docs/AGENTS.md`, and the `agentContract` in `docs/developers/catalog.json`.
- Repository evidence inspected: Git modes for instruction candidates, symlink targets, tracked starter-pack artifact paths, and ignore-rule metadata.
- Required output: Governing-authority classification plus proof that ignored candidates were excluded without opening them.
- Exact checks or comparisons: `git ls-files -s`, `readlink`, `git check-ignore -v --no-index`, tracked/non-ignored candidate enumeration, opening and closing Git status.
- Zero-change evidence, when required: Closing `git diff --exit-code` succeeded and closing status was clean.

## Required output evidence

- Search trace: Git-derived enumeration found root `AGENTS.md`, scoped `docs/AGENTS.md`, compatibility symlinks, seven tracked starter-pack product-agent files, and one synthetic product-agent fixture.
- Mode and symlink result: `AGENTS.md` and `docs/AGENTS.md` are regular tracked files; `CLAUDE.md` and `GEMINI.md` are mode `120000` links to `AGENTS.md` and have no independent authority.
- Ignored exclusion: `git check-ignore -v --no-index` proved the owner-memory, reset-backup, and private-documentation candidate families are ignored; their contents and presence were not inspected.
- Binary scorecard: All declared gates pass independently; no aggregate score was used.

| Gating dimension | Pass/fail | Evidence |
|---|---|---|
| Authority | pass | Root `AGENTS.md` governs; `docs/AGENTS.md` is additive for `docs/**`; catalog routes apply by topic. |
| Scope | pass | Only tracked/non-ignored candidates and Git metadata were inspected; ignored content was excluded. |
| Trust | pass | Compatibility links are mirrors and starter-pack `AGENT.md` files are product artifacts, not coding authority. |

## Outcome

- Required output present: Yes; the classification and ignored-path proof are retained above.
- Interventions: `jq` was unavailable, so a read-only Node query inspected only `catalog.agentContract`.
- Remaining risk: Topic-specific catalog routes still depend on the particular future change under `docs/developers`.
- Disposition: `pass`
- Sanitization performed: Repository-relative public paths, Git modes, commands, and concise results only; no owner data, private paths, credentials, or raw sensitive output retained.
