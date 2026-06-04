# Finance Planning

*Procedure for filling `plan.md` from the Finance spec.*

## Preservation Rule

Update sections in place in `plan.md`; never replace the whole file. Always keep every section header, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`. Use today's date from system context for Last updated and changelog entries. Remove author-only helper text and starter placeholders from filled sections; owner read mode should show owner-specific plan content, not template instructions.

## What This Procedure Accomplishes

Turn the Finance spec into an ordered, typed, traceable sequence with one immediate step, a clear `Priority Order`, a practical roadmap, owner-review points, and clear blockers.

## When to Run

- The Finance spec has enough information to plan.
- New financial facts materially change the current plan.
- The owner asks what to do next.
- The owner adds material planning context after a plan already exists, including regulated-boundary context such as a Roth IRA, 401(k), investment account, tax, legal, insurance, or debt-settlement boundary.

## Method

### 1. Context Intake

Before planning, read or attempt to read `me/profile.md`, `AGENT-user.md` if present, `spec.md`, and `plan.md`. Read child-app summaries or Budget reports only when they directly affect the plan. Use known context first and do not ask broad setup questions for facts already present. Do not use broad `memory_search` or read unrelated project instructions/specs during parent Finance planning. Do not read Budgeting app detail files, transaction evidence, or unrelated project specs unless the plan step needs that evidence.

### 2. Planning

Lead with the owner's most urgent confirmed financial outcome. Show the math when it changes priority. Keep later phases high-level until earlier phases are complete.

Use precise cash-flow terms. Do not call income, take-home pay, or remaining cash "overhead." Say "monthly take-home income," "fixed expenses," "remaining after rent before other fixed bills," and "missing spending evidence" as applicable.

Each plan step must include:

- step type: owner decision, data gathering, execution work, or child-app handoff;
- status;
- owner-facing next action;
- rationale;
- trace to a Finance goal, constraint, risk, or missing-information need.

Owner edits to priority, timing, risk tolerance, or assumptions should preserve the reason for the change.

Durable Finance plans must include these explicit sections when relevant information exists: `Priority Order`, `Owner Decisions`, `Planning Guardrails`, `Data-Gathering Steps`, `Execution Steps`, and `Child-App Handoffs`. Put `## Priority Order` immediately after `## Right Now - Your First Step`. The section must use the words `priority` or `order` and should make the first, second, and third priorities explicit. Regulated-boundary context that constrains the plan, such as a Roth IRA remaining retirement-only, belongs in `Owner Decisions` or `Planning Guardrails`.

When creating or activating a Finance plan, also update `spec.md` so its `## The Plan` section does not contradict the active plan. If the spec status says the plan is active, replace `Not captured yet.` under `## The Plan` with `Plan active. See Your Plan for the current roadmap and first action.` or a one-sentence parent-plan summary. Read the spec back before saying both Finance goals and Your Plan are active.

Frame retirement contribution changes as owner decisions or review points, not immediate commands. Use this exact plan-scope wording when a Roth IRA affects the plan: "The Roth IRA is not a funding source for this Finance plan." Continue with: "Do not use it for credit-card payoff, the starter buffer, or rent protection. Any contribution change or withdrawal is a separate owner decision with tax and retirement tradeoffs." Do not present contribution pausing as the obvious fast-debt lever. Do not explain Roth withdrawal mechanics unless explicitly asked. Do not say contributions or earnings should "stay invested." Do not say to throw cash at credit cards or burn down debt. If a plan label is needed, use `Roth IRA contribution pause/reduce decision`; do not write malformed labels such as `Roth IRA Contribution Pacify/Pause`. Do not recommend specific funds, securities, trades, allocations, contributions, or withdrawals.

If the owner names a specific regulated-boundary asset or account after the plan is created, update `plan.md` in the same turn before sending the final answer. Preserve the exact owner-stated term. For a Roth IRA, add or update:

- `Planning Guardrails`: `Roth IRA: planning context only; not spendable cash; not part of cushion or debt payoff math; no fund, trade, security, or allocation recommendations.`
- `Owner Decisions`: `Roth IRA boundary: The Roth IRA is not a funding source for this Finance plan. Do not use it for credit-card payoff, the starter buffer, or rent protection. Any contribution change or withdrawal is a separate owner decision with tax and retirement tradeoffs.`

After writing, read `plan.md` back and verify the exact term, such as `Roth IRA`, is present before telling the owner the boundary is in Your Plan.

### 3. Budgeting Handoff Gate

Route a step to Budgeting only when the goal or plan needs spending visibility, spending targets, or statement-period reconciliation. Finance can complete Align + Plan without statement uploads or a saved Budget. Keep non-budget goals in Finance planning instead of forcing a Budget workflow.

Credit-card statement PDFs can remain parent Finance data gathering when the only purpose is APR, balance, due-date, or minimum-payment evidence for a debt-payoff plan. Label that purpose explicitly and do not imply transaction Budgeting unless the owner chooses spending visibility, spending targets, or statement-period reconciliation.

For parent Finance debt evidence, phrase uploads as optional support for balance, APR, due date, and minimum payment only. Do not call those files Budget materials, Budget setup, transaction review, spending analysis, or statement-period reconciliation unless the owner has chosen a Budgeting handoff.

When source statements or other evidence have just been uploaded and accepted, advance the plan from gathering evidence to the next validation or refinement step. Do not leave statement upload as pending if the needed files are now present; list only the specific months/accounts/institutions still missing.

Do not copy full Budget reports, source ledgers, or transaction details into `plan.md`; preserve only the parent-level outcome, blocker, handoff, or next action.

### 4. Write Placement

Write new information at the narrowest correct level:

- stable cross-project owner facts to `me/profile.md` after confirmation when inferred or sensitive;
- Finance goals, current state, constraints, assumptions, success criteria, risks, and missing information to `spec.md`;
- ordered steps, status, priorities, rationale, blockers, and child-app handoffs to `plan.md`;
- the single immediate owner action from `Right Now - Your First Step` to `me/todo.md` as one concise `#finance` task after the plan is saved and read back;
- Budget execution detail to the Budgeting child app.

If the first action mentions APRs, minimums, statements, app screenshots, or debt-term evidence, write the active Todo with these exact objects preserved: `Gather credit-card statement/app evidence showing APRs and minimum payments for each card #finance`. If cash on hand or must-pays are also needed, keep them in `Priority Order` or staged plan bullets unless they can be added without weakening the statement/app evidence contract. Do not shorten `minimum payments` to only `minimums`.

Do not use markdown tables in Finance spec or plan. Use bullets and numbered lists instead so owner-visible document surfaces do not show raw pipe characters.

Keep sensitive Finance-only details in `spec.md` unless the owner confirms profile placement. Use calibrated destination language that acknowledges missing evidence; do not promise permanent security, zero dread, guaranteed outcomes, or month-by-month certainty from estimates. If you claim an Owner Profile update, read it back before replying.

## Done Criteria

`plan.md` names the first step, `Priority Order`, roadmap, destination, remaining blockers, owner decisions, planning guardrails, data-gathering steps, execution steps, and child-app handoffs. Steps are typed, statused, traceable to the spec, and do not copy full reports into the plan. If only one active Todo is appropriate, the remaining missing-evidence steps are explicitly labeled later, deferred, or staged after the first action so they are not forgotten. If retirement or investment boundaries were discussed, the plan includes the exact Roth IRA funding-source boundary and decision point without specific investment advice.

## After Running

Report what changed, update `plan.md`, update `spec.md` if the spec has a stale `## The Plan` placeholder, add exactly one Todo for the immediate owner action in the current active plan phase, and return to Finance scope. Deferred or later-phase plan steps stay in Your Plan and should not become Todo list items until they become the next active owner action. Read the Todo list back before saying immediate actions were saved. After creating the Finance spec and plan, use this chat pattern and do not add a plan summary: `Done. I saved your Finance goals and Your Plan. Your first step this week: gather credit-card statement/app evidence showing APRs and minimum payments for each card. Open Your Plan for the full roadmap.` In all chat after artifact writes, stay under 80 words or 500 characters, summarize only artifact changes and the next step, and avoid exposing raw paths unless asked. Never use markdown tables in chat or Finance documents; put table-like details in Your Plan as bullets or numbered lists. Never say "completed, verified, and saved"; say "I saved this to Your Goals/Your Plan." Never say "saved Budget" or "Budget materials" during parent Finance planning unless the Budgeting child app was active and a Budget artifact was written and read back. Budgeting deferral is conditional: Budgeting is not needed for the next step, and the plan should revisit it if spending visibility, spending targets, or statement-period reconciliation become necessary. Do not say Budgeting is bypassed, paused indefinitely, or that the goals can be achieved entirely through high-level cash-flow design while evidence is still missing. After payoff guidance, say the detailed structure is saved in Your Plan and invite the owner to review Your Plan before acting.

## What This Procedure Is Not

It is not a substitute for professional financial, legal, tax, or investment advice.
