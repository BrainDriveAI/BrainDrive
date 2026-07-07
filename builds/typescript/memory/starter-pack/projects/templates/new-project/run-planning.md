# Project Planning

*Procedure for filling `plan.md` from the project spec.*

## Preservation Rule

Update sections in place in `plan.md`; never replace the whole file. Always keep every section header, every italic section description, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`. Use today's date from system context for Last updated and changelog entries.

## What This Procedure Accomplishes

Turn the project spec into a concrete routing decision, one immediate step, a practical roadmap, created-page handoff when appropriate, future capability candidates, review status, and clear blockers.

## When to Run

- The project spec has enough information to plan.
- New project facts materially change the current plan.
- The owner asks what to do next.

## Method

Read the New Project `spec.md`, existing `plan.md`, `me/profile.md`, existing page names/specs, and relevant page summaries before planning. Confirm the spec has enough owner goal, current-state, routing, assumption, and success-criteria context to plan. If not, run or suggest the New Project interview first.

Lead with the owner's desired outcome and the routing decision. Make the first step concrete, small enough to do, and tied to the current reality. Keep later phases high-level until earlier phases change the facts. Do not build phases for threads marked only as worth exploring later.

Every plan step must trace to the owner's main story or a supporting story — or to a current-state fact, routing rationale, success criterion, or missing-information need that serves them. If a step does not ladder up to a story, it does not belong in the plan. If the request is not ready for a new page, create a provisional plan that clarifies what is missing rather than scaffolding placeholder files.

If creating a page, the plan must identify the page name, slug, why it deserves a durable memory home, first spec content, first plan content, and immediate next step. Placeholder-only files are not sufficient.

Every provisional or created-page plan must include an explicit constraints, risks, and unknowns section. Tie it to what the owner already said, and use `unknown` for missing high-impact facts instead of pretending they are resolved.

If the owner asks for app generation, marketplace installation, page sharing, automation, or runtime modification, record it as a future capability candidate and keep the V.1 output to owner-inspectable page/spec/plan artifacts.

For sensitive or personal projects, do not force a productivity plan where support, safety, or clarity is the real first need.

## Done Criteria

`plan.md` names the first step, roadmap, routing decision, created-page handoff when appropriate, future capability candidates when relevant, review status, destination, and remaining blockers without turning uncertainty into fake certainty.

## After Running

Report what changed, update `plan.md`, update page metadata or rollup summaries only as brief summaries, and return to project scope. For `me/profile.md`, propose the exact profile update and ask for approval first; do not write it or claim it was updated without explicit owner approval.

## What This Procedure Is Not

It is not a generic task dump, app generator, marketplace, page-sharing workflow, runtime modifier, guarantee of outcomes, or substitute for qualified professional support when the project requires it.

## Handing Off To Your Journal

When **Your Goals** (`spec.md`) and **Your Plan** (`plan.md`) are written and the owner has confirmed the plan, close the alignment session by handing the owner into the journal loop:

- Tell the owner the next step is to start executing the plan and to come back and tell you how it goes — the wins, the blockers, what changed.
- You keep **Your Journal** as the record of those conversations; the owner can read or edit it anytime, but they never have to write it themselves — the conversation is where updates happen.
- Make sure `documents/new-project/journal.md` exists; if it does not, create it from the default template (the Preservation Rule in `run-journal.md` covers this).
- Do not require a journal entry now, and do not ask the owner to log on a schedule. The journal is owner-driven follow-up — available, never mandatory.

This handoff fires once, when the first plan is written. From then on, the journal follow-up procedure (`run-journal.md`) owns the follow-up sessions.
