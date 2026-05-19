import { describe, expect, it } from "vitest";

import {
  buildProjectChatContext,
  conversationHasSavedBudgetComparison,
  createFinanceBudgetProtectionGuard,
  isProtectedFinanceBudgetMutation,
} from "./server.js";
import type { ConversationDetail } from "../contracts.js";

describe("project chat context", () => {
  it("includes current project files and warns against stale delete claims", () => {
    const context = buildProjectChatContext("finance", [
      {
        name: "dummy-statement.md",
        path: "documents/finance/dummy-statement.md",
      },
      {
        name: "plan.md",
        path: "documents/finance/plan.md",
      },
      {
        name: "index.md",
        path: "documents/finance/index.md",
      },
      {
        name: "budget.md",
        path: "documents/finance/budget.md",
      },
      {
        name: "rules.md",
        path: "documents/finance/rules.md",
      },
    ]);

    expect(context).toContain("## Active Project");
    expect(context).toContain("documents/finance/dummy-statement.md");
    expect(context).toContain("Read documents/finance/index.md before deciding which supporting documents to open");
    expect(context).toContain("For budgeting questions, also read documents/finance/budget.md and documents/finance/rules.md");
    expect(context).toContain("complete the Finance task before coaching or cross-domain discussion");
    expect(context).toContain("treat documents/finance/budget.md as the saved budget");
    expect(context).toContain("Use documents/finance/statements/ as source evidence");
    expect(context).toContain("Do not write to documents/finance/budget.md during a saved-budget comparison");
    expect(context).toContain("do not call memory_write, memory_edit, or memory_delete on documents/finance/budget.md");
    expect(context).toContain("Preserve documents/finance/budget.md byte-for-byte");
    expect(context).toContain("formatting-only, table-alignment, whitespace");
    expect(context).toContain("documents/finance/budget.md is read-only for that turn");
    expect(context).toContain("If you are about to write documents/finance/budget.md during a comparison, stop");
    expect(context).toContain("Put saved-budget comparison findings in documents/finance/reports/latest.md");
    expect(context).toContain("Check for duplicate or overlapping statement evidence");
    expect(context).toContain("build a source evidence ledger");
    expect(context).toContain("locked evidence for the comparison turn");
    expect(context).toContain("verify that every owner-named item found in source statements appears by exact statement description");
    expect(context).toContain("Owner-Requested Items Audit");
    expect(context).toContain("sources checked, exact source match, amount, date, and final report treatment");
    expect(context).toContain("compare the Owner-Requested Items Audit rows against the final report sections");
    expect(context).toContain("account for named merchants");
    expect(context).toContain("date range overlaps the requested month");
    expect(context).toContain("call memory_list on documents/finance and documents/finance/statements");
    expect(context).toContain("do not accept a later conversational guess that it was absent");
    expect(context).toContain("New Or Unbudgeted Items section");
    expect(context).toContain("exact transaction description");
    expect(context).toContain("Budget report summaries must agree with their category tables");
    expect(context).toContain("literal 'Excluded From Expense Totals' section");
    expect(context).toContain("credit-card or debt payments");
    expect(context).toContain("never pause, stop, or redirect unfinished budget");
    expect(context).toContain("current file list at the start of this user turn");
    expect(context).toContain("Do not rely on earlier conversation claims");
    expect(context).toContain("call memory_delete when a matching file exists");
  });

  it("blocks Finance saved-budget comparison writes to budget.md", () => {
    const guard = createFinanceBudgetProtectionGuard("finance", conversationWithUserMessages([
      "I uploaded another month of transactions. Using the saved budget in documents/finance/budget.md, how did I do? Do not rewrite the saved budget unless I ask.",
    ]));

    const result = guard?.("memory_write", {
      path: "documents/finance/budget.md",
      content: "# Rewritten budget\n",
    });

    expect(result?.status).toBe("error");
    expect(result?.recoverable).toBe(true);
    expect(result?.output).toMatchObject({
      code: "permission_denied",
      path: "documents/finance/budget.md",
      recoverable: true,
    });
  });

  it("allows report writes during Finance saved-budget comparisons", () => {
    const guard = createFinanceBudgetProtectionGuard("finance", conversationWithUserMessages([
      "Compare actual spending against the saved limits in budget.md and refresh reports/latest.md.",
    ]));

    const result = guard?.("memory_write", {
      path: "documents/finance/reports/latest.md",
      content: "# Report\n",
    });

    expect(result).toBeNull();
  });

  it("allows explicit saved-budget revisions", () => {
    const guard = createFinanceBudgetProtectionGuard("finance", conversationWithUserMessages([
      "Using the saved budget in documents/finance/budget.md, how did I do this month?",
      "Please update the saved budget and change my dining limit to 100.",
    ]));

    expect(guard).toBeUndefined();
  });

  it("detects protected Finance budget mutation paths", () => {
    expect(isProtectedFinanceBudgetMutation("memory_edit", { path: "./documents/finance/budget.md" })).toBe(true);
    expect(isProtectedFinanceBudgetMutation("memory_delete", { path: "documents\\finance\\budget.md" })).toBe(true);
    expect(isProtectedFinanceBudgetMutation("memory_read", { path: "documents/finance/budget.md" })).toBe(false);
    expect(isProtectedFinanceBudgetMutation("memory_write", { path: "documents/finance/reports/latest.md" })).toBe(false);
  });

  it("recognizes saved-budget comparison conversation state", () => {
    expect(conversationHasSavedBudgetComparison(conversationWithUserMessages([
      "Using the saved budget in documents/finance/budget.md, compare actual spending against saved limits.",
    ]))).toBe(true);
    expect(conversationHasSavedBudgetComparison(conversationWithUserMessages([
      "Please build my first budget from these statements.",
    ]))).toBe(false);
  });
});

function conversationWithUserMessages(messages: string[]): ConversationDetail {
  return {
    id: "conversation-test",
    title: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    messages: messages.map((content, index) => ({
      id: `message-${index}`,
      role: "user",
      content,
      timestamp: "2026-05-19T00:00:00.000Z",
    })),
  };
}
