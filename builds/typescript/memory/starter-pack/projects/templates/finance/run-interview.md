# Finance Interview

*Procedure for filling `spec.md` through conversation.*

## Preservation Rule

Update sections in place in `spec.md`; never replace the whole file. Always keep every section header, every italic section description, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`. Use today's date from system context for Last updated and changelog entries.

## What This Procedure Accomplishes

Build a goal-relevant financial picture and capture the owner's goals, time horizon, concerns, success criteria, current reality, constraints, tradeoffs, risks, and missing information.

## When to Run

- The Finance spec is empty or materially stale.
- The owner wants to clarify financial goals before planning.
- New life or money context could materially change the project direction.

## Method

### 1. Context Intake

Before broad setup questions, read or attempt to read `me/profile.md`, `AGENT-user.md` if present, `spec.md`, `plan.md`, and relevant child-app summaries or Budget reports when they directly affect the owner's Finance goal.

Use known context first. Briefly summarize what appears known, then ask what is missing, stale, or unconfirmed. Do not re-ask known facts as if starting from scratch.

### 2. Goal Alignment

Start with the owner's presenting concern and clarify it into a plan-usable goal statement. Capture:

- desired outcome;
- time horizon or deadline;
- concerns, fears, or tradeoffs the owner is trying to avoid;
- success criteria and what would feel meaningfully better;
- any owner priorities, risk tolerance, or constraints already known.

If the goal is vague, such as "get my finances in order," ask targeted follow-up questions before planning. Restate material goals and ask for confirmation before durable spec updates when facts are inferred, ambiguous, or high impact.

### 3. Goal-Relevant Current State

Gather only the current-state context needed to plan against the owner's goals. This may include income, spending, debt, savings, investments, employer benefits, obligations, and relationship or life-transition context, but do not collect a full financial inventory when a narrower picture is enough.

Show useful math when it affects priority. Ask for specifics where they matter, especially debt rates, income, fixed bills, deadlines, and recurring obligations. Mark estimates and unknowns plainly.

Label evidence quality where it affects the plan:

- known fact;
- owner estimate;
- source-evidenced;
- one-period observed;
- missing;
- stale.

One uploaded statement period is limited evidence, not a stable baseline unless the owner confirms it.

### 4. Gap Review

Compare goals against current state. Classify material follow-up items as constraints, tradeoffs, risks, owner decisions, evidence gaps, stale facts, or later exploration. Frame regulated areas such as tax, legal, investment, insurance, and debt settlement as context organization and tradeoff illumination, not professional advice or product recommendations.

### 5. Write Placement

Write new information at the narrowest correct level:

- confirmed stable cross-project facts to `me/profile.md`;
- Finance goals, time horizon, concerns, success criteria, current state, assumptions, constraints, tradeoffs, risks, and missing information to `spec.md`;
- actions, statuses, blockers, and handoffs to `plan.md` only when planning is happening;
- Budget targets, statement evidence, transaction details, rules, and reports to the Budgeting child app.

Do not copy detailed Budget reports or transaction ledgers into `spec.md`.

## Done Criteria

`spec.md` has confirmed owner-specific goals, goal-relevant current state, success criteria, constraints, tradeoffs, risks, and labeled unknowns. High-stakes claims are not presented beyond the available evidence.

## After Running

Update `spec.md`, summarize material changes in owner-facing language, add todos only for concrete next actions, and return to Finance scope before proposing planning or child-app execution. Ask at most one or two focused next questions in the chat reply.

## What This Procedure Is Not

It is not investment, tax, legal, medical, or debt-settlement professional advice.
