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
- The owner asks a practical-budget comparison follow-up during setup, such as whether April/May spending is over or under, what actual spending looked like against a practical budget, or which transactions remain unclear.

## Method

Read `budget.md`, `budget-rules.md`, `budget-rules-user.md` if present, `statements/README.md`, and relevant statements. Build a source coverage ledger and source evidence ledger before writing the report.

Write `reports/latest.md` by default. Write `reports/monthly-YYYY-MM.md` only after the reported month is closed. Do not answer a comparison request only in chat; the saved latest Budget report is the durable comparison artifact and must be populated before the final comparison reply.

The latest Budget report must include Source Coverage with every uploaded file assigned to one of these groups:

- Used for Budget calculations.
- Reviewed and excluded from spending calculations, with reason.
- Missing or rejected files, with reason.

Investment and retirement statements, including Roth IRA statements, belong in reviewed/excluded asset context unless the owner explicitly asks for asset tracking. They must not affect spendable income, personal living expenses, debt payoff cash flow, or ordinary spending variance.

Do not claim every transaction was mapped unless the Source Evidence Ledger accounts for every transaction in the relevant source statements. If the ledger is selective, say it is selective and limit claims to the rows reviewed.

Separate ordinary spending from transfers, refunds, debt payments, finance charges, fees, investment movement, and business/startup spending. Show exclusions in the Excluded From Expense Totals section.

Before finalizing, run these reconciliation checks:

- Category Breakdown spent total equals visible category rows.
- Report summary totals equal visible rows plus named exclusions/adjustments.
- Excluded money movement totals equal the Excluded From Expense Totals rows.
- Needs Review rows are excluded from confident totals unless explicitly included and labeled.
- Any owner-named item found in source evidence appears in the audit and a final treatment section.

If any check fails, mark the report Needs Review, show the exact unreconciled amount, and do not present the result as final or fully trustworthy.

## Required `reports/latest.md` Content

A blank starter `reports/latest.md` is an invalid comparison result. Before replying that a comparison is complete, read the report back and confirm it has non-empty values for Month, Generated, Source statements, Summary totals, at least one Source Evidence Ledger row, at least one Category Breakdown row, Needs Review treatment when unclear items remain, and Reconciliation Check statuses.

## Done Criteria

The report includes Summary, Source Coverage, Source Evidence Ledger, Owner-Requested Items Audit, Category Breakdown, New Or Unbudgeted Items, Excluded From Expense Totals, Needs Review, Reconciliation Check, Next Actions, and a consistency check.

## After Running

Report what changed using owner-facing labels, update reports, summarize material parent-level changes briefly in spec or plan only when needed, add todos only for concrete next actions, and return to Finance scope. If statement uploads were accepted during this run, update Finance spec, Finance plan, and Todo list so completed statement gathering is not still active.

Separate completion state from follow-up state in the final reply:

- Created or updated artifacts.
- Open owner decisions or assumptions.
- Active Todo items that still remain.

Keep the chat reply scan-friendly. Use bullets for the owner-facing summary and keep detailed variance, reconciliation, and exclusion tables in the saved report artifact unless the owner explicitly asks to see a table in chat. For comparison replies, send one sentence summary, up to three bullets, and one next action, staying between 100-160 words and no more than 5 visible dollar amounts or percentages unless the owner explicitly asks for a table. Do not send raw pipe tables, full over/under tables, full reconciliation tables, malformed markdown, dangling emphasis markers, repeated emphasis markers, concatenated category words, jammed amounts, or adjacent merchant names without line breaks. If source gaps or Needs Review items remain, use cautious wording and avoid overconfident payoff language.

End the response with a clear product-facing review affordance sentence, for example: "The latest Budget report is ready to review, with unresolved items still marked Needs Review." Do not use raw file paths in that sentence.

If the final response says Todo list tasks were added or updated, verify that `me/todo.md` changed and contains those tasks before sending the response. If the todo write cannot be verified, list the recommended next actions without saying they were saved.

Never include internal verification diagnostics such as `Save status`, `Not saved yet`, or `could not verify` in owner-facing replies. If a Todo or artifact write was not verified, omit the save claim and state the recommended next action instead.

If this comparison resolves a Needs Review item such as MJP Services or Blue Door Payment, read `me/todo.md` and close, complete, or remove any active clarification Todo for that same merchant/amount before saying all review items are resolved. If Todo cleanup cannot be verified, say the report is updated but the Todo list may still need cleanup.

If the owner provides one merchant-category mapping in a cut-off message, save the resolved item immediately and leave only the still-unknown item in Needs Review. "MJP Services is my therapist" is enough to classify MJP Services as Health/Therapy even if the next sentence is incomplete.

## What This Procedure Is Not

It is not permission to change the saved budget. Put recommended saved-budget changes in Next Actions unless the owner explicitly asks for revision.
