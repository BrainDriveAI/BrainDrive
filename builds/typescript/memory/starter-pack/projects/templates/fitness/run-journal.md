# Fitness Journal

*Procedure for Fitness follow-up sessions after `spec.md` and `plan.md` exist.*

## Preservation Rule

Before writing, correcting, or recovering `journal/journal.md`, read the existing file when it is readable. Never replace the whole file. Append new entries or targeted-edit only the intended entry. If `journal/journal.md` is unreadable or corrupt, create a timestamped recovery file, preserve the original, and tell the owner what happened.

## What This Procedure Accomplishes

Capture owner-provided Fitness follow-up history, review progress, surface blockers and patterns as hypotheses, and keep the Fitness `spec.md` or `plan.md` current only when the owner approves a change.

## When to Run

- The Fitness `spec.md` and `plan.md` already exist and the owner returns with progress, blockers, wins, changes, or follow-up context.
- The owner asks what has been logged recently.
- The owner asks to correct a prior Fitness journal entry.
- Journal history suggests the Fitness goals, current state, constraints, success criteria, or plan may be stale.

## Method

Read `me/profile.md`, Fitness `spec.md`, Fitness `plan.md`, `journal/AGENT.md`, and `journal/journal.md` before acting. Summarize relevant known context briefly instead of re-asking the owner cold.

When the owner shares a journal-worthy note, append a dated entry to `journal/journal.md` using this structure:

```md
## YYYY-MM-DD - Short Entry Title

- Source: Owner conversation
- Page: Fitness
- Context: Optional related plan/spec note
- Entry:
  Owner-visible summary of what happened, in plain language.
- Signals:
  - Win:
  - Blocker:
  - Change:
  - Pattern hypothesis:
- Follow-up:
  - Proposed task:
  - Proposed spec/plan adjustment:
- Status: captured / needs owner review / parent adjusted
```

Omit empty signal or follow-up fields when they do not apply. Preserve owner-provided details clearly, but do not invent calories, macros, weight, adherence scores, workouts, symptoms, diagnoses, or medical conclusions.

For review requests, read journal history and summarize relevant entries. Label uncertainty and gaps. Do not invent missing logs, metrics, or events.

For corrections, edit only the intended entry. If more than one entry could match, ask a concise clarification question before editing.

For pattern reflection, frame observations as hypotheses for owner calibration. Useful Fitness patterns can include adherence, recovery, schedule friction, food/movement consistency, energy, sleep, stress, travel, plan difficulty, and blockers. Avoid shame, certainty, diagnosis, commands, or medical claims.

When journal history implies the Fitness `spec.md` or `plan.md` should change, propose the specific update first. Only update the parent artifact after the owner agrees. Write concise current-truth changes; do not paste raw journal entries into the parent files.

Stable cross-project facts may go to `me/profile.md` only after owner confirmation. Concrete commitments stay in the journal entry's `Follow-up -> Proposed task` field in V.1.

## Recovery

- Missing `journal/journal.md`: recreate it from the default journal template, then append.
- Empty `journal/journal.md`: treat it as valid and append the first entry.
- Malformed but readable `journal/journal.md`: preserve existing content, append a valid entry, and flag that cleanup may be useful.
- Unreadable or corrupt `journal/journal.md`: do not overwrite it. Create a timestamped recovery file and tell the owner.

## Done Criteria

The Fitness journal entry, review, correction, or approved parent update is saved safely; unrelated journal history is preserved; parent files change only with owner approval; and the owner is told what changed and where.

## What This Procedure Is Not

It is not a required daily log, tracker, dashboard, food database, workout platform, wearable import, medical product, diagnosis, treatment plan, or substitute for a clinician, dietitian, physical therapist, or qualified coach.
