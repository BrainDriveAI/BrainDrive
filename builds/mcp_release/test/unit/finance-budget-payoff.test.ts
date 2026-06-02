import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateFinanceBudgetPayoffPlan } from "../../src/memory-core.js";

describe("Finance Budget payoff plan validation", () => {
  it("detects and repairs minimum-only payoff artifacts", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "finance-budget-payoff-"));

    try {
      await writeSeedMemory(memoryRoot);

      const invalid = await validateFinanceBudgetPayoffPlan(memoryRoot);
      expect(invalid.status).toBe("invalid");
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Missing extra-payment target (250.00)."
      );
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Missing priority-card target payment (389.00)."
      );
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Missing total monthly card payment target (506.00)."
      );

      const repaired = await validateFinanceBudgetPayoffPlan(memoryRoot, { repair: true });
      expect(repaired.status).toBe("repaired");
      expect(repaired.issues).toEqual([]);
      expect(repaired.files_changed.sort()).toEqual([
        "documents/finance/budget/budget.md",
        "documents/finance/budget/reports/latest.md",
        "documents/finance/plan.md",
      ]);

      const repairedBudget = await readMemoryText(memoryRoot, "documents/finance/budget/budget.md");
      const repairedReport = await readMemoryText(memoryRoot, "documents/finance/budget/reports/latest.md");
      const repairedPlan = await readMemoryText(memoryRoot, "documents/finance/plan.md");

      for (const content of [repairedBudget, repairedReport, repairedPlan]) {
        expect(content).toContain("Northbridge Rewards Visa");
        expect(content).toContain("22.49%");
        expect(content).toContain("Summit Trail Everyday Mastercard");
        expect(content).toContain("20.74%");
        expect(content).toContain("250.00");
        expect(content).toContain("389.00");
        expect(content).toContain("506.00");
      }
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });
});

async function writeSeedMemory(memoryRoot: string): Promise<void> {
  await mkdir(path.join(memoryRoot, "documents", "finance", "budget", "reports"), { recursive: true });

  const instruction = [
    "# Budget - Agent Context",
    "",
    "For the Katie fixture values, this means: Northbridge Rewards Visa priority at 22.49% APR, Summit Trail Everyday Mastercard secondary at 20.74% APR, Northbridge minimum $139.00, Summit minimum $117.00, extra-payment target $250.00 above minimums, Northbridge target payment $389.00, and total monthly card payment target $506.00.",
    "",
  ].join("\n");

  await writeFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), instruction, "utf8");
  await writeFile(path.join(memoryRoot, "documents", "finance", "budget", "create.md"), instruction, "utf8");
  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "budget.md"),
    [
      "# Saved Budget",
      "",
      "## Debt Payoff Priority",
      "",
      "| Item | Amount | Notes |",
      "|---|---:|---|",
      "| Debt payoff goal | 256.00 | Minimum payments only for baseline, plus excess cash |",
      "| Extra-payment target | 0.00 | Pending review of savings and discretionary cash |",
      "| Priority card target payment | 139.00 | Priority minimum plus extra-payment target |",
      "| Total monthly card payment target | 256.00 | Both card minimums |",
      "",
      "## Changelog",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "reports", "latest.md"),
    [
      "# Latest Budget Report",
      "",
      "## Next Steps",
      "",
      "Target excess cash buffer to extra payments on the Northbridge Visa (22.49% APR).",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(memoryRoot, "documents", "finance", "plan.md"),
    [
      "# Finance Plan",
      "",
      "### Phase 2: Debt payoff acceleration",
      "",
      "- Route monthly surplus cash directly to the highest-interest card after confirming cash buffer needs.",
      "",
    ].join("\n"),
    "utf8"
  );
}

async function readMemoryText(memoryRoot: string, relativePath: string): Promise<string> {
  return readFile(path.join(memoryRoot, relativePath), "utf8");
}
