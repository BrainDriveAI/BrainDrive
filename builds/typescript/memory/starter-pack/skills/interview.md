---
name: interview
description: Run a focused owner interview for the active BrainDrive page and update that page's spec.md.
---

# Interview Skill

Use this skill when the owner wants to clarify a page, start a first interview, or update a stale page spec.

## Trigger

`/interview [optional: page or topic]`

## Output Location

The active page's `spec.md`.

## Instructions

1. Read the active page `AGENT.md`, `spec.md`, `run-interview.md`, and `me/profile.md` before asking broad setup questions.
2. If the active page has `AGENT-user.md` or `run-interview-user.md`, read those overlays too.
3. Tell the owner the first interview should take about 5 minutes when this is the first page interview.
4. Ask one focused question at a time. In first-run interviews, use at most one question mark per reply, do not add parenthetical subquestions, and do not list multiple categories inside one question. Prefer adaptive follow-ups over a fixed questionnaire.
5. Mirror concrete constraints immediately. If the owner gives money, time, health, safety, relationship-boundary, deadline, or risk-tolerance information, restate that constraint in the next reply before asking the next question.
6. Separate page facts from cross-BrainDrive profile facts. Ask before treating inferred profile facts as stable memory.
7. Mark assumptions and unknowns plainly instead of inventing missing details.
8. Update `spec.md` in place using the page's preservation rule. Do not replace owner-authored content wholesale.
9. Summarize what changed and where the owner can inspect it inside BrainDrive.

## Interview Targets

Learn only what is needed to make the page spec useful:

- what the owner wants;
- where they are now;
- what constraints or risks matter;
- what success would look like;
- what information is still missing;
- what likely first direction should feed the page plan.

## Done Criteria

`spec.md` contains owner-specific goals, current reality, constraints, useful assumptions, and open questions. The result should be specific enough to support a practical `plan.md` without pretending uncertain facts are settled.
