# Budgeting Instruction Index

Use this file after Finance orientation has routed you to the Budgeting executable.

Read only the files needed for the owner's current request.

| Request | Read |
|---|---|
| Create or revise the saved budget | `first-pass-budget.md`, `saved-budget-rules.md`, and `source-evidence.md` if statements exist |
| Compare a month against the saved budget | `monthly-comparison.md`, `source-evidence.md`, `report-contract.md`, `saved-budget-rules.md`, `../rules.md`, and relevant statements |
| Categorize transactions | `source-evidence.md` and `../rules.md` |
| Write or refresh a budget report | `report-contract.md` plus the workflow file relevant to the request |
| Owner corrects a category or transaction type | `../rules.md`, `source-evidence.md`, and the relevant source statement when available |

## Source Hierarchy

Use source evidence in this order:

1. Uploaded statement files in `../statements/`.
2. Owner corrections in the current conversation.
3. Owner-approved durable rules in `../rules.md`.
4. Saved budget goals in `../budget.md`.
5. Derived outputs in `../reports/`.

If a report and a statement disagree, trust the statement unless the owner has corrected it. If `budget.md` and a report disagree about category limits, trust `budget.md`.

## Write Targets

- Saved budget creation or revision writes to `../budget.md` only when the owner is creating or revising the saved plan.
- Saved-budget comparisons write to `../reports/latest.md` and optional `../reports/breakdown-YYYY-MM.md`.
- Durable owner-approved categorization/type memory goes in `../rules.md`.
- Uploaded or converted source evidence belongs in `../statements/`.
