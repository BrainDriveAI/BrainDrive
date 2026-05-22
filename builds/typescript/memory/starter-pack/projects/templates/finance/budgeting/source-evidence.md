# Source Evidence Rules

Use this when reading uploaded statements, classifying transactions, searching for owner-named items, or preparing source evidence for a budget report.

## Source Discovery

Before saying a statement or transaction is missing:

- Inspect the Finance file list and `../statements/`.
- Search likely converted filenames, statement periods, institution names, account names, and uploaded paths from the upload confirmation.
- Remember that statement-cycle filenames may use the starting month, ending month, account name, or converted upload name.
- For monthly reports, read statement files whose statement period overlaps the requested date range; do not rely only on filenames containing the target month.

## Duplicate And Overlap Check

Before using newly uploaded statements for budget reporting, check for likely duplicate or overlapping source files by:

- institution,
- account,
- statement period,
- transaction dates,
- obvious repeated transaction rows.

If an upload appears to overlap existing evidence, ask the owner whether to replace, merge, or skip before counting transactions. Do not silently double-count overlapping periods.

## Evidence Ledger

Build a source evidence ledger before summarizing a monthly comparison.

At minimum, capture:

- date,
- exact statement description,
- amount,
- account/source file,
- transaction type,
- proposed category,
- whether the item is ordinary spending, excluded money movement, or needs review.

Treat ledger rows as locked evidence for the report turn. If an item is found in a reviewed source statement and is owner-named, new/unusual, material, excluded, or needs review, it must appear in the final report.

## Owner-Requested Items

Extract owner-requested merchant, item, trip, bill, and transaction names from the current request and recent follow-ups.

Search exact names and close variants across relevant source statements before marking anything absent.

Do not claim a named merchant or transaction is missing unless you can say which source files and date ranges were checked.

If you previously identified a named item in the conversation, do not later write "not found", "no charge appears", or similar absence language unless you re-read the relevant source statements and determine the earlier identification was wrong. If that happens, explain the correction with checked files/date ranges.

If the owner suggests a named transaction is absent but source statements show it, trust the statement evidence and report the discrepancy as a clarification item.

## New, Unusual, And Ambiguous Items

Always scan uploaded checking and credit-card transactions for:

- new merchants,
- unusual charges,
- travel,
- lodging,
- vacation,
- entertainment,
- shopping,
- unclear merchants,
- large discretionary purchases.

Include these in `New Or Unbudgeted Items` or `Needs Review` even when total ordinary spending is under budget.

Use exact statement descriptions for listed transactions so the owner can trace them back to source evidence.
