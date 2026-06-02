import { describe, expect, it, vi } from "vitest";

import {
  buildDurableClaimSafeResponse,
  buildProjectChatContext,
  createBrainDriveMemorySafetyGuard,
  conversationHasSavedBudgetComparison,
  createFinanceBudgetProtectionGuard,
  isProtectedFinanceBudgetMutation,
  ownerLabelForUploadedDocument,
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
        name: "AGENT.md",
        path: "documents/finance/budget/AGENT.md",
      },
      {
        name: "budget.md",
        path: "documents/finance/budget/budget.md",
      },
      {
        name: "budget-rules.md",
        path: "documents/finance/budget/budget-rules.md",
      },
    ]);

    expect(context).toContain("## Active Project");
    expect(context).toContain("documents/finance/dummy-statement.md");
    expect(context).toContain("Read documents/finance/AGENT.md, then documents/finance/AGENT-user.md if present");
    expect(context).toContain("read documents/finance/budget/AGENT.md, then documents/finance/budget/AGENT-user.md if present");
    expect(context).toContain("read documents/finance/budget/budget.md, documents/finance/budget/budget-rules.md, and documents/finance/budget/budget-rules-user.md");
    expect(context).toContain("do not rely on documents/finance/index.md, documents/finance/rules.md, or documents/finance/budgeting/");
    expect(context).toContain("complete the Finance task before coaching or cross-domain discussion");
    expect(context).toContain("attach files in chat or use the visible upload button");
    expect(context).toContain("Do not ask the owner to manually place files into documents/finance");
    expect(context).toContain("Internal Memory paths are for tool use only");
    expect(context).toContain("For Budget creation requests, make the saved Budget the primary deliverable");
    expect(context).toContain("draft actuals baseline, not a stable budget");
    expect(context).toContain("propagate state to Finance spec, Finance plan, and Todo list");
    expect(context).toContain("treat documents/finance/budget/budget.md as the saved budget");
    expect(context).toContain("Use documents/finance/budget/statements/ as source evidence");
    expect(context).toContain("visible received/missing statement checklist");
    expect(context).toContain("Do not write to documents/finance/budget/budget.md during a saved-budget comparison");
    expect(context).toContain("do not call memory_write, memory_edit, or memory_delete on documents/finance/budget/budget.md");
    expect(context).toContain("Preserve documents/finance/budget/budget.md byte-for-byte");
    expect(context).toContain("formatting-only, table-alignment, whitespace");
    expect(context).toContain("documents/finance/budget/budget.md is read-only for that turn");
    expect(context).toContain("If you are about to write documents/finance/budget/budget.md during a comparison, stop");
    expect(context).toContain("Put saved-budget comparison findings in documents/finance/budget/reports/latest.md");
    expect(context).toContain("Do not write a monthly archive");
    expect(context).toContain("Check for duplicate or overlapping statement evidence");
    expect(context).toContain("build a source evidence ledger");
    expect(context).toContain("locked evidence for the comparison turn");
    expect(context).toContain("verify that every owner-named item found in source statements appears by exact statement description");
    expect(context).toContain("Owner-Requested Items Audit");
    expect(context).toContain("sources checked, exact source match, amount, date, and final report treatment");
    expect(context).toContain("compare the Owner-Requested Items Audit rows against the final report sections");
    expect(context).toContain("account for named merchants");
    expect(context).toContain("date range overlaps the requested month");
    expect(context).toContain("call memory_list on documents/finance/budget and documents/finance/budget/statements");
    expect(context).toContain("do not accept a later conversational guess that it was absent");
    expect(context).toContain("New Or Unbudgeted Items section");
    expect(context).toContain("exact transaction description");
    expect(context).toContain("Budget report summaries must agree with their category tables");
    expect(context).toContain("mark the artifact Needs Review");
    expect(context).toContain("literal 'Excluded From Expense Totals' section");
    expect(context).toContain("credit-card or debt payments");
    expect(context).toContain("never pause, stop, or redirect unfinished budget");
    expect(context).toContain("current file list at the start of this user turn");
    expect(context).toContain("Do not rely on earlier conversation claims");
    expect(context).toContain("call memory_delete when a matching file exists");
  });

  it("adds app-scope context when client metadata selects an app folder", () => {
    const context = buildProjectChatContext("finance", [
      {
        name: "AGENT.md",
        path: "documents/finance/AGENT.md",
      },
      {
        name: "budget/AGENT.md",
        path: "documents/finance/budget/AGENT.md",
      },
      {
        name: "budget/AGENT-user.md",
        path: "documents/finance/budget/AGENT-user.md",
      },
      {
        name: "budget/budget.md",
        path: "documents/finance/budget/budget.md",
      },
      {
        name: "budget/budget-rules.md",
        path: "documents/finance/budget/budget-rules.md",
      },
      {
        name: "budget/budget-rules-user.md",
        path: "documents/finance/budget/budget-rules-user.md",
      },
      {
        name: "budget/statements/2026-05-card.md",
        path: "documents/finance/budget/statements/2026-05-card.md",
      },
      {
        name: "budget/reports/latest.md",
        path: "documents/finance/budget/reports/latest.md",
      },
    ], { appPath: "budget" });

    expect(context).toContain("### Active App Scope");
    expect(context).toContain("focused on the app folder documents/finance/budget/");
    expect(context).toContain("Read documents/finance/budget/AGENT.md, then documents/finance/budget/AGENT-user.md");
    expect(context).toContain("Treat documents/finance/budget/budget.md as this app's owner state file");
    expect(context).toContain("read documents/finance/budget/budget-rules.md, then documents/finance/budget/budget-rules-user.md");
    expect(context).toContain("Use documents/finance/budget/statements/ as app source evidence");
    expect(context).toContain("Use documents/finance/budget/reports/ for app-generated reports");
  });

  it("blocks Finance saved-budget comparison writes to budget.md", () => {
    const guard = createFinanceBudgetProtectionGuard("finance", conversationWithUserMessages([
      "I uploaded another month of transactions. Using the saved budget in documents/finance/budget/budget.md, how did I do? Do not rewrite the saved budget unless I ask.",
    ]));

    const result = guard?.("memory_write", {
      path: "documents/finance/budget/budget.md",
      content: "# Rewritten budget\n",
    });

    expect(result?.status).toBe("error");
    expect(result?.recoverable).toBe(true);
    expect(result?.output).toMatchObject({
      code: "permission_denied",
      path: "documents/finance/budget/budget.md",
      recoverable: true,
    });
  });

  it("allows report writes during Finance saved-budget comparisons", () => {
    const guard = createFinanceBudgetProtectionGuard("finance", conversationWithUserMessages([
      "Compare actual spending against the saved limits in budget.md and refresh reports/latest.md.",
    ]));

    const result = guard?.("memory_write", {
      path: "documents/finance/budget/reports/latest.md",
      content: "# Report\n",
    });

    expect(result).toBeNull();
  });

  it("allows explicit saved-budget revisions", () => {
    const guard = createFinanceBudgetProtectionGuard("finance", conversationWithUserMessages([
      "Using the saved budget in documents/finance/budget/budget.md, how did I do this month?",
      "Please update the saved budget and change my dining limit to 100.",
    ]));

    expect(guard).toBeUndefined();
  });

  it("detects protected Finance budget mutation paths", () => {
    expect(isProtectedFinanceBudgetMutation("memory_edit", { path: "./documents/finance/budget/budget.md" })).toBe(true);
    expect(isProtectedFinanceBudgetMutation("memory_delete", { path: "documents\\finance\\budget\\budget.md" })).toBe(true);
    expect(isProtectedFinanceBudgetMutation("memory_read", { path: "documents/finance/budget/budget.md" })).toBe(false);
    expect(isProtectedFinanceBudgetMutation("memory_write", { path: "documents/finance/budget/reports/latest.md" })).toBe(false);
  });

  it("recognizes saved-budget comparison conversation state", () => {
    expect(conversationHasSavedBudgetComparison(conversationWithUserMessages([
      "Using the saved budget in documents/finance/budget/budget.md, compare actual spending against saved limits.",
    ]))).toBe(true);
    expect(conversationHasSavedBudgetComparison(conversationWithUserMessages([
      "Please build my first budget from these statements.",
    ]))).toBe(false);
  });

  it("rewrites a Todo save claim when same-turn write evidence is missing", () => {
    const safeResponse = buildDurableClaimSafeResponse(
      "I have added these actions directly to your Todo list so you can follow up.",
      []
    );

    expect(safeResponse.changed).toBe(true);
    expect(safeResponse.text).not.toContain("I have added these actions directly to your Todo list");
    expect(safeResponse.text).toContain("I recommend the related Todo list updates");
    expect(safeResponse.text).toContain("could not verify");
  });

  it("does not rewrite a Todo claim backed by a changed Todo artifact summary", () => {
    const safeResponse = buildDurableClaimSafeResponse(
      "I've updated your active Todo list with set up autopay.",
      [{
        path: "me/todo.md",
        status: "modified",
        summary: "heading: My Todos; 1 checkbox task; task preview: - [ ] Set up credit card autopay #finance",
      }]
    );

    expect(safeResponse.changed).toBe(false);
  });

  it("distinguishes statement PDFs from transaction CSVs in owner-facing upload labels", () => {
    const metadata = {
      statementLike: true,
      institution: "Cedar Atlantic",
      accountType: "checking",
      documentType: "bank_statement",
    };

    expect(ownerLabelForUploadedDocument(metadata, "cedar", "ai_pdf_to_markdown")).toBe(
      "Cedar Atlantic checking statement PDF"
    );
    expect(ownerLabelForUploadedDocument(metadata, "cedar", "direct_csv_upload")).toBe(
      "Cedar Atlantic checking transactions CSV"
    );
  });

  it("blocks open-period durable monthly report archives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26));
    try {
      const guard = createBrainDriveMemorySafetyGuard("finance", conversationWithUserMessages([
        "Compare May against my saved budget.",
      ]));

      const result = guard("memory_write", {
        path: "documents/finance/budget/reports/monthly-2026-05.md",
        content: "# May report\n",
      });

      expect(result?.status).toBe("error");
      expect(result?.output).toMatchObject({
        code: "permission_denied",
        path: "documents/finance/budget/reports/monthly-2026-05.md",
      });
      expect(guard("memory_write", {
        path: "documents/finance/budget/reports/latest.md",
        content: "# Latest report\n",
      })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
