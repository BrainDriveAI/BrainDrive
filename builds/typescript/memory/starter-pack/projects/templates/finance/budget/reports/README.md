# Reports — Output Contract

*Contract for the `reports/` folder. Defines what reports must contain, naming conventions, and validation requirements. Read this when writing or refreshing a report. Procedural how-to for producing reports lives in the relevant app's workflow file (e.g., `../budget/compare.md` for monthly comparisons).*

## What This Folder Contains

Generated reports from Finance apps. Two roles served by two file types:

- `latest.md` — **working cache** of the most recent generated report (overwritten on each run). Useful for continuity across sessions and quick re-reference. Not the canonical history.
- `monthly-YYYY-MM.md` — **durable archived report** (e.g., `monthly-2026-05.md`). Preserved as stable history once a month is closed. Owner reads these to see trends and audit past results.

Other apps may add their own report types (e.g., `net-worth-latest.md`, `quarterly-2026-Q1.md`, `annual-2026.md`). Use a clear period-based filename for archived snapshots — examples include `monthly-2026-05.md`, `quarterly-2026-Q1.md`, `annual-2026.md`.

This is the **Reports** primitive — synthesis outputs the owner reads. Reports are generated, not edited by hand. Reports are not source of truth; source files (`../statements/`) and app state (`../budget/budget.md`) remain the truth. The agent writes reports per the contract below.

## File Conventions

- **Format:** Markdown.
- **Naming:** `latest.md` for the working cache; `monthly-YYYY-MM.md` (or other `<period>-<id>.md` patterns) for archived snapshots.
- **Lifecycle:** `latest.md` is always overwritten on each run. Archived snapshots are preserved unless the owner explicitly removes them.
- **Owner edits:** Reports are generated; owners normally don't edit them. If the owner wants to capture insight from a report, the right move is to update `../budget/budget.md`, `../spec.md`, or `../plan.md` — not the report itself.

## When to Save a Dated Archive

Every comparison run writes to `latest.md`. **The dated archive (`monthly-YYYY-MM.md`) has stricter rules — read these before writing one.**

**Default: do NOT write a dated archive.** Write `latest.md` only.

**Write a dated archive only when one of these is true:**

- **The reporting period is fully complete** — today's date is *after* the last day of the period being reported. E.g., write `monthly-2026-05.md` only when today is 2026-06-01 or later. If today falls within the period being reported (e.g., today is 2026-05-24 and the report covers May 2026), the month is still open — **write `latest.md` only, do not archive**.
- **The owner explicitly asks** to preserve this specific report.
- **The comparison surfaces a milestone** worth permanent record (debt payoff completed, savings goal hit) AND the owner confirms they want it archived.

**Anti-pattern (do not do this):** Writing `monthly-YYYY-MM.md` while the reported month is still in progress. The archive is for *closed* periods. Writing it mid-month creates a snapshot the next comparison will need to overwrite — defeating the purpose of "durable archive."

When in doubt, **write `latest.md` only**. The archive is the exception, not the default. Over-archiving creates a graveyard of stale snapshots.

## Output Contract — Monthly Comparison Report

Every monthly comparison report must contain these sections, in this order:

1. Summary
2. Source Coverage
3. Source Evidence Ledger
4. Owner-Requested Items Audit
5. Category Breakdown
6. New Or Unbudgeted Items
7. Excluded From Expense Totals
8. Needs Review
9. Next Actions
10. Final Self-Check

The literal heading `Excluded From Expense Totals` is required. Don't replace it with a differently-named section like *"Interest Charges"* or *"Credit Card Balance Tracking."* Those can be additional sections, but they don't replace the required exclusion section.

### Section Requirements

**Summary**
A brief readable overview of the month: total spent, over/under, key categories of concern. Numbers must match the Category Breakdown.

**Source Coverage**
Every statement file read for the comparison. Include files read because their statement period overlaps the requested month even if their filename month differs.

**Source Evidence Ledger**
Locked evidence for the report turn — named, new, unusual, material, excluded, or needs-review transactions. Capture per transaction: date, exact statement description, amount, account/source file, transaction type, proposed category, treatment. Plus an account-level reconciliation summary for every reviewed statement. (Building the ledger is procedural; see `../budget/compare.md` § Reading Discipline.)

**Owner-Requested Items Audit**
Reconcile every merchant, item, trip, bill, or transaction the owner specifically asked about. List each requested item, search result, sources checked, exact source match, amount, date, and final report treatment.

If a requested item is not found, say which source files / date ranges were checked. If uncertain, mark `Needs Review` rather than omitting.

**Category Breakdown**
Use saved category names from `../budget/budget.md`. The spent amount for each category equals the sum of included in-month expense transactions for that category.

Put categories or merchants not present in `../budget/budget.md` in `New Or Unbudgeted Items` instead of silently changing the saved budget.

When writing subtotal sentences, make the included set explicit. If a subtotal excludes `Needs Review`, refunds, finance charges, or other excluded rows, label it that way. Don't list excluded rows in the parenthetical examples for that subtotal.

The summary must match the category tables. If a category is under budget in its detail section, don't list it as over budget in the summary.

**New Or Unbudgeted Items**
Spending that doesn't fit existing categories. Use exact statement descriptions so the owner can trace transactions back to source evidence.

**Excluded From Expense Totals**
Income, transfers, credit-card payments, refunds, finance charges, debt payments, and investment movement that should not count as ordinary expense spending.

Required treatment when present in source statements:

- `Debt payment | [source payee/account] | [amount] | [source statement] | credit-card/debt payment or transfer, not ordinary spending`
- `Finance charge | [source account] | [amount] | [source statement] | interest cost tracked separately from ordinary spending and principal payments`

If no excluded items exist, write `None found in reviewed source statements`.

**Needs Review**
Ambiguous merchants, unclear charges, or items the agent isn't confident classifying. Better to surface for owner review than invent precision.

**Next Actions**
Concrete owner-facing recommendations. If the comparison surfaced that the saved budget should change, list those recommendations here — not in `../budget/budget.md` directly.

**Final Self-Check**
Before presenting the report as authoritative, verify and document the verification in this section:

- `../budget/budget.md` was not written, edited, or deleted unless the owner explicitly asked for a budget revision.
- Every owner-requested item is represented in `Owner-Requested Items Audit`.
- Found owner-requested items also appear in the relevant treatment sections.
- Every reviewed account/source has report claims that match the account-level source ledger.
- Credit-card payments, debt payments, transfers, refunds, investment movement, and interest/finance charges are excluded from ordinary spending totals and listed in `Excluded From Expense Totals`.
- New or unbudgeted ordinary charges appear in category analysis or `New Or Unbudgeted Items`.
- Travel/lodging/vacation, large discretionary, or otherwise unusual charges from source evidence are named explicitly using the exact statement description.
- Subtotal examples list only transactions included in that subtotal, or the report shows separate subtotals for included and excluded/review items.
- Summary numbers match category tables and excluded totals are listed separately.

## Source-to-Report Reconciliation

Before saving or presenting any report, proofread the report against the Source Evidence Ledger instead of relying on conversation memory.

For each reviewed account/source:

- If the ledger has ordinary spending rows, the report must not claim that account had zero active purchases, zero active charges, no spending, or $0 in new purchases.
- If the ledger has credit-card payments, debt payments, transfers, refunds, income, or other excluded movement, the report must list the treatment in `Excluded From Expense Totals` or clearly explain the equivalent treatment.
- If the ledger has finance charges or fees, the report must mention them separately from ordinary spending and debt principal payments.
- If the ledger has needs-review rows, the report must preserve a `Needs Review` treatment unless the owner has already categorized them.
- If a summary sentence, source coverage row, category table, or next action contradicts the ledger, revise the report before answering.

Only write `none`, `no`, `zero`, `not found`, or `$0` claims after checking the relevant source files and account-level ledger summary.
