---
name: feature-spec
description: Create or update the active BrainDrive page spec.md from interview notes or conversation context.
---

# Feature Spec Skill

Use this skill when the owner wants BrainDrive to write, revise, or inspect the active page's `spec.md`.

## Trigger

`/feature-spec [optional: page or topic]`

## Output Location

The active page's `spec.md`.

## Instructions

1. Read the active page `AGENT.md`, `spec.md`, and `run-interview.md`.
2. Read `me/profile.md` for relevant stable owner context.
3. Read overlays such as `AGENT-user.md` and `run-interview-user.md` when present.
4. Use the page template already in `spec.md`; do not introduce software-factory sections unless the active page explicitly asks for them.
5. Preserve owner edits. Update sections in place and keep headings, status, last-updated metadata, and changelog.
6. Write owner-facing content: goals, current reality, constraints, assumptions, success criteria, plan direction, and open questions.
7. Keep implementation/build detail out of owner page specs unless the owner-created project is actually a software build.
8. Tell the owner what changed and point them to the page spec in BrainDrive.

## Quality Bar

A useful page spec is specific, faithful to the owner's words, honest about gaps, and non-generic. It should give the planning step enough context to produce one practical first step and a near-term roadmap.

## Not This

This skill does not write internal BrainDrive-Library feature specs or software-factory `build-plan.md` inputs. Internal build artifacts belong outside the owner starter-pack page loop.
