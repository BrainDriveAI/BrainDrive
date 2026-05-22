# Budget Report Contract

Use this when writing or refreshing `../reports/latest.md` or an optional month-specific report.

## Required Report Sections

Every monthly comparison report should include:

- `Summary`
- `Source Coverage`
- `Source Evidence Ledger`
- `Owner-Requested Items Audit`
- `Category Breakdown`
- `New Or Unbudgeted Items`
- `Excluded From Expense Totals`
- `Needs Review`
- `Next Actions`
- `Final Self-Check`

The literal heading `Excluded From Expense Totals` is required. Do not replace it with a differently named section such as "Interest Charges" or "Credit Card Balance Tracking." Those can be additional sections, but they do not replace the required exclusion section.

## Source Coverage

List every statement file read for the comparison. Include files read because their statement period overlaps the requested month even if their filename month differs.

## Source Evidence Ledger

Use the ledger for named, new, unusual, material, excluded, or needs-review transactions that must not be lost later in the report.

Before finalizing the report, verify every ledger item is either included in the final report or explicitly explained as out of scope with source/file reasoning.

## Source-To-Report Reconciliation

Before saving or presenting the report, proofread the report against the source evidence ledger instead of relying on conversation memory.

For each reviewed account/source:

- If the ledger has ordinary spending rows, the report must not claim that account had zero active purchases, zero active charges, no spending, or $0 in new purchases.
- If the ledger has credit-card payments, debt payments, transfers, refunds, income, or other excluded movement, the report must list the treatment in `Excluded From Expense Totals` or clearly explain the equivalent treatment.
- If the ledger has finance charges or fees, the report must mention them separately from ordinary spending and debt principal payments.
- If the ledger has needs-review rows, the report must preserve a `Needs Review` treatment unless the owner has already categorized them.
- If a summary sentence, source coverage row, category table, or next action contradicts the ledger, revise the report before answering.

Only write `none`, `no`, `zero`, `not found`, or `$0` claims after checking the relevant source files and account-level ledger summary.

## Owner-Requested Items Audit

Reconcile every merchant, item, trip, bill, or transaction the owner specifically asked about.

The audit must list each requested item, search result, sources checked, exact source match, amount, date, and final report treatment.

If an owner-requested item is found in source statements, include the exact source description in the audit and also include the item in a treatment section such as `New Or Unbudgeted Items`, `Category Breakdown`, `Excluded From Expense Totals`, or `Needs Review`.

If an item is not found, say which source files/date ranges were checked. If uncertain, mark it `Needs Review` instead of omitting it.

Before answering, compare audit rows against final report sections and revise the report if any found or needs-review owner-requested item is missing from its treatment section.

## Category Breakdown

Use saved category names from `../budget.md` where possible. The spent amount for each category should equal the sum of included in-month expense transactions for that category.

Put categories or merchants not present in `../budget.md` in `New Or Unbudgeted Items` instead of silently changing the saved budget.

When writing subtotal sentences, make the included set explicit and keep examples aligned with that set. If a subtotal excludes `Needs Review`, refunds, finance charges, or other excluded rows, label it that way and do not list excluded rows in the parenthetical examples for that subtotal. If the text needs to discuss both included and excluded rows, show separate subtotals instead of mixing them in one sentence.

The summary must match the category tables. If a category is under budget in its detail section, do not list it as over budget in the summary.

## Exclusions

List income, transfers, credit-card payments, refunds, finance charges, debt payments, and investment movement outside ordinary expense totals.

Required treatment when present in source statements:

- `Debt payment | [source payee/account] | [amount] | [source statement] | credit-card/debt payment or transfer, not ordinary spending`
- `Finance charge | [source account] | [amount] | [source statement] | interest cost tracked separately from ordinary spending and principal payments`

If no excluded items exist, write `None found in reviewed source statements`.

## Final Self-Check

Before presenting the report as authoritative, verify:

- `../budget.md` was not written, edited, or deleted unless the owner explicitly asked for a budget revision.
- Every owner-requested item is represented in `Owner-Requested Items Audit`.
- Found owner-requested items also appear in the relevant treatment sections.
- Every reviewed account/source has report claims that match the account-level source ledger.
- Credit-card payments, debt payments, transfers, refunds, investment movement, and interest/finance charges are excluded from ordinary spending totals and listed above.
- New or unbudgeted ordinary charges still appear in category analysis or `New Or Unbudgeted Items`.
- Any travel/lodging/vacation, large discretionary, or otherwise unusual charge found in source evidence is named explicitly using the exact statement description.
- Subtotal examples list only transactions included in that subtotal, or the report shows separate subtotals for included and excluded/review items.
- Summary numbers match category tables and excluded totals are listed separately.
