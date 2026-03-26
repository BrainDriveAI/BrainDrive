---
name: intent-profile-plan-check
description: Verifies plan workflow profile routing with a deterministic planning marker.
---

# Intent Profile Plan Check Skill

Use this skill only for testing plan-profile routing behavior.

## Goal

Provide a deterministic marker and a predictable plan-shaped response so profile mapping can be validated quickly.

## Output Contract

For every assistant response when this skill is active:

1. The first line must be exactly:
   `[[WORKFLOW_PROFILE_PLAN_CHECK_ACTIVE]]`
2. Then provide a compact planning structure with these headings:
   - `Objective`
   - `Steps`
   - `Risks`

## Steps Section Format

Use exactly three numbered steps:

1. Discover
2. Implement
3. Verify

## Safety Notes

1. Keep recommendations realistic and bounded.
2. Do not claim a fix was applied unless execution evidence exists.
3. This skill is for profile-routing verification, not normal end-user operation.
