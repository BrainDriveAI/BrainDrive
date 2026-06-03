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

  it("removes stale mystery and ambiguous-merchant plan language after all review merchants are resolved", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "finance-budget-review-state-resolved-"));

    try {
      await writeAllResolvedSeedMemory(memoryRoot);

      const invalid = await reconcileFinanceBudgetReviewState(memoryRoot);
      expect(invalid.status).toBe("invalid");
      expect(invalid.active_review_items).toEqual([]);
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Resolved review item MJP Services still appears as unresolved in the Finance plan."
      );
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Resolved review item Blue Door Payment still appears as unresolved in the Finance plan."
      );

      const repaired = await reconcileFinanceBudgetReviewState(memoryRoot, { repair: true });
      expect(repaired.status).toBe("repaired");
      expect(repaired.issues).toEqual([]);
      expect(repaired.files_changed).toEqual([
        "documents/finance/budget/budget.md",
        "documents/finance/budget/reports/latest.md",
        "documents/finance/plan.md",
      ]);

      const budget = await readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8");
      expect(budget).toContain("Resolved owner-reviewed items");
      expect(budget).not.toMatch(/Unreconciled - Needs Review\s*\|\s*0\.00/i);
      expect(budget).not.toMatch(/Owner review pending\s*\|\s*0\.00/i);

      const latest = await readFile(path.join(memoryRoot, "documents", "finance", "budget", "reports", "latest.md"), "utf8");
      expect(latest).toContain("## Resolved Owner-Reviewed Items");
      expect(latest).not.toContain("## Needs Review");
      expect(latest).not.toMatch(/\bowner review\b/i);

      const plan = await readFile(path.join(memoryRoot, "documents", "finance", "plan.md"), "utf8");
      expect(plan).toContain("no active merchant clarification remains");
      expect(plan).toContain("## Budget Clarifications");
      expect(plan).toContain("Resolved review items: MJP Services ($184.00), Blue Door Payment ($67.50).");
      expect(plan).not.toMatch(/Clarify the mystery transactions/i);
      expect(plan).not.toMatch(/Understanding Ambiguous Merchants/i);
      expect(plan).not.toMatch(/Inputs Needed.*MJP Services/i);
      expect(plan).not.toMatch(/Inputs Needed.*Blue Door/i);
      expect(plan).not.toMatch(/MJP Services.*(?:clarify|mystery|ambiguous|needs review)/i);
      expect(plan).not.toMatch(/Blue Door Payment.*(?:clarify|mystery|ambiguous|needs review)/i);
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("repairs resolved review vocabulary across Budget, latest report, and Finance plan", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "finance-budget-review-vocabulary-"));

    try {
      await writeResolvedVocabularySeedMemory(memoryRoot);

      const invalid = await reconcileFinanceBudgetReviewState(memoryRoot);
      expect(invalid.status).toBe("invalid");
      expect(invalid.active_review_items).toEqual([]);
      expect(invalid.issues.map((issue) => issue.path)).toEqual([
        "documents/finance/budget/budget.md",
        "documents/finance/budget/reports/latest.md",
        "documents/finance/plan.md",
        "documents/finance/plan.md",
      ]);

      const repaired = await reconcileFinanceBudgetReviewState(memoryRoot, { repair: true });
      expect(repaired.status).toBe("repaired");
      expect(repaired.issues).toEqual([]);
      expect(repaired.files_changed).toEqual([
        "documents/finance/budget/budget.md",
        "documents/finance/budget/reports/latest.md",
        "documents/finance/plan.md",
      ]);

      const budget = await readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8");
      expect(budget).toContain("Resolved owner-reviewed items");
      expect(budget).toContain("MJP Services ($184.00)");
      expect(budget).toContain("Blue Door Payment ($67.50)");
      expect(budget).not.toMatch(/Unreconciled - Needs Review\s*\|\s*0\.00/i);
      expect(budget).not.toMatch(/Owner review pending\s*\|\s*0\.00/i);

      const latest = await readFile(path.join(memoryRoot, "documents", "finance", "budget", "reports", "latest.md"), "utf8");
      expect(latest).toContain("## Resolved Owner-Reviewed Items");
      expect(latest).toContain("MJP Services");
      expect(latest).toContain("Blue Door Payment");
      expect(latest).toContain("owner confirmation recommended");
      expect(latest).not.toContain("## Needs Review");
      expect(latest).not.toMatch(/\bowner review\b/i);
      expect(latest).not.toMatch(/matches to the penny/i);

      const plan = await readFile(path.join(memoryRoot, "documents", "finance", "plan.md"), "utf8");
      expect(plan).toContain("## Budget Clarifications");
      expect(plan).toContain("MJP Services ($184.00) is resolved");
      expect(plan).toContain("Blue Door Payment ($67.50) is resolved");
      expect(plan).not.toMatch(/Clarify.*MJP Services/i);
      expect(plan).not.toMatch(/Clarify.*Blue Door Payment/i);
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("repairs shortened Needs Review labels in a populated saved Budget", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "finance-budget-review-budget-label-"));

    try {
      await writeAbbreviatedBudgetReviewSeedMemory(memoryRoot, { starterBudget: false });

      const invalid = await reconcileFinanceBudgetReviewState(memoryRoot);
      expect(invalid.status).toBe("invalid");
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Active Needs Review item Blue Door Payment ($67.50) is missing from the saved Budget."
      );

      const repaired = await reconcileFinanceBudgetReviewState(memoryRoot, { repair: true });
      expect(repaired.status).toBe("repaired");
      expect(repaired.issues).toEqual([]);
      expect(repaired.files_changed).toEqual(["documents/finance/budget/budget.md"]);

      const budget = await readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8");
      expect(budget).toContain("MJP Services ($184.00)");
      expect(budget).toContain("Blue Door Payment ($67.50)");
      expect(budget).not.toContain("Blue Door ($67.50)");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("does not mask a starter saved Budget as repaired", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "finance-budget-review-starter-"));

    try {
      await writeAbbreviatedBudgetReviewSeedMemory(memoryRoot, { starterBudget: true });

      const repaired = await reconcileFinanceBudgetReviewState(memoryRoot, { repair: true });
      expect(repaired.status).toBe("invalid");
      expect(repaired.files_changed).toEqual([]);
      expect(repaired.issues.map((issue) => issue.message).join("\n")).toContain(
        "Saved Budget is still a starter template; write the Budget draft before reconciling review labels."
      );

      const budget = await readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8");
      expect(budget).toContain("**Status:** Starter template - not yet customized");
      expect(budget).not.toContain("## Needs Review");
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

async function writeAllResolvedSeedMemory(memoryRoot: string): Promise<void> {
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
      "| Unreconciled - Needs Review | 0.00 | All rows reconcile to budget sums |",
      "| Owner review pending | 0.00 | All items resolved. |",
      "",
      "## Changelog",
      "",
      "- Incorporated owner classifications: MJP Services ($184.00) under Health and Blue Door Payment ($67.50) under Shopping.",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "reports", "latest.md"),
    [
      "# Latest Budget Report",
      "",
      "## Summary",
      "",
      "- Items needing owner review: None.",
      "",
      "## Needs Review",
      "",
      "*No transactions currently need review.*",
      "",
      "| Date | Description | Amount | Reason |",
      "|---|---|---:|---|",
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
      "- **Clarify the mystery transactions:** Identify what \"MJP Services\" ($184.00) and \"Blue Door Payment\" ($67.50) represent to complete the category baseline.",
      "- **Inputs Needed:** Confirm what MJP Services and Blue Door represent.",
      "",
      "## The Roadmap",
      "",
      "- **Understanding Ambiguous Merchants:** Solving the mystery of MJP Services and Blue Door Payment.",
      "",
      "## What Needs More Work",
      "",
      "- **Understanding Ambiguous Merchants:** Solving the mystery of MJP Services and Blue Door Payment.",
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
      "- [ ] Clarify recurring nature of April auto/vet costs #finance",
      "",
      "## Completed",
      "",
      "- [x] Research MJP Services merchant details ($184.00) #finance",
      "- [x] Research Blue Door Payment merchant details ($67.50) #finance",
      "",
    ].join("\n"),
    "utf8"
  );
}

async function writeResolvedVocabularySeedMemory(memoryRoot: string): Promise<void> {
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
      "| Unreconciled - Needs Review | $0.00 | Target matches visible rows |",
      "| Owner review pending | $0.00 | Resolved Blue Door and MJP |",
      "",
      "## Owner Notes",
      "",
      "- Blue Door Payment is confirmed as roommate/rent portion.",
      "- MJP Services is confirmed as the therapist charge.",
      "",
      "## Owner-Requested Items Audit",
      "",
      "| Requested Item | Search Result | Amount | Report Treatment |",
      "|---|---|---:|---|",
      "| MJP Services | Found | $184.00 | Health/Therapy expense |",
      "| Blue Door Payment | Found | $67.50 | Rent portion |",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "reports", "latest.md"),
    [
      "# Latest Budget Report",
      "",
      "## Summary",
      "",
      "- Items needing owner review: None. All uploaded ambiguous items (MJP Services, Blue Door Payment) have been mapped successfully.",
      "",
      "## Owner-Requested Items Audit",
      "",
      "| Requested Item | Search Result | Amount | Report Treatment |",
      "|---|---|---:|---|",
      "| MJP Services | Found | $184.00 | Health/Therapy expense |",
      "| Blue Door Payment | Found | $67.50 | Rent portion |",
      "",
      "## Debt Payoff Recommendation",
      "",
      "| Payment Target | Amount | Notes |",
      "|---|---:|---|",
      "| Extra-payment target to Northbridge Rewards Visa | $250.00 | Draft target, owner review needed |",
      "",
      "## Needs Review",
      "",
      "| Item | Amount | Source | Owner Action Needed |",
      "|---|---:|---|---|",
      "| Latest report category refresh | N/A | Source Coverage and saved Budget | Confirm report category rows against the saved Budget before final acceptance. |",
      "",
      "## Reconciliation Check",
      "",
      "Everything matches to the penny against the visible rows.",
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
      "- Confirm whether the Northbridge extra payment is comfortable against the cash buffer.",
      "",
      "## What Needs More Work",
      "",
      "- Confirm recurring nature of April auto/vet costs.",
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
      "- [ ] Confirm whether the $250.00 extra Northbridge payment feels safe against the checking buffer #finance",
      "",
      "## Completed",
      "",
      "",
    ].join("\n"),
    "utf8"
  );
}

async function writeAbbreviatedBudgetReviewSeedMemory(
  memoryRoot: string,
  options: { starterBudget: boolean }
): Promise<void> {
  await mkdir(path.join(memoryRoot, "documents", "finance", "budget", "reports"), { recursive: true });
  await mkdir(path.join(memoryRoot, "me"), { recursive: true });

  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "budget.md"),
    options.starterBudget
      ? [
          "# Budget",
          "",
          "*Saved monthly spending plan used by the Budget app.*",
          "",
          "**Status:** Starter template - not yet customized",
          "",
          "## Reconciliation Check",
          "",
          "| Line | Amount | Notes |",
          "|---|---:|---|",
          "| Owner review pending |  | Use 0 only when no active Needs Review merchants remain |",
          "",
        ].join("\n")
      : [
          "# Budget",
          "",
          "## Monthly Context",
          "",
          "| Field | Value |",
          "|---|---|",
          "| Target month | 2026-04 |",
          "",
          "## Reconciliation Check",
          "",
          "| Line | Amount | Notes |",
          "|---|---:|---|",
          "| Unreconciled - Needs Review | 251.50 | MJP Services ($184.00) + Blue Door ($67.50) are unmapped |",
          "| Owner review pending | 251.50 | Sum of unclassified Needs Review items |",
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
      "| Date | Description | Amount | Account | Reason | Temporary Treatment |",
      "|---|---|---:|---|---|---|",
      "| 2026-03-29 | MJP Services | 184.00 | Checking | Unmapped | Excluded from Base Spend |",
      "| 2026-04-09 | Blue Door Payment | 67.50 | Checking | Unmapped | Excluded from Base Spend |",
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
      "Clarify Blue Door Payment ($67.50) and MJP Services ($184.00) to finish the remaining Needs Review items.",
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
      "- [ ] Clarify what MJP Services ($184.00) was for #finance",
      "- [ ] Clarify what Blue Door Payment ($67.50) was for #finance",
      "",
    ].join("\n"),
    "utf8"
  );
}
