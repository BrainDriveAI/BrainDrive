import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyAlphaDraft3Transition, buildAlphaDraft3TransitionPlan } from "./alpha-draft3-transition.js";

describe("alpha Draft 3 memory transition", () => {
  it("does not plan Budget files for fresh users", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "draft3-transition-fresh-"));
    try {
      await mkdir(path.join(tempRoot, "documents", "finance"), { recursive: true });
      await writeFile(path.join(tempRoot, "documents", "finance", "AGENT.md"), "# Finance\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "plan.md"), "# Plan\n", "utf8");

      const plan = await buildAlphaDraft3TransitionPlan(tempRoot);
      const result = await applyAlphaDraft3Transition(tempRoot);

      expect(plan.items).toEqual([]);
      expect(result.applied_paths).toEqual([]);
      expect(result.archived_paths).toEqual([]);
      await expect(readFile(path.join(tempRoot, "documents", "finance", "archive", "retired-budget", "README.md"), "utf8"))
        .rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("plans Finance Budget data moves into the retired archive, not active app paths", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "draft3-transition-plan-"));
    try {
      await mkdir(path.join(tempRoot, "documents", "finance", "budget", "statements"), { recursive: true });
      await mkdir(path.join(tempRoot, "documents", "finance", "budgeting"), { recursive: true });
      await writeFile(path.join(tempRoot, "documents", "finance", "budget", "budget.md"), "# Active Budget\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "budget", "statements", "may.md"), "# May Statement\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "budget.md"), "# Old Budget\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "rules.md"), "# Owner Rules\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "budgeting", "source-evidence.md"), "# Source Evidence\n", "utf8");

      const plan = await buildAlphaDraft3TransitionPlan(tempRoot);

      expect(plan.detected_layout).toBe("draft3_or_later");
      expect(plan.items).toContainEqual(expect.objectContaining({
        from_path: "documents/finance/budget/budget.md",
        to_path: "documents/finance/archive/retired-budget/budget.md",
        action: "archive",
      }));
      expect(plan.items).toContainEqual(expect.objectContaining({
        from_path: "documents/finance/budget/statements/may.md",
        to_path: "documents/finance/archive/retired-budget/statements/may.md",
        action: "archive",
      }));
      expect(plan.items).toContainEqual(expect.objectContaining({
        from_path: "documents/finance/budget.md",
        to_path: "documents/finance/archive/retired-budget/pre-draft/budget.md",
        action: "archive",
      }));
      expect(plan.items).toContainEqual(expect.objectContaining({
        from_path: "documents/finance/rules.md",
        to_path: "documents/finance/archive/retired-budget/pre-draft/rules.md",
        action: "archive",
      }));
      expect(plan.review_paths).toContain("documents/finance/archive/retired-budget/pre-draft/budgeting/source-evidence.md");
      expect(plan.items.map((item) => item.to_path)).not.toContain("documents/finance/budget/budget.md");
      expect(plan.items.map((item) => item.to_path)).not.toContain("documents/finance/budget/budget-rules-user.md");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("applies transition, preserves Budget bytes in the retired archive, and writes report artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "draft3-transition-apply-"));
    try {
      const savedBudget = Buffer.from("# Active Budget\r\nNo trailing newline");
      const ownerRules = Buffer.from("# Owner Rules\nCustom owner rule");
      const statement = Buffer.from("date,amount\r\n2026-05-01,12.34");
      const oldReport = Buffer.from("# Old Report\n");

      await mkdir(path.join(tempRoot, "documents", "finance", "budget", "statements"), { recursive: true });
      await mkdir(path.join(tempRoot, "documents", "finance", "budgeting"), { recursive: true });
      await mkdir(path.join(tempRoot, "documents", "finance", "reports"), { recursive: true });
      await writeFile(path.join(tempRoot, "documents", "finance", "budget", "budget.md"), savedBudget);
      await writeFile(path.join(tempRoot, "documents", "finance", "budget", "budget-rules-user.md"), ownerRules);
      await writeFile(path.join(tempRoot, "documents", "finance", "budget", "statements", "may.csv.md"), statement);
      await writeFile(path.join(tempRoot, "documents", "finance", "budget.md"), "# Old Budget\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "budgeting", "monthly-comparison.md"), "# Custom Compare\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "reports", "latest.md"), oldReport);

      const result = await applyAlphaDraft3Transition(tempRoot);

      expect(result.applied_paths).toEqual([]);
      expect(result.archived_paths).toContain("documents/finance/archive/retired-budget/budget.md");
      expect(result.archived_paths).toContain("documents/finance/archive/retired-budget/budget-rules-user.md");
      expect(result.archived_paths).toContain("documents/finance/archive/retired-budget/statements/may.csv.md");
      expect(result.archived_paths).toContain("documents/finance/archive/retired-budget/pre-draft/budget.md");
      expect(result.archived_paths).toContain("documents/finance/archive/retired-budget/pre-draft/budgeting/monthly-comparison.md");
      expect(result.archived_paths).toContain("documents/finance/archive/retired-budget/pre-draft/reports/latest.md");
      expect(result.archived_paths).toContain("documents/finance/archive/retired-budget/README.md");
      await expect(readFile(path.join(tempRoot, "documents", "finance", "archive", "retired-budget", "budget.md")))
        .resolves.toEqual(savedBudget);
      await expect(readFile(path.join(tempRoot, "documents", "finance", "archive", "retired-budget", "budget-rules-user.md")))
        .resolves.toEqual(ownerRules);
      await expect(readFile(path.join(tempRoot, "documents", "finance", "archive", "retired-budget", "statements", "may.csv.md")))
        .resolves.toEqual(statement);
      await expect(readFile(path.join(tempRoot, "documents", "finance", "archive", "retired-budget", "pre-draft", "reports", "latest.md")))
        .resolves.toEqual(oldReport);
      await expect(readFile(path.join(tempRoot, "documents", "finance", "budget", "budget.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(tempRoot, "documents", "finance", "budget", "budget-rules-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(tempRoot, "documents", "finance", "budget.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(tempRoot, "documents", "finance", "reports", "latest.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(tempRoot, "documents", "finance", "archive", "retired-budget", "README.md"), "utf8"))
        .resolves.toContain("Budgetting was retired");
      await expect(readFile(path.join(tempRoot, result.report_path), "utf8"))
        .resolves.toContain("No active Budget app paths were created.");
      expect(result.backup_path).toBe("system/updates/backups/draft3-memory-alpha.tar.gz");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
