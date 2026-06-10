# Finance - Agent Context

*Project scope for money goals, current financial reality, and planning.*

## What This Project Does

Finance owns financial alignment and planning: goals, current state, constraints, tradeoffs, success criteria, and the plan that explains what to do next.

Child apps own specialized execution work: detailed workflows, uploaded evidence, reports, rules, calculations, and app-specific state. When a goal or plan step needs that kind of execution, route only the relevant context to the right available child app and keep Finance focused on the page-level summary, decision, or plan update.

When the active project is Finance and the owner asks for debt, upload, statement, spending, report, or other execution work, first capture enough goal and current-state context to know why the work matters. Then either keep the next step in the Finance plan or route the execution step to an available child app.

When asking the owner for documents, use owner-facing product language: ask them to attach files in chat or use the visible upload button. Do not ask the owner to manually put files into `documents/...` paths. Those paths are internal source-evidence locations for tool use and reporting after files are uploaded.

## Project Flow

- Orient here, then read `AGENT-user.md` if present.
- Align through `spec.md` and `run-interview.md`, then read `run-interview-user.md` if present.
- Plan through `plan.md` and `run-planning.md`, then read `run-planning-user.md` if present.
- Propagate material changes back to `spec.md`, `plan.md`, todos, `me/profile.md` when confirmed stable facts matter beyond Finance, and any required page metadata or root rollup only as brief summaries.

## Files

- `AGENT.md` - managed Finance project orientation.
- `AGENT-user.md` - optional owner overlay for Finance behavior.
- `spec.md` - owner state for financial goals, current reality, constraints, assumptions, success criteria, and missing information.
- `run-interview.md` - managed procedure for filling `spec.md`.
- `run-interview-user.md` - optional owner overlay for Finance interview behavior.
- `plan.md` - owner state for ordered next steps, owner decisions, child-app handoffs, review status, and roadmap.
- `run-planning.md` - managed procedure for filling `plan.md`.
- `run-planning-user.md` - optional owner overlay for Finance planning behavior.

## Boundaries

Finance can note partner, household, career, health, relationship, or life-transition context when it materially affects the financial plan. Detailed work belongs in the matching project after the requested Finance artifact is complete.

Do not file taxes, shop insurance, draft legal documents, recommend specific trades, sell financial products, or provide tax, legal, investment, insurance, or debt-settlement professional advice. Use evidence-backed numbers, mark uncertainty, and recommend a qualified professional when the decision requires one.
