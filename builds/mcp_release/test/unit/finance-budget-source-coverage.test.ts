import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateFinanceBudgetSourceCoverage } from "../../src/memory-core.js";

describe("Finance Budget source coverage validation", () => {
  it("repairs blank Source Coverage tables from uploaded source metadata", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "finance-budget-source-coverage-"));

    try {
      await writeSourceCoverageSeedMemory(memoryRoot);

      const invalid = await validateFinanceBudgetSourceCoverage(memoryRoot);
      expect(invalid.status).toBe("invalid");
      expect(invalid.source_documents.map((document) => document.source_filename)).toEqual([
        "CedarAtlantic_Checking_2026-04-15.pdf",
        "HarborlineInvestments_RothIRA_2026-04.pdf",
        "SummitTrail_EverydayMastercard_2026-04.pdf",
      ]);
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Source Coverage is missing uploaded file CedarAtlantic_Checking_2026-04-15.pdf."
      );
      expect(invalid.issues.map((issue) => issue.message).join("\n")).toContain(
        "Latest Budget report is missing Recurring Candidates."
      );
      expect(invalid.recurring_candidates.map((candidate) => candidate.merchant)).toEqual([
        "ActiveLoop Fitness",
        "CloudBox Storage",
        "MealMap Pro",
        "Parkside Internet",
        "SignalHouse Mobile",
        "StoryNest Audio",
      ]);

      const repaired = await validateFinanceBudgetSourceCoverage(memoryRoot, { repair: true });
      expect(repaired.status).toBe("repaired");
      expect(repaired.issues).toEqual([]);
      expect(repaired.files_changed).toEqual(["documents/finance/budget/reports/latest.md"]);

      const latest = await readFile(
        path.join(memoryRoot, "documents", "finance", "budget", "reports", "latest.md"),
        "utf8"
      );
      expect(latest).toContain("CedarAtlantic_Checking_2026-04-15.pdf");
      expect(latest).toContain("SummitTrail_EverydayMastercard_2026-04.pdf");
      expect(latest).toContain("HarborlineInvestments_RothIRA_2026-04.pdf");
      expect(latest).toContain("Reviewed/excluded asset context");
      expect(latest).toContain("## Recurring Candidates");
      expect(latest).toContain("SignalHouse Mobile");
      expect(latest).toContain("Parkside Internet");
      expect(latest).toContain("StoryNest Audio");
      expect(latest).toContain("ActiveLoop Fitness");
      expect(latest).toContain("CloudBox Storage");
      expect(latest).toContain("MealMap Pro");
      expect(latest).toContain("owner confirmation required");
      expect(latest).toContain("## Source Evidence Ledger");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });
});

async function writeSourceCoverageSeedMemory(memoryRoot: string): Promise<void> {
  await mkdir(path.join(memoryRoot, "documents", "finance", "budget", "reports"), { recursive: true });
  await mkdir(path.join(memoryRoot, "documents", "finance", "budget", "statements"), { recursive: true });

  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "reports", "latest.md"),
    [
      "# Latest Budget Report",
      "",
      "## Source Coverage",
      "",
      "### Used For Budget Calculations",
      "",
      "| Uploaded File | Account/Institution | Coverage | Used For |",
      "|---|---|---|---|",
      "",
      "### Reviewed And Excluded From Spending Calculations",
      "",
      "| Uploaded File | Account/Institution | Coverage | Reason Excluded |",
      "|---|---|---|---|",
      "",
      "### Missing Or Rejected Files",
      "",
      "| Expected File | Reason | Next Step |",
      "|---|---|---|",
      "",
      "## Source Evidence Ledger",
      "",
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "statements", "2026-04-cedar.md"),
    sourceDocument({
      title: "Cedar Atlantic Checking",
      source_filename: "CedarAtlantic_Checking_2026-04-15.pdf",
      institution: "Cedar Atlantic Bank",
      account_type: "checking",
      statement_like: true,
      statement_period_start: "2026-03-17",
      statement_period_end: "2026-04-15",
      body: [
        "| Date | Merchant | Amount | Notes |",
        "|---|---|---:|---|",
        "| 2026-04-04 | SignalHouse Mobile | -78.23 | Monthly mobile bill |",
        "| 2026-04-09 | StoryNest Audio | -14.99 | Subscription |",
        "| 2026-04-13 | Parkside Internet | -89.00 | Internet |",
        "| 2026-04-18 | ActiveLoop Fitness | -44.00 | Gym membership |",
        "| 2026-04-22 | CloudBox Storage | -12.99 | Cloud storage |",
      ].join("\n"),
    }),
    "utf8"
  );
  await writeFile(
    path.join(memoryRoot, "documents", "finance", "budget", "statements", "2026-04-summit.md"),
    sourceDocument({
      title: "Summit Trail Mastercard",
      source_filename: "SummitTrail_EverydayMastercard_2026-04.pdf",
      institution: "Summit Trail Credit",
      account_type: "credit card",
      statement_like: true,
      statement_period_start: "2026-04-01",
      statement_period_end: "2026-04-30",
      body: [
        "| Date | Merchant | Amount | Notes |",
        "|---|---|---:|---|",
        "| 2026-04-15 | MealMap Pro | -19.99 | Monthly subscription |",
      ].join("\n"),
    }),
    "utf8"
  );
  await writeFile(
    path.join(memoryRoot, "documents", "finance", "harborlineinvestments-rothira-2026-04.md"),
    sourceDocument({
      title: "Harborline Roth IRA",
      source_filename: "HarborlineInvestments_RothIRA_2026-04.pdf",
      institution: "Harborline Investments",
      account_type: "investment",
      statement_like: false,
      statement_period_start: "2026-04-01",
      statement_period_end: "2026-04-30",
    }),
    "utf8"
  );
}

function sourceDocument(input: {
  title: string;
  source_filename: string;
  institution: string;
  account_type: string;
  statement_like: boolean;
  statement_period_start: string;
  statement_period_end: string;
  body?: string;
}): string {
  return [
    "---",
    `title: "${input.title}"`,
    `source_filename: "${input.source_filename}"`,
    'source_type: "application/pdf"',
    'imported_at: "2026-06-02T21:15:30.346Z"',
    `institution: "${input.institution}"`,
    `account_type: "${input.account_type}"`,
    'statement_month: "2026-04"',
    `statement_period_start: "${input.statement_period_start}"`,
    `statement_period_end: "${input.statement_period_end}"`,
    `statement_like: ${String(input.statement_like)}`,
    "---",
    "",
    `# ${input.title}`,
    "",
    input.body ?? "",
    "",
  ].join("\n");
}
