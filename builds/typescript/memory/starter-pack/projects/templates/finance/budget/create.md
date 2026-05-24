# Create or Revise the Saved Budget

*Workflow for creating a first budget or revising the saved one. Use when the owner asks to create a budget, revise category limits, add/remove/rename categories, update fixed bills, or set a budget goal.*

*Always read `AGENT.md` first for the Preservation Rule before writing to `budget.md`.*

## Inputs

Read:

- `budget.md` — the current saved plan, if any
- `budget-rules.md` — owner-approved categorization and transaction-type rules
- `../statements/README.md` then relevant files in `../statements/` — if uploaded statements are available or the owner asks to use them
- `../spec.md` and `../plan.md` — when broader goals matter (debt payoff target, savings goal, etc.)

## Behavior

- Use owner estimates, uploaded statements, or both.
- Label assumptions and uncertain items plainly.
- Put ambiguous merchants or missing context in "needs review" instead of inventing precision.
- Keep categories stable where possible so future reports can compare against the same plan.
- Add or change categories only when the owner understands the change and it matches how they want to think about spending.
- Emotional or relationship context can inform the budget, but don't let it replace the budget artifact when the owner asked for numbers. If partner context matters, add a brief note or follow-up after the artifact.
- A provisional but useful budget beats no budget. Don't wait for perfect information.

## Output

- Update `budget.md` (in place — preservation rule) with the saved plan.
- Show the useful artifact in chat: category limits, observed actuals when available, fixed bills, confidence, assumptions, and needs-review items.
- Don't just say the file was saved.
- Treat a provisional budget as usable work. It's okay to say the numbers aren't final, but don't frame the budget as merely a conversation starter after showing the requested draft.

## Done Criteria

Create-or-Revise is done when:

- `budget.md` has Monthly Context filled (at least target month and expected income)
- At least one Category Limit reflects the owner's actual situation, not just starter scaffolding
- Fixed Bills captures the predictable monthly commitments the owner named
- Owner has seen the budget artifact in chat and either confirmed or flagged for revision
- "Last updated" and Status at the top of `budget.md` are current
- If a material change to the budget structure, the change is logged in `budget.md`'s changelog
