import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { reconcileFinanceBudgetReviewState } from "../../src/memory-core.js";

describe("Finance Budget review-state reconciliation", () => {
  it("repairs a stale Finance plan after one Needs Review merchant is resolved", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "finance-budget-review-state-"));

    try {
      await writeSeedMemory(memoryRoot);

      const invalid = await reconcileFinanceBudgetReviewState(memoryRoot);
      expect(invalid.status).toBe("invalid");
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Active Needs Review item Blue Door Payment ($67.50) is missing from the Finance plan."
      );
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Resolved review item MJP Services still appears as unresolved in the Finance plan."
      );

      const repaired = await reconcileFinanceBudgetReviewState(memoryRoot, { repair: true });
      expect(repaired.status).toBe("repaired");
      expect(repaired.issues).toEqual([]);
      expect(repaired.files_changed).toEqual(["documents/finance/plan.md"]);

      const plan = await readFile(path.join(memoryRoot, "documents", "finance", "plan.md"), "utf8");
      expect(plan).toContain("Clarify Blue Door Payment ($67.50) to finish the remaining Needs Review item.");
      expect(plan).toContain("Resolved review items: MJP Services ($184.00).");
      expect(plan).not.toMatch(/two unclassified merchants/i);
      expect(plan).not.toMatch(/Clarify.*MJP Services/i);
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });
});

async function writeSeedMemory(memoryRoot: string): Promise<void> {
  await mkdir(path.join(memoryRoot, "documents", "finance", "budget", "reports"), { recursive: true });
  await mkdir(path.join(memoryRoot, "me"), { recursive: true });

  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "budget.md"),
    [
      "# Budget",
      "",
      "## Reconciliation Check",
      "",
      "| Line | Amount | Notes |",
      "|---|---:|---|",
      "| Owner review pending | 67.50 | Total for unclassified Blue Door Payment ($67.50). MJP Services successfully classified. |",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "reports", "latest.md"),
    [
      "# Latest Budget Report",
      "",
      "## Needs Review",
      "",
      "| Date | Description | Amount | Reason |",
      "|---|---|---:|---|",
      "| 2026-04-09 | Blue Door Payment | 67.50 | Unknown payee |",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(memoryRoot, "documents", "finance", "plan.md"),
    [
      "# Finance Plan",
      "",
      "## Right Now - Your First Step",
      "",
      "Review the draft budget in the saved Budget and clarify the two unclassified merchants (MJP Services and Blue Door) to lock in our baseline.",
      "",
      "## What Needs More Work",
      "",
      "- Confirm regular monthly limits for variable spending.",
      "- Clarify medical/therapy or subscription lumpy bills.",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(memoryRoot, "me", "todo.md"),
    [
      "# My Todos",
      "",
      "## Active",
      "",
      "- [ ] Clarify what the Blue Door Payment ($67.50) transaction was for #finance",
      "",
      "## Completed",
      "",
      "- [x] Clarify if MJP Services ($184.00) is a regular medical/therapy bill or another category #finance",
      "",
    ].join("\n"),
    "utf8"
  );
}
