# Budget — Agent Context

*Orient file for the Budget app. Read first whenever the owner invokes anything budget-related. Carries the app's preservation rules, OAPEP flow, procedure routing, and propagation guidance. For current state, see `budget.md` in this folder.*

## What This App Does

The Budget app has two jobs:

1. **Maintain a stable saved monthly spending plan** the owner recognizes as theirs — categories, limits, fixed bills, goals.
2. **Produce useful comparisons** between actual spending and the saved plan — without rewriting the plan in the process.

The hard part is keeping these two jobs cleanly separated. Comparison mode must not silently mutate the saved budget.

## App-Level Flow

Budget work follows the same fractal OAPEP cycle as the rest of BrainDrive:

1. **Orient** — read this file first, then read `budget.md` and only the rules, sources, or reports needed for the current request.
2. **Align** — clarify whether the owner wants to create, revise, or compare.
3. **Plan** — choose the right procedure and identify needed sources.
4. **Execute** — update `budget.md` or generate `../reports/latest.md`.
5. **Propagate** — update Finance-level artifacts when budget work materially changes the project picture.

This cycle lives in procedure, not in additional files. The Budget app doesn't need its own `spec.md` or `plan.md` — those live at the Finance project level.

## Preservation Rule

`budget.md` is the **saved monthly spending plan**. Preserve it unless the owner is explicitly creating, revising, or approving changes.

**Safe to write `budget.md` when the owner asks to:**
- Create a first budget
- Revise category limits
- Add, remove, or rename saved categories
- Update fixed bills or budget goals
- Approve recommended budget changes

**Read-only during comparison mode.** When the owner says any of:
- *"How did I do?"*
- *"Compare this month"*
- *"Am I over budget?"*
- *"Leave the saved budget alone"*
- *"Compare against the saved budget"*

…then `budget.md` is read-only for that turn. Comparison findings go to `../reports/latest.md`, never into `budget.md`. If comparison reveals the saved plan should change, list recommendations under "Next Actions" in the report and wait for the owner to ask for a budget revision.

**Category stability matters.** Reports and rules reference category names. Add, remove, or rename categories only when the owner understands the change and it matches how they want to think about spending.

**Preserve the file structure when updating.** Update sections in place; never replace the whole file.

## Procedures

Start here, then read only the listed workflow file needed for the current request.

| Owner wants to... | Read |
|---|---|
| Create or revise the saved budget | `create.md` |
| Compare actual spending against the saved budget | `compare.md` |
| Categorize transactions | `budget-rules.md` + `../statements/README.md` |
| Write or refresh a budget report | `compare.md` + `../reports/README.md` |
| Correct a category or transaction type | `budget-rules.md`; re-read affected statement if relevant |

## After Running

1. **Update the relevant artifact** — `budget.md` for create-or-revise, `../reports/latest.md` for comparison. Don't update `budget.md` as a side effect of comparison. If the owner explicitly asks for both a revision and a comparison, complete them as separate steps and make the write boundary explicit in the chat.
2. **Update Status and "Last updated"** at the top of `budget.md` if you wrote to it.
3. **Log material changes to `budget.md` changelog** — new category, revised limit, fixed bill added/removed. Skip cosmetic edits.
4. **Show the artifact in chat** — don't just say it was saved.

## Propagate

After budget work, update higher-level Finance files only when the result materially changes project state.

Examples:

- Update `../spec.md` "Where You Are" when debt balance, savings, income, or monthly burn changes materially.
- Update `../plan.md` when a phase completes, a blocker clears, or the next step changes.
- Don't copy full budget tables or report sections into `../spec.md` / `../plan.md`. Summarize only the project-level implication (e.g., *"Card 1 balance now $4,200, down from $5,400"* — not the full transaction list).

Propagation is not automatic. If the work is routine (a normal monthly comparison with no material change), there's nothing to propagate. The goal is signal, not noise.

## What This App Is Not

- **Not a one-shot.** Budgets get revised. Run procedures again whenever the owner wants to update the saved plan or compare a new month.
- **Not a comparison-mode editor.** Never write `budget.md` during a comparison. Recommendations go in the report's "Next Actions"; the owner asks for revisions separately.
- **Not a data-quality auditor.** Flag missing or ambiguous data, but ship the report with what you have. Provisional and useful beats stalled and complete.
- **Not a place for emotional or relationship context to replace numbers.** Those add context after the artifact; they don't replace it when the owner asked for the math.
