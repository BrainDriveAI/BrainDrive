# Latest Budget Report

**Month:**  
**Generated:**  
**Source statements:** 

## Instructions

This report supports the budget conversation. It should summarize what the owner needs to know, preserve uncertainty, and keep chat answers consistent with report numbers.

For "how did I do?" or monthly comparison requests, use `budget.md` as the saved plan and uploaded statements as source evidence. This report is derived output; do not silently change saved budget limits here.

Monthly comparison report rule: leave `budget.md` unchanged unless the owner explicitly asks to revise the saved budget. If the saved plan needs changes, list recommended changes under Next Actions instead of editing the saved plan.

Tool-use rule: this report is the write target for saved-budget comparison findings. Do not write, edit, or delete `budget.md` while producing this report.

Before finalizing this report, verify source coverage: list the statement files/date ranges used, account for any merchant the owner specifically asked about, and do not say a named merchant is absent unless the relevant source files were checked.

If an uploaded statement was mentioned in chat but seems missing, inspect the Finance file list and `statements/` folder before saying it is unavailable or asking for a re-upload. Use converted statement filenames and date ranges, not only the original upload filename.

Statement-cycle files may be named by the start month or converted upload path. Include statement files whose date range overlaps the requested month even when the filename month is different.

If the owner asks about a named merchant or transaction, search statement evidence for the exact name. If the source statement shows the transaction, report it even if the owner later guesses it was absent.

The spent amount for each category should equal the sum of included in-month expense transactions for that category. List income, transfers, credit-card payments, refunds, finance charges, and investment movement outside expense totals.

The summary must match the category tables. If a category is under budget in its detail section, do not list it as over budget in the summary.

Do not include investment-account movement in expense-budget totals unless the owner explicitly asks for investment context.

When this report is created or refreshed because the owner asked for a first-pass budget or budget comparison, the chat response should show the same practical budget artifact: category actuals, suggested limits or targets, over/under status, confidence, needs-review items, and assumptions. Saving or updating this report does not replace showing the budget in chat.

## Summary

- Overall status:
- Largest over-budget category:
- Largest under-budget category:
- Major new/unbudgeted item:
- Items needing owner review:

## Source Coverage

| Source File | Date Range Used | Notes |
|---|---|---|

List every statement file read for this comparison. Include files read because their statement period overlaps the requested month even if their filename month differs.

## Category Breakdown

| Category | Limit | Spent | Remaining | Status | Notes |
|---|---:|---:|---:|---|---|

Use the saved category names from `budget.md` where possible. Put categories or merchants not present in `budget.md` in the next section instead of changing the saved budget.

## Unbudgeted Or New Spending

| Date | Description | Amount | Suggested Category | Notes |
|---|---|---:|---|---|

## Excluded From Expense Totals

| Type | Amount | Notes |
|---|---:|---|

## Needs Review

| Date | Description | Amount | Reason |
|---|---|---:|---|

## Next Actions

-
