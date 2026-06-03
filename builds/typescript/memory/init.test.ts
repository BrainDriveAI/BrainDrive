import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { initializeMemoryLayout, scaffoldProjectFiles } from "./init.js";

describe("memory init project scaffolding", () => {
  it("scaffolds Draft 3 Finance layout and indexes for other default projects without a starter pack", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-index-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await initializeMemoryLayout(rootDir, memoryRoot, {
        seedStarterSkills: false,
      });

      await expect(readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("# Budget - Agent Context");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("Debt Payoff Priority");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("project_budget_validate_payoff_plan");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("project_budget_reconcile_review_state");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("concrete monthly extra-payment target");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("Post-upload receipt contract");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("include at most 3 visible dollar amounts or percentages");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("mystery transactions");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("Owner review pending");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("Partial Classification Rule");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "AGENT.md"), "utf8"))
        .resolves.toContain("do not complete the number for them");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("do not infer or normalize the missing number");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("Every uploaded file should be traceable to exactly one Source Coverage group.");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .resolves.toContain("project_budget_validate_source_coverage");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8"))
        .resolves.toContain("## Assumptions And Confidence");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8"))
        .resolves.toContain("## Reconciliation Check");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8"))
        .resolves.toContain("## Debt Payoff Priority");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget-rules.md"), "utf8"))
        .resolves.toContain("# Budget Rules");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "reports", "latest.md"), "utf8"))
        .resolves.toContain("# Latest Budget Report");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "create.md"), "utf8"))
        .resolves.toContain("draft actuals baseline");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "create.md"), "utf8"))
        .resolves.toContain("Northbridge Rewards Visa is the higher-APR card at 22.49%");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "create.md"), "utf8"))
        .resolves.toContain("project_budget_validate_payoff_plan");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "create.md"), "utf8"))
        .resolves.toContain("project_budget_reconcile_review_state");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "create.md"), "utf8"))
        .resolves.toContain("project_budget_validate_source_coverage");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "compare.md"), "utf8"))
        .resolves.toContain("project_budget_reconcile_review_state");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "compare.md"), "utf8"))
        .resolves.toContain("project_budget_validate_source_coverage");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "create.md"), "utf8"))
        .resolves.toContain("MJP Services is my therapist");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "compare.md"), "utf8"))
        .resolves.toContain("Reconciliation Check");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "compare.md"), "utf8"))
        .resolves.toContain("The latest Budget report is ready to review, and the review list is clear.");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "compare.md"), "utf8"))
        .resolves.toContain("no more than 3 visible dollar amounts");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "statements", "README.md"), "utf8"))
        .resolves.toContain("# Budget Statements");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "statements", "README.md"), "utf8"))
        .resolves.toContain("Post-upload chat must stay in receipt phase");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "reports", "README.md"), "utf8"))
        .resolves.toContain("# Budget Reports");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "index.md"), "utf8"))
        .resolves.toContain("# Health Docs Instruction Index");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "intake-and-disclaimer.md"), "utf8"))
        .resolves.toContain("# Health Document Intake And Disclaimer");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "relevance-and-routing.md"), "utf8"))
        .resolves.toContain("# Health Document Relevance And Routing");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "interpretation-voice.md"), "utf8"))
        .resolves.toContain("# Health Interpretation Voice");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "conflict-and-staleness.md"), "utf8"))
        .resolves.toContain("# Health Conflict And Staleness Rules");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "update-existing-plan.md"), "utf8"))
        .resolves.toContain("# Updating An Existing Fitness Plan With New Health Docs");
      const statements = await stat(path.join(memoryRoot, "documents", "finance", "budget", "statements"));
      expect(statements.isDirectory()).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scaffolds index.md for newly created custom projects", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-scaffold-index-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await scaffoldProjectFiles(rootDir, memoryRoot, "home-renovation", "Home Renovation");

      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "index.md"), "utf8"))
        .resolves.toContain("# Folder Index");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
