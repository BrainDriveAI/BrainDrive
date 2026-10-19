# Business Idea preview content

Status: Experimental, local development only. This is readable, text-only content for an ordinary BrainDrive page and the existing skill registry. It is not an installer, public release, new permission mechanism, or an independent quality review.

The `page/` directory contains the page instructions, interview procedures, a reusable blank template, and empty generated-work scaffolds. No fictional owner facts or private runtime data are included. The actual interview guidance is `page/business-idea-interview.md`; register its text with `GatewaySkillService.createSkill` and assign its ID to the intended page with `GatewayProjectService.setProjectSkills`. Both services already exist. Registration is deliberate: this directory is not automatically installed into existing Memory. Before changing an existing page, preserve its files and customizations; never overwrite owner work with these blank scaffolds.

The skill helps an owner explore an existing idea or find concrete possibilities, one question at a time. It separates reported observations, assumptions, unknowns, contradictions, AI suggestions, and owner decisions. It saves an editable `business-idea-brief.md` with a practical next test and continuing/revising/dropping criteria, using existing Memory writes and a read-back check. The separate `business-idea-brief-template.md` remains blank. Goals, plan, and journal retain their established roles. The approved preview surfaces are Conversation, Your Files, Tools, and Behavior; future Connections, Agents, and Apps behavior is not implemented here.

## Provenance

The Business Idea offer draft v0.4 (2026-10-12) informed the outcome and continuation requirements. The existing local sidebar prototype established the separate brief and template filenames. This bounded preview does not claim the draft's package distribution, independent review, or public release gates are complete.

Newly written guidance takes inspiration from [gbrain's pinned evidence prompt](https://github.com/garrytan/gbrain/blob/9591ebf05a8205bbaa5de6afdaa6e8b632845639/src/core/think/prompt.ts) and [gstack's pinned problem diagnostic](https://github.com/garrytan/gstack/blob/15ebd85cdde6c9a1b2fb707e8573aec18e8f7438/office-hours/sections/phase-2a-startup-diagnostic.md.tmpl). No substantial source text or code is copied. No venture-scale pressure, recruitment, scoring, or guarantees are adopted. These links are provenance, not runtime dependencies.

## Local verification

Three explicitly synthetic user turns exercised no-idea entry, existing-idea entry, and partial brief save/read-back/reopen through the existing authenticated preview. The registered skill was applied without truncation. The saved brief preserved a budget contradiction, unknown demand, excluded costs, an exploration-only choice, and proposed-only test criteria. The blank template remained byte-identical. Test artifacts were archived outside active Memory, and the live page was returned to empty owner scaffolds. No external business action was performed.

The historical functional checks used BrainDrive Models. The underlying model and per-request usage/cost were not exposed. These are limited functional checks, not billing evidence, broad quality evaluation, or market validation.

Related implementation: [skill registry](../../gateway/skills.ts), [project assignment](../../gateway/projects.ts), [Memory file tools](../../memory-tools/file-ops/server.ts), and [web UI](../../client_web/README.md). Normal Memory writes retain BrainDrive's automatic local Memory history; they are separate from application-source commits.
