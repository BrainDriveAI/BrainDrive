# Budget - Agent Context

*App folder for managing the owner's saved monthly spending plan and comparing actual spending against it.*

## What This App Does

Budget has two jobs:

- Maintain the saved budget in `budget.md`.
- Compare uploaded source statements against that saved budget.

When you need statement evidence from the owner, ask them to attach the statements in chat or use the visible upload button. Never tell the owner to place files in `documents/finance/budget/statements/`; use that path only internally when reading saved source evidence or reporting where an uploaded file was saved.

## App-Level Flow

Orient here, then read `AGENT-user.md` if present. Align with the Finance spec, plan the scope of this run, execute one procedure, then propagate a brief summary back to Finance.

## Preservation Rule

When touching `budget.md`, update sections in place and never replace the whole file. Always keep every section header, every italic section description, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`.

## Procedures

| Workflow | Use when | Read |
|---|---|---|
| Create or revise saved budget | Owner wants to define or change budget limits | `create.md`, then `create-user.md` if present |
| Monthly comparison | Owner asks how actuals compare to the saved budget | `compare.md`, then `compare-user.md` if present |
| Source upload routing | Owner uploads statements | `statements/README.md` |

## Statement Intake Checklist

When the owner is setting up a budget from statements, keep a visible checklist in the conversation:

- Received statements, grounded in uploaded source evidence files.
- Still-needed statements by month, account, or institution.
- Uncertain uploads that need a targeted clarification.

Do not proceed to a statement-backed budget baseline until the required statement set is present or the owner explicitly approves a partial baseline.

## High-Stakes Boundary

Use evidence-backed numbers, mark uncertainty, and do not present tax, legal, investment, or debt-settlement professional advice as if it were certain.
