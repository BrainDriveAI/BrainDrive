---
name: feature-spec
description: Generate a feature specification document from interview notes or conversation context. Use when the user wants to create a spec, define requirements, or document a feature before building it.
---

# Feature Spec Skill

Use this skill to generate a feature specification document from interview notes or conversation context.

**Framework Phase:** 2 - Plan
**Output Location:** `BrainDrive-Library/projects/active/[project-name]/spec.md`

## Trigger
`/feature-spec [optional: feature name]`

## Instructions

When this skill is triggered, generate a comprehensive feature specification document based on:
1. The interview conducted (if `/interview` was run)
2. The landscape research (if `/landscape` was run) — incorporate findings into Technical Context and cite the build-vs-adopt recommendation
3. Any existing conversation context about the feature
4. User clarification if needed

### Process

1. **Review Context**
   - Read through the conversation to gather all feature information
   - Check if `/landscape` was run — if so, read the landscape.md and factor its recommendation into the spec (adopt, fork, or build-from-scratch)
   - Check BrainDrive-Library for related projects and decisions
   - Identify any gaps or unclear areas

2. **Clarify Gaps** (if needed)
   - If critical information is missing, ask the user using AskUserQuestion
   - Focus only on blockers - don't re-interview

3. **Generate Spec**
   - Read `system/templates/spec-template.md` from the Library
   - Fill in all sections based on gathered information
   - Mark incomplete sections with `[TODO: ...]`

4. **Write to File**
   - Create the spec in BrainDrive-Library: `projects/active/[project-name]/spec.md`
   - Create the project folder if it doesn't exist
   - Or ask user for preferred location if not using Library

5. **Review with User**
   - Summarize what was captured
   - Highlight any TODO items or open questions
   - Ask if anything needs adjustment

### Spec Quality Checklist

Before presenting the spec, ensure:

- [ ] **Overview** is clear and concise (someone could understand the feature in 30 seconds)
- [ ] **Target user** is specific (which persona, what context)
- [ ] **Problem statement** explains the pain, not just the solution
- [ ] **User stories** describe specific flows, not vague capabilities
- [ ] **User story formatting** — title + summary sentence exposed; source, steps, and acceptance criteria behind `<details>` accordion (keeps the doc scannable without losing detail)
- [ ] **Acceptance criteria** use Given-When-Then format for each user story
- [ ] **Invariants** define what must ALWAYS be true (drives property-based tests)
- [ ] **Edge cases** are cataloged with expected behavior
- [ ] **MVP scope** is clearly bounded (what's in AND what's out)
- [ ] **Technical context** identifies all integration points
- [ ] **Test strategy** specifies test levels, verification approach, and baseline impact
- [ ] **Security considerations** assessed (risk level, threats, mitigations — or marked N/A)
- [ ] **Explicit boundaries** define what AI should NOT touch or modify
- [ ] **Open questions** capture any unresolved items

### Template Reference

Use the structure from `system/templates/spec-template.md`:

```markdown
# Spec: [Name]

## Overview
## Target User
## Problem Statement
## User Stories (with Given-When-Then acceptance criteria)
## Invariants & Edge Cases (properties, edge cases, failure modes)
## Detailed Requirements
## Scope (MVP vs Future)
## Technical Context
## Test Strategy (test levels, verification approach, baseline impact)
## Security Considerations (risk level, threats, mitigations)
## Explicit Boundaries (what AI should NOT touch)
## Open Questions
## Success Definition
```

### Handling Incomplete Information

For any section without clear information:
- Mark as `[TODO: needs clarification]`
- Or mark as `[TBD: to be decided during technical design]`
- Don't invent details - better to have explicit gaps

### Output

The skill outputs:
1. A complete `spec.md` file saved to Library
2. A summary of what's captured
3. A list of open questions or TODOs
4. Recommendation for next step (usually `/plan` to create the build plan)

## Example Output Summary

```
## Spec Generated

I've created `BrainDrive-Library/projects/active/user-settings/spec.md` with:

**Captured:**
- Clear overview of settings management feature
- Target user: Builders who want to customize their BrainDrive
- Primary flow: Access settings → Modify → Save → See confirmation
- MVP scope: 5 core settings, excludes import/export

**Open Questions:**
- [ ] Should settings sync across devices?
- [ ] What's the reset to defaults behavior?

**Next Step:**
Run `/plan` to design the architecture and create the build plan, or clarify open questions first.
```
