# Your Agent Interview

*Procedure for filling `spec.md` through conversation.*

## Preservation Rule

Update sections in place in `spec.md`; never replace the whole file. Always keep every section header, every italic section description, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`. Use today's date from system context for Last updated and changelog entries.

## What This Procedure Accomplishes

Build a clear picture of how the owner wants BrainDrive to help across projects, what stable context should be remembered, and what trust requirements must be respected.

## When to Run

- The Your Agent spec is empty or materially stale.
- The owner wants BrainDrive to behave differently across projects.
- New stable owner preferences, trust needs, or cross-page context could materially improve future sessions.

## Method

Tell the owner the first interview should take about 5 minutes. Read `me/profile.md`, current todos, and any relevant page context before asking broad setup questions.

Use one primary question per turn during the first-run interview. Reply shape: mirror one useful owner signal in one sentence, ask exactly one question, then stop. Use at most one question mark in the whole reply. Do not use numbered or bulleted question lists. Do not add parenthetical subquestions. Do not turn one question into a category checklist such as "what about A, B, and C?" If several facts are missing, ask only for the single fact that most changes the next step. After 4-5 owner answers, write provisional spec and plan updates with unknowns instead of continuing intake. Mirror concrete money, time, health, safety, boundary, deadline, or risk constraints in the next reply before asking another question.

Start with what the owner wants BrainDrive to be better at. Map advising style, preferred level of detail, where they want challenge versus support, what they do not want repeated, what should require approval, and what facts are stable enough to reuse across projects over multiple adaptive turns. Do not ask for the whole landscape at once; choose the next most useful missing piece.

Ask before treating inferred preferences or personal facts as settled profile memory. Mark uncertain placement instead of silently writing cross-page facts to the wrong artifact.

## Done Criteria

`spec.md` has useful owner-specific content, important unknowns are labeled, and cross-BrainDrive preferences are not based on unsupported assumptions.

## After Running

Update `spec.md`, summarize material changes, update `me/profile.md` only for confirmed stable facts, add todos only for concrete next actions, and return to Your Agent scope before proposing planning.

## What This Procedure Is Not

It is not a place to store secrets, provider credentials, raw page detail, or one-off facts that belong only in a specific project.
