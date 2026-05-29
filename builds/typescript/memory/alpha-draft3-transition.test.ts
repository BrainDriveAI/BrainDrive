import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyAlphaDraft3Transition, buildAlphaDraft3TransitionPlan } from "./alpha-draft3-transition.js";

describe("alpha Draft 3 memory transition", () => {
  it("plans deterministic Finance legacy path moves into Draft 3 paths", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "draft3-transition-plan-"));
    try {
      await mkdir(path.join(tempRoot, "documents", "finance", "budgeting"), { recursive: true });
      await writeFile(path.join(tempRoot, "documents", "finance", "budget.md"), "# Old Budget\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "rules.md"), "# Owner Rules\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "budgeting", "source-evidence.md"), "# Source Evidence\n", "utf8");

      const plan = await buildAlphaDraft3TransitionPlan(tempRoot);

      expect(plan.detected_layout).toBe("pre_draft3_finance");
      expect(plan.items).toContainEqual(expect.objectContaining({
        from_path: "documents/finance/budget.md",
        to_path: "documents/finance/budget/budget.md",
        action: "copy",
      }));
      expect(plan.items).toContainEqual(expect.objectContaining({
        from_path: "documents/finance/rules.md",
        to_path: "documents/finance/budget/budget-rules-user.md",
        action: "copy",
      }));
      expect(plan.review_paths).toContain("documents/finance/budgeting/source-evidence.md");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("applies transition, archives legacy files, and writes report artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "draft3-transition-apply-"));
    try {
      await mkdir(path.join(tempRoot, "documents", "finance", "budgeting"), { recursive: true });
      await mkdir(path.join(tempRoot, "documents", "finance", "reports"), { recursive: true });
      await writeFile(path.join(tempRoot, "documents", "finance", "budget.md"), "# Old Budget\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "rules.md"), "# Owner Rules\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "budgeting", "monthly-comparison.md"), "# Custom Compare\n", "utf8");
      await writeFile(path.join(tempRoot, "documents", "finance", "reports", "latest.md"), "# Old Report\n", "utf8");

      const result = await applyAlphaDraft3Transition(tempRoot);

      expect(result.applied_paths).toContain("documents/finance/budget/budget.md");
      expect(result.applied_paths).toContain("documents/finance/budget/budget-rules-user.md");
      await expect(readFile(path.join(tempRoot, "documents", "finance", "budget", "budget.md"), "utf8"))
        .resolves.toContain("# Old Budget");
      await expect(readFile(path.join(tempRoot, "documents", "finance", "budget", "budget-rules-user.md"), "utf8"))
        .resolves.toContain("# Owner Rules");
      await expect(readFile(path.join(tempRoot, "documents", "finance", "budget", "compare-user.md"), "utf8"))
        .resolves.toContain("# Custom Compare");
      await expect(readFile(path.join(tempRoot, "documents", "finance", "budget", "reports", "latest.md"), "utf8"))
        .resolves.toContain("# Old Report");
      await expect(readFile(path.join(tempRoot, "documents", "finance", "budget.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(tempRoot, "documents", "finance", "reports", "latest.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(tempRoot, result.report_path), "utf8"))
        .resolves.toContain("# Draft 3 Memory Transition");
      expect(result.backup_path).toBe("system/updates/backups/draft3-memory-alpha.tar.gz");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
