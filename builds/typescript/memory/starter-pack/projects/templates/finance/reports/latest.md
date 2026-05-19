# Latest Budget Report

**Month:**  
**Generated:**  
**Source statements:** 

## Instructions

This report supports the budget conversation. It should summarize what the owner needs to know, preserve uncertainty, and keep chat answers consistent with report numbers.

For "how did I do?" or monthly comparison requests, use `budget.md` as the saved plan and uploaded statements as source evidence. This report is derived output; do not silently change saved budget limits here.

Monthly comparison report rule: leave `budget.md` unchanged unless the owner explicitly asks to revise the saved budget. If the saved plan needs changes, list recommended changes under Next Actions instead of editing the saved plan.

Tool-use rule: this report is the write target for saved-budget comparison findings. Do not write, edit, or delete `budget.md` while producing this report.

If the owner asks to compare against the saved budget or to leave the saved budget alone, treat `budget.md` as read-only for the turn. Read it for limits; do not use it as a write target.

Before finalizing this report, verify source coverage: list the statement files/date ranges used, account for any merchant the owner specifically asked about, and do not say a named merchant is absent unless the relevant source files were checked.

Do not generate this report from conversation summary alone. Re-read `budget.md`, `rules.md`, and the relevant source statements immediately before writing or refreshing this report.

If an uploaded statement was mentioned in chat but seems missing, inspect the Finance file list and `statements/` folder before saying it is unavailable or asking for a re-upload. Use converted statement filenames and date ranges, not only the original upload filename.

Statement-cycle files may be named by the start month or converted upload path. Include statement files whose date range overlaps the requested month even when the filename month is different.

Build a source evidence ledger before summarizing. At minimum, capture date, exact statement description, amount, account/source file, transaction type, proposed category, and whether the item is ordinary spending, excluded money movement, or needs review.

Treat ledger rows as locked evidence for this report. If an item appears in the ledger and is named by the owner, new/unusual, material, excluded, or needs review, it must appear in the final report.

If the owner asks about a named merchant or transaction, search statement evidence for the exact name and close variants. If the source statement shows the transaction, report it even if the owner later guesses it was absent.

If you previously identified a named item in the conversation, do not later write "not found", "no charge appears", or similar absence language for that item unless you re-read the relevant source statements and determine the earlier identification was wrong. If that happens, explain the correction with the checked files/date ranges.

Always scan checking and credit-card statements for new, unusual, travel, lodging, vacation, entertainment, shopping, and unclear merchants. Include these in `New Or Unbudgeted Items` even when total ordinary spending is under budget.

If a travel, lodging, trip, weekend, vacation, airline, rental, large discretionary, or otherwise unusual merchant appears, list it with the exact statement description, amount, date, account/source, and likely category.

The spent amount for each category should equal the sum of included in-month expense transactions for that category. List income, transfers, credit-card payments, refunds, finance charges, and investment movement outside expense totals.

Every monthly comparison report must include the literal heading `Excluded From Expense Totals`. Do not replace it with a differently named section such as "Interest Charges" or "Credit Card Balance Tracking." Those can be additional sections, but they do not replace the required exclusion section.

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

## Source Evidence Ledger

Use this section for named, new, unusual, material, excluded, or needs-review transactions that must not be lost later in the report.

| Date | Exact Statement Description | Amount | Account/Source | Treatment | Report Section |
|---|---|---:|---|---|---|

## Category Breakdown

| Category | Limit | Spent | Remaining | Status | Notes |
|---|---:|---:|---:|---|---|

Use the saved category names from `budget.md` where possible. Put categories or merchants not present in `budget.md` in the next section instead of changing the saved budget.

## New Or Unbudgeted Items

This section is required for monthly comparisons. Include new, unusual, travel/lodging/vacation, entertainment, shopping, or unclear merchants that are not clearly part of the saved plan.

| Date | Description | Amount | Account/Source | Suggested Category | Notes |
|---|---|---:|---|---|---|

Use exact statement descriptions for any listed item so the owner can trace the item back to source evidence.

## Excluded From Expense Totals

This section is required for monthly comparisons. Include all non-expense money movement that was intentionally left out of ordinary spending totals.

| Type | Payee/Account | Amount | Source | Why Excluded |
|---|---|---:|---|---|

Required treatment when present in source statements:

- `Debt payment | [source payee/account] | [amount] | [source statement] | credit-card/debt payment or transfer, not ordinary spending`
- `Finance charge | [source account] | [amount] | [source statement] | interest cost tracked separately from ordinary spending and principal payments`

If no excluded items exist, write `None found in reviewed source statements`.

## Needs Review

| Date | Description | Amount | Reason |
|---|---|---:|---|

## Next Actions

-

## Final Self-Check

- `budget.md` was not written, edited, or deleted unless the owner explicitly asked for a budget revision.
- Every named item from the owner request that source statements support appears in this report.
- Every ledger item is either included in the final report or explicitly explained as out of scope with source/file reasoning.
- No ledger item is later described as absent unless the correction cites the checked source files/date ranges.
- Credit-card payments, debt payments, transfers, refunds, investment movement, and interest/finance charges are excluded from ordinary spending totals and listed above.
- New or unbudgeted credit-card charges are included in category analysis or `New Or Unbudgeted Items`.
- Any travel/lodging/vacation, large discretionary, or otherwise unusual charge found in source evidence is named explicitly in `New Or Unbudgeted Items` using the exact statement description.
