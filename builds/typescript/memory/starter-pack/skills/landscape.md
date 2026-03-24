---
name: landscape
description: Research open-source projects that solve the same problem before building from scratch. Use when the user wants to find existing solutions, evaluate build-vs-adopt, or survey the open-source landscape for a feature.
---

# Landscape Skill

Use this skill to research open-source projects that may already solve the problem you're about to build. This runs after `/interview` and before `/feature-spec` to inform build-vs-adopt decisions.

**Framework Phase:** 1.5 - Research (between Interview and Spec)
**Output Location:** `BrainDrive-Library/projects/active/[project-name]/landscape.md`

## Trigger
`/landscape [optional: problem statement or feature name]`

## Instructions

When this skill is triggered, research the open-source ecosystem for projects that address the same problem surfaced during the interview (or described in the trigger argument).

### Process

1. **Extract Search Criteria**
   - Review the conversation for interview context (if `/interview` was run)
   - Identify the core problem being solved
   - Extract key capabilities and technical requirements
   - Note the target stack (languages, frameworks, platforms)
   - If no interview context exists and the trigger argument is vague, ask the user to describe the problem in 2-3 sentences using AskUserQuestion

2. **Search the Landscape**
   - Use WebSearch to find open-source projects that solve this problem
   - Search with multiple query angles:
     - Direct problem description (e.g., "open source real-time collaboration framework")
     - Technology-specific (e.g., "React plugin system library")
     - Alternative phrasings and synonyms
     - "awesome-*" curated lists related to the domain
     - GitHub topic searches
   - Aim for **5-15 candidate projects** before filtering

3. **Evaluate Each Candidate**
   For each promising project, gather:
   - **Name & repo URL**
   - **Description** — what it does in one sentence
   - **License** — MIT, Apache-2.0, GPL, etc. (flag copyleft licenses)
   - **Activity signals** — stars, last commit date, open issues, contributors
   - **Maturity** — pre-release, stable, maintained, abandoned?
   - **Relevance** — which of our requirements does it cover?
   - **Gaps** — what's missing vs. what we need?
   - **Integration fit** — how well does it fit our stack (BrainDrive is TypeScript, Vite, Web Components)?

   Use WebFetch to check repo READMEs, docs, or feature lists when needed.

4. **Score and Rank**
   Rate each candidate on three dimensions:
   - **Coverage** — How much of our problem does it solve? (Low / Medium / High)
   - **Health** — Is it actively maintained and well-supported? (Low / Medium / High)
   - **Fit** — How easily does it integrate with our stack? (Low / Medium / High)

5. **Make a Recommendation**
   Based on the research, recommend one of:
   - **Adopt** — An existing project covers our needs well. Use it directly.
   - **Fork/Extend** — A project covers most needs but requires modifications.
   - **Integrate Components** — No single project fits, but we can use libraries/components from several.
   - **Build from Scratch** — Nothing suitable exists; we should build our own.

   Justify the recommendation with specific evidence from the research.

6. **Write the Landscape Document**
   - Create the project folder if it doesn't exist
   - Write `landscape.md` using the format below
   - Summarize findings to the user

7. **Review with User**
   - Present the recommendation
   - Highlight the top 2-3 candidates if adopting/forking
   - Ask if the user wants to dig deeper into any project
   - Confirm direction before moving to `/feature-spec`

### Landscape Document Format

```markdown
# Landscape: [Feature/Problem Name]

> Generated from `/landscape` on [Date]
> Interview context: [Yes/No — link to interview if applicable]

## Problem Statement
[1-2 paragraph summary of what we're trying to solve and key requirements]

## Search Criteria
- **Core problem:** [what we need solved]
- **Target stack:** [languages, frameworks, platforms]
- **Key requirements:** [bulleted list of must-haves from interview]

## Candidates

### [Project Name]
- **Repo:** [URL]
- **License:** [license type]
- **Stars:** [count] | **Last commit:** [date] | **Contributors:** [count]
- **What it does:** [1-2 sentences]
- **Coverage:** [Low/Medium/High] — [brief justification]
- **Health:** [Low/Medium/High] — [brief justification]
- **Fit:** [Low/Medium/High] — [brief justification]
- **Gaps:** [what's missing for our needs]
- **Notes:** [anything notable — e.g., "used by X company", "great docs"]

[Repeat for each candidate]

## Comparison Matrix

| Project | Coverage | Health | Fit | License | Notes |
|---------|----------|--------|-----|---------|-------|
| [name]  | High     | High   | Med | MIT     | [key note] |

## Recommendation

**[Adopt / Fork / Integrate Components / Build from Scratch]**

[2-3 paragraph justification referencing specific projects and how they map to requirements. If recommending adopt/fork, specify which project and what modifications are needed. If recommending build-from-scratch, explain why existing options fall short.]

## Open Questions
- [ ] [Any unresolved items that affect the decision]

## Next Step
Run `/feature-spec` to write the specification, incorporating this landscape research.
```

### Quality Checklist

Before presenting findings, ensure:

- [ ] **Multiple search angles** were used (not just one query)
- [ ] **At least 3 candidates** were evaluated (or documented why fewer exist)
- [ ] **Licenses checked** — copyleft (GPL) flagged, commercial-friendly (MIT/Apache) noted
- [ ] **Activity verified** — not recommending abandoned projects
- [ ] **Gaps identified** — honest about what each project doesn't cover
- [ ] **Stack fit assessed** — considered integration with BrainDrive's TypeScript/Vite/Web Components stack
- [ ] **Recommendation is justified** — not just "build from scratch" by default

### Guidelines

- **Be honest about findings.** If a great open-source solution exists, say so — even if it means we don't build anything. Saving time is the whole point.
- **Check recency.** A project with 10K stars but no commits in 2 years is a risk. Note this.
- **Flag license concerns.** GPL/AGPL projects can't be freely integrated into commercial products without implications. MIT/Apache-2.0/BSD are generally safe.
- **Don't over-research.** Spend effort proportional to the feature's complexity. A simple utility doesn't need 15 candidates evaluated.
- **Note partial solutions.** Sometimes the answer is "use Library X for part A and build part B ourselves." That's a valid recommendation.
- **Consider the ecosystem.** A smaller project with an active community and good docs may be better than a large unmaintained one.

## Example Output Summary

```
## Landscape Research Complete

I've created `projects/active/plugin-marketplace/landscape.md` with:

**Searched:** 4 query angles, evaluated 7 candidates

**Top candidates:**
1. **micro-plugin-system** (MIT, 2.1K stars, active) — Covers plugin loading,
   sandboxing, and lifecycle. Missing: marketplace UI, discovery.
   Coverage: High | Health: High | Fit: High

2. **webstore-framework** (Apache-2.0, 890 stars, active) — Full marketplace
   with search, ratings, install. Missing: BrainDrive-specific plugin format.
   Coverage: Medium | Health: Medium | Fit: Low

**Recommendation: Fork/Extend micro-plugin-system**
It handles the hard parts (sandboxing, lifecycle) and fits our stack well.
We'd build the marketplace UI ourselves on top.

**Next Step:**
Run `/feature-spec` to write the spec, incorporating micro-plugin-system as the foundation.
```

## Notes

- This skill works best after `/interview` but can also be triggered standalone with a problem description
- The landscape document becomes a reference for `/feature-spec` — the spec should cite it under Technical Context
- If the recommendation is "adopt," the spec may be much simpler (integration spec vs. build spec)
- Re-run `/landscape` if requirements change significantly during spec or planning
