# Budget Rules

*Managed default rule framework for Budget categorization and comparison.*

Read this file first, then read `budget-rules-user.md` if it exists. Put owner-approved recurring merchant/category mappings and personal rules in `budget-rules-user.md`, not here.

## Allowed Transaction Types

`expense`, `income`, `transfer`, `refund`, `fee`, `debt_payment`, `finance_charge`.

## Default Handling

- Credit-card and debt payments are `debt_payment`, not ordinary spending.
- Interest and finance charges are `finance_charge`, tracked separately from principal payments.
- Transfers, income, refunds, investment movement, and debt payments do not count against ordinary expense categories by default.
- Fees may be tracked as expenses only when that matches the owner's budget goals.

## Owner Rule Overlay

When the owner approves a recurring rule, create or update `budget-rules-user.md`. Ask before adding new durable rules.

## Safety Notes

Use source evidence for statement-backed claims. Mark uncertainty as Needs Review instead of guessing.
