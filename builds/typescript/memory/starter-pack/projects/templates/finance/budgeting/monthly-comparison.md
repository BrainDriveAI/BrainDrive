# Monthly Comparison Workflow

Use this when the owner asks "how did I do?", "compare this month", "am I over budget?", "leave the saved budget alone", or otherwise wants actual spending compared with the saved plan.

## Protected Saved Budget Rule

During saved-budget comparison mode, preserve `../budget.md` exactly unless the owner explicitly asks to revise the saved budget.

Do not use `../budget.md` as scratch space for actuals, variance notes, new-merchant findings, or one-month coaching.

Write comparison findings to:

- `../reports/latest.md`
- optional `../reports/breakdown-YYYY-MM.md`

If the saved budget appears unrealistic or needs new categories, recommend changes in the report's Next Actions. Do not apply those changes to `../budget.md` during comparison.

## Required Reads

Before writing or refreshing a comparison report, read:

- `../budget.md`
- `../rules.md`
- `source-evidence.md`
- `report-contract.md`
- relevant statement files in `../statements/`

Do not generate monthly comparison reports from conversation summary alone.

## Comparison Behavior

- Answer direct comparison questions with a best-effort report from available evidence before asking extra clarification questions.
- Preserve existing category names whenever possible.
- Put new or uncategorized spending into practical buckets plus needs review instead of silently changing the saved budget.
- Separate expenses from income, transfers, credit-card payments, refunds, fees, debt payments, finance charges, and investment movement.
- Do not include investment-account movement in ordinary expense-budget totals unless the owner explicitly asks for investment context.
- If source evidence is incomplete, duplicated, ambiguous, or partially parsed, say so and mark the affected sections provisional.

## Chat Response

When you create or refresh a comparison report, the chat response should show the same practical budget artifact:

- category actuals,
- saved limits,
- over/under status,
- confidence,
- material new or unusual items,
- excluded money movement,
- needs-review items,
- assumptions.

The numbers in chat must match the report.
