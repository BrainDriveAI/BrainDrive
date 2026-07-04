# Finance Planning

*Procedure for filling `plan.md` from the Finance spec.*

## Preservation Rule

Update sections in place in `plan.md`; never replace the whole file. Always keep every section header, every italic section description, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`. Use today's date from system context for Last updated and changelog entries.

## What This Procedure Accomplishes

Turn the Finance spec into a concrete sequence with one immediate step, a practical roadmap, owner decisions, review status, and clear blockers.

## When to Run

- The Finance spec has enough information to plan.
- New financial facts materially change the current plan.
- The owner asks what to do next.

## Method

Read the Finance `spec.md`, existing `plan.md`, `me/profile.md` before planning. Confirm the spec has enough goal, current-state, constraint, assumption, and success-criteria context to plan. If not, run or suggest the Finance interview first.

Lead with the owner's most urgent financial outcome. Show the math when it changes priority. Keep later phases high-level until earlier phases are complete.

Every plan step must trace to the owner's main story or a supporting story — or to a constraint, current-state fact, success criterion, or missing-information need that serves them. If a step does not ladder up to a story, it does not belong in the plan. If data is incomplete, create a provisional plan with explicit missing-information steps instead of pretending the plan is final.

Mark each step as one of: owner action, owner decision, data-gathering, or Finance review.

Every Finance plan must preserve regulated-boundary language when financial decisions could touch tax, legal, insurance, investment, or debt-settlement judgment. Say this is not financial advice, do not recommend specific trades or products, and route professional questions to a qualified professional.

## Done Criteria

`plan.md` names the first step, roadmap, owner decisions, review status, destination, and remaining blockers without copying full reports into the plan.

## After Running

Report what changed, update `plan.md`, update page metadata or rollup summaries only as brief summaries, and return to Finance scope.

## What This Procedure Is Not

It is not a substitute for professional financial, legal, tax, insurance, investment, product-brokerage, or debt-settlement advice.

## Handing Off To Your Journal

When **Your Goals** (`spec.md`) and **Your Plan** (`plan.md`) are written and the owner has confirmed the plan, close the alignment session by handing the owner into the journal loop:

- Tell the owner the next step is to start executing the plan and to come back and tell you how it goes — the wins, the blockers, what changed.
- You keep **Your Journal** as the record of those conversations; the owner can read or edit it anytime, but they never have to write it themselves — the conversation is where updates happen.
- Make sure `documents/finance/journal.md` exists; if it does not, create it from the default template (the Preservation Rule in `run-journal.md` covers this).
- Do not require a journal entry now, and do not ask the owner to log on a schedule. The journal is owner-driven follow-up — available, never mandatory.

This handoff fires once, when the first plan is written. From then on, the journal follow-up procedure (`run-journal.md`) owns the follow-up sessions.
