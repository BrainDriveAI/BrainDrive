# Human review template

- Review ID:
- Reviewer role (not identity):
- Operator/recorder role:
- Date:
- SOURCE_TEST_REVISION:
- SOURCE_CANDIDATE_PROOF:
- Scope:
- Independence relevant to this review:
- Reviewed source paths:

## Findings

| ID | Severity | Finding | Evidence path | Recommended disposition |
|---|---|---|---|---|
|  |  |  |  |  |

## Decision

- Result: `pass`, `fail`, or `blocked`
- Unresolved findings:
- Remaining risk:
- Sanitization performed:

REV-01 through REV-08 are stored as JSON at `docs/developers/verification/human-reviews/rev-01.json` through `rev-08.json` and must validate against `tools/docs/schemas/human-review.schema.json`. This Markdown file explains the fields; it is not review evidence. Restricted details stay in an authorized system.

`EVIDENCE_REVISION` is assigned externally after the JSON record is committed and is supplied to or discovered by the release checker. Do not embed an anticipated evidence commit SHA in a review record.
