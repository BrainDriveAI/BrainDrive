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

For a first-pass statement-backed Budget, `budget.md` must stop being a starter template. Save a provisional draft that includes the target month, observed income, fixed bills, variable category limits, irregular or lumpy set-asides, debt payoff minimums and a concrete extra-payment target, excluded transfers/debt payments, assumptions and confidence, Needs Review, reconciliation check, and changelog entry.

If credit-card APRs and minimum payments are visible, save a Debt Payoff Priority section or rows in `budget.md`, `reports/latest.md`, and the parent Finance plan. The saved payoff target must name Northbridge Rewards Visa at 22.49% APR as priority when present, Summit Trail Mastercard at 20.74% APR as secondary when present, the $139 and $117 minimums when present, the monthly extra-payment target, the total priority-card target payment, and the total monthly card payment target. If using April's natural surplus, pick a conservative explicit amount and mark it draft/owner-confirmed-needed rather than saying only "all extra cash." For the Katie fixture values, keep these canonical values consistent everywhere: extra-payment target $250.00 above minimums, Northbridge target payment $389.00, Summit payment $117.00, total monthly card payment target $506.00. In `budget.md`, do not encode the payoff plan as only `Debt payoff goal | 250.00 | Target minimum payments + extra`; separate minimum payments, extra-payment target, priority-card target payment, and total monthly card payment target.

After saving card payoff guidance, call `project_budget_validate_payoff_plan` with `repair: true`, then read back `budget.md`, `reports/latest.md`, and the parent Finance plan before replying. If validation still fails, avoid claiming the saved payoff plan is consistent and ask one targeted follow-up question.

If uploaded source files were used or reviewed during setup, also populate `reports/latest.md` with a source coverage ledger and any supporting detail that would make the chat reply too dense. The Source Coverage section must list each uploaded file as used, reviewed/excluded, or missing/rejected. Harborline Roth IRA or other investment statements must be listed as reviewed/excluded asset context with no spendable cash-flow impact.

After writing or refreshing `reports/latest.md`, call `project_budget_validate_source_coverage` with `repair: true`, then read the latest Budget report back before replying. If source coverage still has missing uploads, do not claim every uploaded statement was used or accounted for.

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

Separate math reconciliation from unresolved owner-review state. If MJP Services, Blue Door Payment, or another merchant still needs the owner to classify it, include an `Owner review pending` row in `budget.md` with the active amount and merchant names, even when the math subtotal difference is $0.00. The same active Needs Review items must remain visible in `reports/latest.md`, the parent Finance plan, and `me/todo.md` until resolved.

After saving or changing Needs Review state, call `project_budget_reconcile_review_state` with `repair: true`, then read back the parent Finance plan. If Blue Door Payment remains unresolved after MJP Services is classified, the Finance plan must say `Clarify Blue Door Payment ($67.50) to finish the remaining Needs Review item.` and must not say `two unclassified merchants`. If all merchant review items are resolved, the Finance plan must not ask the owner to clarify those merchants or keep active-work phrases such as `mystery transactions` or `ambiguous merchants`; move the next step to the actual remaining open decision, such as `Clarify recurring nature of April auto/vet costs`.

## Done Criteria

`budget.md` has current saved limits, confidence labels, assumptions, Needs Review for unresolved items, a reconciliation check, and changes recorded in the changelog. For first-pass Budget requests, `budget.md` must not still say `Status: Starter template - not yet customized` when you tell the owner a saved Budget exists.

## After Running

Report what changed in the saved Budget, what is still assumed, what evidence was used, and what targeted questions remain. Optionally refresh `reports/latest.md` only if the owner asked for comparison output.

Separate completion state from follow-up state in the final reply:

- Created or updated artifacts.
- Open owner decisions or assumptions.
- Active Todo items that still remain.

Keep the chat reply scan-friendly. Use bullets for the owner-facing summary and keep detailed category tables in the saved Budget or report artifacts unless the owner explicitly asks to see a table in chat. For the first Budget reply after initial statement intake, confirm the draft exists in 80-140 words, use at most 3 short bullets, include at most 3 visible dollar amounts or percentages, and ask only the highest-priority next question. If payoff evidence exists, say the payoff plan is anchored on the highest-APR card and leave the full APR/minimum/extra-payment math in the saved Budget and latest Budget report unless the owner explicitly asks for those numbers in chat. Do not use headings. Do not send full APR tables, full payment ledgers, full category ledgers, raw pipe tables, malformed markdown, dangling emphasis markers, repeated emphasis markers, concatenated category words, jammed amounts such as `pay$117.00`, or adjacent merchant names without line breaks.

End the response with a clear product-facing review affordance sentence, for example: "Your saved Budget is ready to review, and the latest Budget report is available if you want the statement-backed details." Do not use raw file paths in that sentence.

Propagate material state changes back to Finance:

- update `spec.md` so uploaded statement data is not still listed as missing;
- update `plan.md` so the next step advances from statement gathering when appropriate;
- close or revise active `me/todo.md` statement-gathering tasks;
- keep remaining missing history specific by month/account/institution.

When the owner resolves one ambiguous merchant, persist that partial classification immediately. For example, "MJP Services is my therapist" is enough to move MJP Services from Needs Review into Health/Therapy in the saved Budget and latest Budget report, and to close or remove the MJP Todo task while leaving Blue Door active if still unresolved. Do not ask for the rest of the cut-off sentence before saving the supplied merchant-category mapping.

If you tell the owner you updated the Todo list, first write or edit `me/todo.md`, read it back, and verify the promised tasks are present. The final response must not claim Todo list updates unless the verified Todo list contains the task text. When MJP Services, Blue Door Payment, or other clarification questions are resolved, close or revise stale active todos for those questions in the same turn.

Never include internal verification diagnostics such as `Save status`, `Not saved yet`, or `could not verify` in owner-facing replies. If a Todo or artifact write was not verified, omit the save claim and state the recommended next action instead.

If the saved Budget or latest Budget report says Needs Review is zero, none, fully resolved, or all mystery items are categorized, verify `me/todo.md` before replying. Active finance Todo tasks must not still ask the owner to clarify those same resolved merchants or amounts. If such a stale task exists, complete it or remove it before saying Needs Review is resolved.

## What This Procedure Is Not

It is not a monthly comparison workflow. For actuals versus saved budget, use `compare.md`.
