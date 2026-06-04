# Finance Planning

*Procedure for filling `plan.md` from the Finance spec.*

## Preservation Rule

Update sections in place in `plan.md`; never replace the whole file. Always keep every section header, every italic section description, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`. Use today's date from system context for Last updated and changelog entries.

## What This Procedure Accomplishes

Turn the Finance spec into an ordered, typed, traceable sequence with one immediate step, a practical roadmap, owner-review points, and clear blockers.

## When to Run

- The Finance spec has enough information to plan.
- New financial facts materially change the current plan.
- The owner asks what to do next.

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

Durable Finance plans must include these explicit sections when relevant information exists: `Owner Decisions`, `Planning Guardrails`, `Data-Gathering Steps`, `Execution Steps`, and `Child-App Handoffs`. Regulated-boundary context that constrains the plan, such as a Roth IRA remaining retirement-only, belongs in `Owner Decisions` or `Planning Guardrails`.

Frame retirement contribution changes as owner decisions or review points, not immediate commands. Use neutral language such as "contribution level is a later cash-flow decision to review after exact bills, card APRs, minimum payments, tax considerations, and any employer-match context are known" instead of "pause contributions temporarily" or "pause contributions immediately." Do not present contribution pausing as the obvious fast-debt lever. Do not say to throw cash at credit cards or burn down debt. If a plan label is needed, use `Roth IRA contribution pause/reduce decision`; do not write malformed labels such as `Roth IRA Contribution Pacify/Pause`. Do not recommend specific funds, securities, trades, or allocations.

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
- Budget execution detail to the Budgeting child app.

Keep sensitive Finance-only details in `spec.md` unless the owner confirms profile placement. Use calibrated destination language that acknowledges missing evidence; do not promise permanent security, zero dread, guaranteed outcomes, or month-by-month certainty from estimates. If you claim an Owner Profile update, read it back before replying.

## Done Criteria

`plan.md` names the first step, roadmap, destination, remaining blockers, owner decisions, planning guardrails, data-gathering steps, execution steps, and child-app handoffs. Steps are typed, statused, traceable to the spec, and do not copy full reports into the plan. If only one active Todo is appropriate, the remaining missing-evidence steps are explicitly labeled later, deferred, or staged after the first action so they are not forgotten. If retirement or investment boundaries were discussed, the plan includes the boundary and decision point without specific investment advice.

## After Running

Report what changed, update `plan.md`, add todos only for immediate owner actions in the current active plan phase, and return to Finance scope. Deferred or later-phase plan steps stay in Your Plan and should not become Todo list items until they become the next active owner action. Read the Todo list back before saying immediate actions were saved. In chat after artifact writes, stay under 120 words or 800 characters, summarize only artifact changes and the next step, and avoid exposing raw paths unless asked. Never say "completed, verified, and saved"; say "I saved this to Your Goals/Your Plan." Never say "saved Budget" or "Budget materials" during parent Finance planning unless the Budgeting child app was active and a Budget artifact was written and read back. Budgeting deferral is conditional: Budgeting is not needed for the next step, and the plan should revisit it if spending visibility, spending targets, or statement-period reconciliation become necessary. Do not say Budgeting is bypassed, paused indefinitely, or that the goals can be achieved entirely through high-level cash-flow design while evidence is still missing. After payoff guidance, say the detailed structure is saved in Your Plan and invite the owner to review Your Plan before acting.

## What This Procedure Is Not

It is not a substitute for professional financial, legal, tax, or investment advice.
