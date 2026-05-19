import { describe, expect, it } from "vitest";

import { buildProjectChatContext } from "./server.js";

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
    expect(context).toContain("documents/finance/budget.md is read-only for that turn");
    expect(context).toContain("If you are about to write documents/finance/budget.md during a comparison, stop");
    expect(context).toContain("Put saved-budget comparison findings in documents/finance/reports/latest.md");
    expect(context).toContain("Check for duplicate or overlapping statement evidence");
    expect(context).toContain("build a source evidence ledger");
    expect(context).toContain("locked evidence for the comparison turn");
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
});
