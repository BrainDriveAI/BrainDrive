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

1. Read the active page's `AGENT.md`, `spec.md`, `run-interview.md`, and `me/profile.md` first, plus any `AGENT-user.md` or `run-interview-user.md` overlays.
2. Run the interview by following that page's `run-interview.md` — it owns the pacing, what to learn in this domain, and the user-story playback before writing. Do not keep a separate set of interview rules here.
3. Update `spec.md` in place using the page's preservation rule; preserve owner-authored content.
4. Summarize what changed and point the owner to Your Goals in the sidebar — by product name, never by filename.
