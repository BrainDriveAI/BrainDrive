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

1. Read the active page's `AGENT.md`, `spec.md`, and `run-interview.md`, plus `me/profile.md` and any overlays.
2. Write or revise `spec.md` by following that page's `run-interview.md` and the section structure already in `spec.md`. Do not introduce a separate spec format or software-factory sections.
3. Preserve owner edits: update sections in place and keep headings, status, last-updated, and changelog.
4. Keep implementation/build detail out of owner page specs unless the project is actually a software build.
5. Tell the owner what changed and point them to Your Goals in the sidebar — by product name, never by filename.

## Not This

This skill does not write internal BrainDrive-Library feature specs or software-factory `build-plan.md` inputs.
