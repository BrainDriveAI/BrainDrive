# Create Or Revise Saved Budget

*Procedure for creating or intentionally revising `budget.md`.*

## Preservation Rule

Update sections in place in `budget.md`; never replace the whole file. Always keep every section header, every italic section description, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`. Use today's date from system context for Last updated and changelog entries.

## What This Procedure Accomplishes

Create a usable saved monthly budget or update an existing saved budget when the owner explicitly asks for that change.

The saved Budget is the primary working artifact. Statement analysis is supporting evidence, not the center of the workflow, unless the owner explicitly asks for an actuals comparison.

## When to Run

- The owner asks to create a budget.
- The owner explicitly asks to revise saved limits, fixed bills, goals, or budget notes.

## Method

Start by telling the owner you are creating or updating the saved Budget. Explain the sections you will build: fixed obligations, variable categories, irregular costs, transfers/account movement, business or startup funding, assumptions, confidence, and next review items.

Use owner estimates and available statements. Label assumptions, ask about material unknowns, and keep owner-approved rules in `budget-rules-user.md`.

If statements are needed, ask the owner to attach them in chat or use the visible upload button. Do not ask the owner to place files into `documents/...` paths. State the requested statement set as a checklist, then update Received and Still Needed after each upload or batch.

Before creating a statement-backed baseline, read the uploaded source evidence in `statements/`, confirm the covered months/accounts, and label any missing or partial evidence clearly.

One month of statements may produce a draft actuals baseline only. Do not call it a stable monthly budget unless the owner confirms the month is representative. Ask for 3-6 months of checking and credit-card history, plus known annual or irregular costs such as property tax, insurance, medical, therapy, travel, home, family, and startup funding.

Do not wait for perfect categorization before saving a first-pass Budget. If transactions such as MJP Services, Blue Door Payment, or other material items are unclear, save the draft Budget anyway and place them in a Needs Review section with the temporary treatment you used. Ask the owner targeted follow-up questions only after the saved Budget draft exists.

For a first-pass statement-backed Budget, `budget.md` must stop being a starter template. Save a provisional draft that includes the target month, observed income, fixed bills, variable category limits, irregular or lumpy set-asides, debt payoff minimums and extra-payment target, excluded transfers/debt payments, assumptions and confidence, Needs Review, reconciliation check, and changelog entry.

Separate ordinary personal living spend from transfers, refunds, debt payments, investment movement, and business/startup spending. Do not treat account movement as category spending.

Each major budget row must carry a confidence label in the Notes column or in an Assumptions And Confidence section:

- Known fixed
- Observed recurring
- One-month observed
- Owner-estimated
- Irregular/lumpy
- Transfer/account movement
- Business/startup
- Needs more history

Before saving, reconcile target personal living spend against visible budget rows:

- fixed bills subtotal;
- variable category subtotal;
- irregular monthly set-aside subtotal;
- excluded transfers/account movement;
- business/startup spending separated from personal spend;
- total included personal living spend.

If any stated target or subtotal does not equal the visible rows plus named exclusions, add a Reconciliation Check marked Needs Review and show the unreconciled amount. Do not present the budget as final.

## Done Criteria

`budget.md` has current saved limits, confidence labels, assumptions, Needs Review for unresolved items, a reconciliation check, and changes recorded in the changelog. For first-pass Budget requests, `budget.md` must not still say `Status: Starter template - not yet customized` when you tell the owner a saved Budget exists.

## After Running

Report what changed in the saved Budget, what is still assumed, what evidence was used, and what targeted questions remain. Optionally refresh `reports/latest.md` only if the owner asked for comparison output.

Keep the chat reply scan-friendly. Use bullets for the owner-facing summary and keep detailed category tables in the saved Budget or report artifacts unless the owner explicitly asks to see a table in chat. Do not send malformed markdown, dangling emphasis markers, or concatenated category words.

Propagate material state changes back to Finance:

- update `spec.md` so uploaded statement data is not still listed as missing;
- update `plan.md` so the next step advances from statement gathering when appropriate;
- close or revise active `me/todo.md` statement-gathering tasks;
- keep remaining missing history specific by month/account/institution.

If you tell the owner you updated the Todo list, first write or edit `me/todo.md`, read it back, and verify the promised tasks are present. The final response must not claim Todo list updates unless the verified Todo list contains the task text. When MJP Services, Blue Door Payment, or other clarification questions are resolved, close or revise stale active todos for those questions in the same turn.

If the saved Budget or latest Budget report says Needs Review is zero, none, fully resolved, or all mystery items are categorized, verify `me/todo.md` before replying. Active finance Todo tasks must not still ask the owner to clarify those same resolved merchants or amounts. If such a stale task exists, complete it or remove it before saying Needs Review is resolved.

## What This Procedure Is Not

It is not a monthly comparison workflow. For actuals versus saved budget, use `compare.md`.
