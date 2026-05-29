# Budget - Agent Context

*App folder for managing the owner's saved monthly spending plan and comparing actual spending against it.*

## What This App Does

Budget has two jobs:

- Maintain the saved budget in `budget.md`.
- Compare uploaded source statements against that saved budget.

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

## High-Stakes Boundary

Use evidence-backed numbers, mark uncertainty, and do not present tax, legal, investment, or debt-settlement professional advice as if it were certain.
