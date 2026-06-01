# Compare Actuals Against Saved Budget

*Procedure for comparing statements against `budget.md` without rewriting the saved budget.*

## Preservation Rule

Read `budget.md` for saved limits, but do not edit it during comparison unless the owner explicitly asks to revise the saved budget.

## What This Procedure Accomplishes

Produce an evidence-backed comparison report showing actual spending, budget variance, excluded money movement, and items needing review.

## When to Run

- The owner asks how they did this month.
- The owner asks for over/under, spending, statement, or saved-budget comparison work.
- The owner asks to leave the saved budget alone while comparing actuals.

## Method

Read `budget.md`, `budget-rules.md`, `budget-rules-user.md` if present, `statements/README.md`, and relevant statements. Build a source evidence ledger before writing the report.

Write `reports/latest.md` by default. Write `reports/monthly-YYYY-MM.md` only after the reported month is closed.

Do not claim every transaction was mapped unless the Source Evidence Ledger accounts for every transaction in the relevant source statements. If the ledger is selective, say it is selective and limit claims to the rows reviewed.

Separate ordinary spending from transfers, refunds, debt payments, finance charges, fees, investment movement, and business/startup spending. Show exclusions in the Excluded From Expense Totals section.

Before finalizing, run these reconciliation checks:

- Category Breakdown spent total equals visible category rows.
- Report summary totals equal visible rows plus named exclusions/adjustments.
- Excluded money movement totals equal the Excluded From Expense Totals rows.
- Needs Review rows are excluded from confident totals unless explicitly included and labeled.
- Any owner-named item found in source evidence appears in the audit and a final treatment section.

If any check fails, mark the report Needs Review, show the exact unreconciled amount, and do not present the result as final or fully trustworthy.

## Done Criteria

The report includes Summary, Source Evidence Ledger, Owner-Requested Items Audit, Category Breakdown, New Or Unbudgeted Items, Excluded From Expense Totals, Needs Review, Reconciliation Check, Next Actions, and a consistency check.

## After Running

Report what changed using owner-facing labels, update reports, summarize material parent-level changes briefly in spec or plan only when needed, add todos only for concrete next actions, and return to Finance scope. If statement uploads were accepted during this run, update Finance spec, Finance plan, and Todo list so completed statement gathering is not still active.

## What This Procedure Is Not

It is not permission to change the saved budget. Put recommended saved-budget changes in Next Actions unless the owner explicitly asks for revision.
