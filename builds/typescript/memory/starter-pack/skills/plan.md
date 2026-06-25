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

1. Read the active page `AGENT.md`, `spec.md`, `plan.md`, and `run-planning.md`.
2. Read `me/profile.md` for relevant stable owner context.
3. Read overlays such as `AGENT-user.md` and `run-planning-user.md` when present.
4. Confirm the page spec is specific enough to plan. If not, run or suggest `/interview` first.
5. Derive the plan from the accepted page spec and current owner intent. Do not invent missing facts.
6. Update `plan.md` in place using the page's preservation rule. Preserve owner-authored content unless the owner approves replacing it.
7. Include one bite-sized first step, a practical near-term roadmap, a clear destination, and remaining blockers.
8. Keep later phases high-level until earlier steps produce better information.
9. Tell the owner what changed and point them to Your Plan in the sidebar — by product name, never by filename or path.

## Quality Bar

A useful page plan is actionable, faithful to the spec, appropriately scoped, and not overwhelming. The first step should be small enough to do now or this week.

## Not This

This skill does not create software-factory `build-plan.md` files. The owner-facing page artifact is `plan.md`, labeled in BrainDrive as Your Plan.
