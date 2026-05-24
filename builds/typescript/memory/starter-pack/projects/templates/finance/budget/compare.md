# Compare a Month Against the Saved Budget

*Workflow for producing a monthly comparison report. Use when the owner asks "how did I do?", "compare this month", "am I over budget?", or otherwise wants actual spending compared against the saved plan.*

*Always read `AGENT.md` first for the Preservation Rule. During this workflow, `budget.md` is read-only — do not write to it under any circumstances.*

## Inputs

Read:

- `budget.md` — the saved plan (read-only this turn)
- `budget-rules.md` — owner-approved categorization rules
- `../statements/README.md` for source conventions, then the relevant statement files for the requested month
- `../reports/README.md` — the output contract for what the report must contain

Don't generate a comparison report from conversation memory alone.

## Reading Discipline

Apply these rules when reading statements for monthly comparison.

### Source Evidence Ledger

Build a source evidence ledger before summarizing. **Treat ledger rows as locked evidence for the turn.**

At minimum, capture per transaction:

- date
- exact statement description
- amount
- account / source file
- transaction type
- proposed category
- whether the item is ordinary spending, excluded money movement, or needs review

Also keep an account-level reconciliation summary for every reviewed statement:

- account / source name
- source file
- ordinary spending row count and total
- credit-card / debt payment row count and total
- finance-charge or fee row count and total
- income / credit / refund row count and total
- needs-review row count

If an item is owner-named, new, unusual, material, excluded, or needs review, it must appear in the final report.

Account-level facts are also locked evidence. If a reviewed account has ordinary spending rows, don't later say it had zero active purchases. If a reviewed account has finance charges, don't say there were no interest charges. If a report needs to change one of these facts, re-read the source statement and explain the correction.

### Owner-Requested Items

Extract owner-requested merchant, item, trip, bill, and transaction names from the current request and recent follow-ups.

Search exact names and close variants across relevant source statements before marking anything absent.

Don't claim a named merchant or transaction is missing unless you can say which source files and date ranges were checked.

If you previously identified a named item in the conversation, don't later write *"not found"*, *"no charge appears"*, or similar absence language unless you re-read the relevant source statements and determine the earlier identification was wrong. If that happens, explain the correction with checked files and date ranges.

If the owner suggests a named transaction is absent but source statements show it, trust the statement evidence and report the discrepancy as a clarification item.

### New, Unusual, and Ambiguous Items

Always scan uploaded checking and credit-card transactions for:

- new merchants
- unusual charges
- travel, lodging, vacation
- entertainment, shopping
- unclear merchants
- large discretionary purchases

Include these in `New Or Unbudgeted Items` or `Needs Review` even when total ordinary spending is under budget.

Use exact statement descriptions for listed transactions so the owner can trace them back to source evidence.

## Behavior

- Answer direct comparison questions with a best-effort report from available evidence before asking extra clarification questions.
- Preserve existing category names whenever possible.
- Put new or uncategorized spending into practical buckets plus "needs review" instead of silently changing the saved budget.
- Separate expenses from income, transfers, credit-card payments, refunds, fees, debt payments, finance charges, and investment movement.
- Don't include investment-account movement in ordinary expense-budget totals unless the owner explicitly asks.
- If source evidence is incomplete, duplicated, ambiguous, or partially parsed, say so and mark affected sections provisional.
- If the saved budget appears unrealistic or needs new categories, list recommendations in the report's "Next Actions" — don't apply them to `budget.md`.

## Output

- Write findings to `../reports/latest.md` (working cache — overwritten each run) following the contract in `../reports/README.md`.
- Also write a dated archive `../reports/monthly-YYYY-MM.md` when the conditions in `../reports/README.md` § "When to Save a Dated Archive" apply (closed month, owner asks to preserve, material change worth permanent record).
- `budget.md` is unchanged.
- Show the same practical artifact in chat: category actuals, saved limits, over/under status, confidence, material new or unusual items, excluded money movement, needs-review items, assumptions.
- Numbers in chat must match the report.

## Done Criteria

Monthly Comparison is done when:

- `../reports/latest.md` contains every required section from `../reports/README.md`
- Source-to-report reconciliation has been performed (per `../statements/README.md` ledger rules + the Reading Discipline above)
- Owner-requested items have been audited and explicitly treated in the report
- `budget.md` is unchanged (verify before declaring done)
- Chat artifact matches the report numbers exactly

If any are "no" or "kinda" — keep working before presenting as done.

## Propagation Trigger

After the report is written: if the comparison shows meaningful progress or a material change (debt balance dropped notably, savings rate shifted, a recurring issue surfaced, a Phase 1 milestone hit), follow the Propagate rules in `AGENT.md` to update `../spec.md` "Where You Are" or `../plan.md` phase status. Summarize the implication; don't copy report content.
