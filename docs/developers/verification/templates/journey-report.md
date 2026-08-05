# Journey report template

- Scenario ID:
- Participant role:
- Branch or tag:
- SOURCE_TEST_REVISION:
- SOURCE_CANDIDATE_PROOF:
- Environment and mode:
- Starting state:
- Command:
- Working directory:
- Tool versions:
- Documentation version/path:

## Steps and results

| Step | Expected | Actual | Result |
|---|---|---|---|
| 1 |  |  |  |

## Interventions and confusion points

- Interventions:
- Confusion points:
- Suspected documentation gap:

## Sanitization and disposition

- Sanitization performed:
- Evidence link or public-safe reference:
- Cleanup:
- Remaining risk:
- Disposition: `pass`, `fail`, or `blocked`

Do not include credentials, owner paths/data, private URLs, network identifiers, raw logs, secret matches, production details, or restricted procedures.

Native J-05 platform evidence uses separate JSON records at `docs/developers/verification/platform-reports/windows-j05.json` and `macos-j05.json`. Each must validate against `tools/docs/schemas/platform-report.schema.json` and record native OS/environment, clean before/after state, tool versions, exact commands/results, dynamic-gateway observation, provider-independent usable-shell baseline, cleanup, sanitization, operator/reviewer roles, remaining risk, and a passing disposition.

`EVIDENCE_REVISION` is assigned externally after the report is committed and is supplied to or discovered by the release checker. Do not embed an anticipated evidence commit SHA in a journey or platform report.
