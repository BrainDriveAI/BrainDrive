---
name: plan
description: Create or update the active BrainDrive page plan.md from the accepted page spec.
---

# Plan Skill

Use this skill when the owner wants a practical page plan, next step, or roadmap.

## Trigger

`/plan [optional: page or goal]`

## Output Location

The active page's `plan.md`.

## Instructions

1. Read the active page's `AGENT.md`, `spec.md`, `plan.md`, and `run-planning.md`, plus `me/profile.md` and any overlays.
2. Confirm the spec is specific enough to plan; if not, run or suggest `/interview` first.
3. Build or update `plan.md` by following that page's `run-planning.md` — it owns how to turn the spec into a plan, including tracing each step to the owner's stories. Do not keep a separate planning method here.
4. Preserve owner-authored content; update in place using the page's preservation rule.
5. Tell the owner what changed and point them to Your Plan in the sidebar — by product name, never by filename.

## Not This

This skill does not create software-factory `build-plan.md` files. The owner-facing artifact is the page plan, shown as Your Plan.
