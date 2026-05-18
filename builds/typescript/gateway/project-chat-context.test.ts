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
    expect(context).toContain("Do not replace saved budget limits during comparison");
    expect(context).toContain("Check for duplicate or overlapping statement evidence");
    expect(context).toContain("partner coaching belongs in the Relationships project");
    expect(context).toContain("current file list at the start of this user turn");
    expect(context).toContain("Do not rely on earlier conversation claims");
    expect(context).toContain("call memory_delete when a matching file exists");
  });
});
