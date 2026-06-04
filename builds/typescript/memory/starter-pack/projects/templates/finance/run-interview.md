# Finance Interview

*Procedure for filling `spec.md` through conversation.*

## Preservation Rule

Update sections in place in `spec.md`; never replace the whole file. Always keep every section header, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`. Use today's date from system context for Last updated and changelog entries. Remove author-only helper text and starter placeholders from filled sections; owner read mode should show owner-specific goals and current state, not template instructions.

## What This Procedure Accomplishes

Build a goal-relevant financial picture and capture the owner's goals, time horizon, concerns, success criteria, current reality, constraints, tradeoffs, risks, and missing information.

## When to Run

- The Finance spec is empty or materially stale.
- The owner wants to clarify financial goals before planning.
- New life or money context could materially change the project direction.

## Method

### 1. Context Intake

Before broad setup questions, read or attempt to read `me/profile.md`, `AGENT-user.md` if present, `spec.md`, and `plan.md`. Read child-app summaries or Budget reports only when they directly affect the owner's already-stated Finance goal.

Use known context first. Briefly summarize what appears known, then ask what is missing, stale, or unconfirmed. Do not re-ask known facts as if starting from scratch. Do not read Budgeting app detail files, transaction evidence, or unrelated project specs during parent Finance alignment unless the owner request creates a specific need. If card statement PDFs are requested only to reveal APRs or minimum payments, say that they are narrow debt-term evidence for parent Finance, not a Budget setup.

For first-turn parent Finance alignment, do not use `memory_search` for broad discovery and do not read Career, Relationships, Fitness, BrainDrive Plus One, or other project instructions/specs for routing awareness. If the narrow Finance files are empty, absent, or starter templates, say there is not much saved Finance context yet and continue from the owner's stated goal.

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

When the owner asks to identify constraints, tradeoffs, risks, or unknowns, write the detailed landscape to `spec.md` and keep the chat readback in bullets only. Do not use a table, pipe character, or category grid in the chat reply. Use this shape:

```md
I saved this to Your Goals.

Key constraints:
- APRs and minimum payments are still missing.
- Statement avoidance is part of the plan, not a side issue.
- Cash flow is unclear until essentials and minimums are known.

Next: gather credit-card statement/app evidence for APRs and minimum payments.
```

### 5. Minimal Durable Capture

Once the owner has provided material current-state facts, update `spec.md` with a minimal durable draft before deeper planning or another broad interview. Preserve existing sections and fill only what is supported by the conversation. Use short paragraphs and bullets, not markdown tables. Include:

- the goal and time horizon if known;
- stated success criteria or what would feel better;
- current-state facts and estimates with evidence labels;
- constraints, risks, and owner concerns;
- missing information needed for the plan.

Read back `spec.md` before saying the Finance goals were saved. If a write or readback fails, do not claim durable state was updated; ask to continue so the draft can be saved.

When updating filled sections, delete author-only helper lines such as "The owner's confirmed...", "Include desired outcome...", or "To be filled through conversation." Keep the section header and owner-facing content.

### 6. Write Placement

Write new information at the narrowest correct level:

- confirmed stable cross-project facts to `me/profile.md`;
- Finance goals, time horizon, concerns, success criteria, current state, assumptions, constraints, tradeoffs, risks, and missing information to `spec.md`;
- actions, statuses, blockers, and handoffs to `plan.md` only when planning is happening;
- Budget targets, statement evidence, transaction details, rules, and reports to the Budgeting child app.

Do not copy detailed Budget reports or transaction ledgers into `spec.md`.

Keep sensitive Finance-only detail in `spec.md` unless the owner confirms it should be useful across projects. For `me/profile.md`, prefer minimal stable summaries over detailed debt, account, or anxiety notes. If you claim an Owner Profile update, read the profile back and name the exact saved summary in the reply.

## Done Criteria

`spec.md` has confirmed owner-specific goals, an explicit `Success Criteria` section, goal-relevant current state, constraints, tradeoffs, risks, labeled unknowns, and an explicit `Assumptions / Evidence Quality` section. High-stakes claims are not presented beyond the available evidence. The saved spec uses bullets or short paragraphs rather than markdown tables.

## After Running

Update `spec.md`, summarize material changes in owner-facing language, and return to Finance scope before proposing planning or child-app execution. Do not add Todo items during interview-only turns; Todo propagation happens after the Finance plan defines the current immediate owner action. For stressful Finance topics, keep the chat reply to 80 words or fewer and 500 characters or fewer when practical, with at most 3 bullets. Put detail in the saved spec, ask at most one or two focused next questions in the chat reply, and do not use markdown tables in chat or in Finance documents.

## What This Procedure Is Not

It is not investment, tax, legal, medical, or debt-settlement professional advice.
