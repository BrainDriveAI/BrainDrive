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

Before planning, read or attempt to read `me/profile.md`, `AGENT-user.md` if present, `spec.md`, `plan.md`, and relevant child-app summaries or Budget reports when they directly affect the plan. Use known context first and do not ask broad setup questions for facts already present. Do not read Budgeting app detail files, transaction evidence, or unrelated project specs unless the plan step needs that evidence.

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

### 3. Budgeting Handoff Gate

Route a step to Budgeting only when the goal or plan needs spending visibility, spending targets, or statement-period reconciliation. Finance can complete Align + Plan without statement uploads or a saved Budget. Keep non-budget goals in Finance planning instead of forcing a Budget workflow.

When source statements or other evidence have just been uploaded and accepted, advance the plan from gathering evidence to the next validation or refinement step. Do not leave statement upload as pending if the needed files are now present; list only the specific months/accounts/institutions still missing.

Do not copy full Budget reports, source ledgers, or transaction details into `plan.md`; preserve only the parent-level outcome, blocker, handoff, or next action.

### 4. Write Placement

Write new information at the narrowest correct level:

- stable cross-project owner facts to `me/profile.md` after confirmation when inferred or sensitive;
- Finance goals, current state, constraints, assumptions, success criteria, risks, and missing information to `spec.md`;
- ordered steps, status, priorities, rationale, blockers, and child-app handoffs to `plan.md`;
- Budget execution detail to the Budgeting child app.

Keep sensitive Finance-only details in `spec.md` unless the owner confirms profile placement. Use calibrated destination language that acknowledges missing evidence; do not promise permanent security, zero dread, guaranteed outcomes, or month-by-month certainty from estimates.

## Done Criteria

`plan.md` names the first step, roadmap, destination, and remaining blockers. Steps are typed, statused, traceable to the spec, and do not copy full reports into the plan.

## After Running

Report what changed, update `plan.md`, add todos only for concrete next actions, and return to Finance scope. In chat, summarize artifact changes and the next step without exposing raw paths unless asked.

## What This Procedure Is Not

It is not a substitute for professional financial, legal, tax, or investment advice.
