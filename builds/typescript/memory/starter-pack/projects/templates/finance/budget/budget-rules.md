# Budget Rules

*Owner-approved categorization, transaction-type, and exclusion rules for the Budget app. Used when categorizing transactions, building monthly comparisons, and deciding how to treat non-spending money movement. These rules govern Budget app categorization; other Finance apps may define their own rules if their treatment differs.*

**Status:** Starter scaffolding — owner-specific rules accumulate here as patterns emerge through use.

**Last updated:** —

## Instructions

Use these owner-approved rules before making new categorization decisions.

Rules are memory from the owner, not a substitute for judgment. Use them to make future budget conversations easier, but ask when a new pattern is uncertain or when a rule appears to conflict with statement evidence.

Ask before adding new rules. Append owner-approved rules; do not rewrite or delete existing rules unless the owner asks for cleanup.

Good rules capture durable intent — recurring merchant categories, credit-card payment handling, transfer handling, refund treatment, and owner-specific category preferences.

## Merchant Category Rules

| Pattern | Category | Notes |
|---|---|---|

## Transaction Type Rules

| Pattern | Type | Notes |
|---|---|---|

Allowed types: `expense`, `income`, `transfer`, `refund`, `fee`, `debt_payment`, `finance_charge`.

Use transaction type rules to keep budget spending separate from money movement. Credit card payments, transfers between owner accounts, income deposits, refunds, and fees should be handled explicitly instead of folded into normal expenses by accident.

For monthly budget comparisons, credit-card and debt payments are `debt_payment`, not ordinary spending. Interest or finance-charge lines from card statements are `finance_charge`, tracked separately from ordinary spending and separately from principal payments.

## Exclusions

| Pattern | Reason | Notes |
|---|---|---|
| payment to credit-card issuer or debt account | Debt payment / transfer | Exclude from ordinary expense totals; list by source payee/account in `Excluded From Expense Totals`. |
| Interest charge | Finance charge | Exclude from ordinary expense totals; track separately from principal payments. |
| Finance charge | Finance charge | Exclude from ordinary expense totals; track separately from principal payments. |

Transfers, income, refunds, investment account movement, and credit card payments should not count against expense categories by default. Fees may be tracked as expenses only when that matches the owner's budget goals.

## Changelog

Material changes to these rules — new merchant category mapping confirmed, transaction-type rule added or revised, exclusion added. Append-only style; do not rewrite or remove past entries unless the owner asks for cleanup.

*Example:*

> *2026-06-10 — Added merchant rule: `WHOLE FOODS MKT` → Groceries. Was previously surfacing in `Needs Review` because the owner uses both Whole Foods and Trader Joe's for groceries.*
> *2026-05-23 — File initialized as starter scaffolding. No owner rules yet.*

*To be filled as rules are added.*
