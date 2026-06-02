import { describe, expect, it } from "vitest";

import type { ProjectFile } from "@/types/ui";

import { buildAppSidebarModel, buildProjectSidebarModel } from "./sidebar-categorize";
import { appDisplayLabel, projectDisplayLabel, rootProjectDisplayLabel, sidebarFileLabel } from "./sidebar-labels";

const financeFiles: ProjectFile[] = [
  { name: "AGENT.md", path: "documents/finance/AGENT.md" },
  { name: "AGENT-user.md", path: "documents/finance/AGENT-user.md" },
  { name: "spec.md", path: "documents/finance/spec.md" },
  { name: "plan.md", path: "documents/finance/plan.md" },
  { name: "budget/AGENT.md", path: "documents/finance/budget/AGENT.md" },
  { name: "budget/budget.md", path: "documents/finance/budget/budget.md" },
  { name: "budget/budget-rules.md", path: "documents/finance/budget/budget-rules.md" },
  { name: "budget/budget-rules-user.md", path: "documents/finance/budget/budget-rules-user.md" },
  { name: "budget/compare.md", path: "documents/finance/budget/compare.md" },
  { name: "budget/compare-user.md", path: "documents/finance/budget/compare-user.md" },
  { name: "budget/create.md", path: "documents/finance/budget/create.md" },
  { name: "budget/create-user.md", path: "documents/finance/budget/create-user.md" },
  { name: "budget/reports/latest.md", path: "documents/finance/budget/reports/latest.md" },
  { name: "budget/statements/2026-05-card.md", path: "documents/finance/budget/statements/2026-05-card.md" },
];

describe("sidebar labels", () => {
  it("translates canonical files into owner-facing labels", () => {
    expect(projectDisplayLabel("finance", "Finance")).toBe("Your Finances");
    expect(projectDisplayLabel("career", "Career")).toBe("Your Career");
    expect(projectDisplayLabel("custom-id", "Fitness")).toBe("Your Fitness");
    expect(projectDisplayLabel("new-project", "Your New Project")).toBe("Your New Project");
    expect(rootProjectDisplayLabel("career", "Career")).toBe("Career");
    expect(rootProjectDisplayLabel("relationships", "Relationships")).toBe("Relationships");
    expect(rootProjectDisplayLabel("fitness", "Fitness")).toBe("Fitness");
    expect(rootProjectDisplayLabel("finance", "Finance")).toBe("Finances");
    expect(rootProjectDisplayLabel("new-project", "Your New Project")).toBe("Your New Project");
    expect(appDisplayLabel("budget")).toBe("Your Budget");
    expect(sidebarFileLabel({ name: "spec.md", path: "documents/finance/spec.md" }, "finance")).toBe("Your Goals");
    expect(sidebarFileLabel({ name: "plan.md", path: "documents/finance/plan.md" }, "finance")).toBe("Your Plan");
    expect(sidebarFileLabel({ name: "budget.md", path: "documents/finance/budget/budget.md" }, "finance", "budget")).toBe("Your Budget");
  });
});

describe("sidebar categorization", () => {
  it("builds a project model with goals, plan, apps, files, and advanced items", () => {
    const model = buildProjectSidebarModel("finance", financeFiles);

    expect(model.goals?.label).toBe("Your Goals");
    expect(model.plan?.label).toBe("Your Plan");
    expect(model.apps).toEqual([
      expect.objectContaining({
        path: "budget",
        label: "Your Budget",
      }),
    ]);
    expect(model.files.map((item) => item.canonicalPath)).toEqual([]);
    expect(model.advanced.map((item) => item.canonicalPath)).toEqual([
      "AGENT-user.md",
      "AGENT.md",
    ]);
  });

  it("builds an app model without losing managed files or overlays", () => {
    const model = buildAppSidebarModel("finance", "budget", financeFiles);

    expect(model.primary.map((item) => item.label)).toEqual(["Your Budget"]);
    expect(model.files).toEqual([]);
    expect(model.folders.map((folder) => folder.label)).toEqual(["Budget reports (1)", "Budget statements (1)"]);
    expect(model.folders.find((folder) => folder.label === "Budget reports (1)")?.files.map((item) => item.canonicalPath)).toEqual([
      "budget/reports/latest.md",
    ]);
    expect(model.folders.find((folder) => folder.label === "Budget statements (1)")?.files.map((item) => item.canonicalPath)).toEqual([
      "budget/statements/2026-05-card.md",
    ]);
    expect(model.advanced.map((item) => item.canonicalPath)).toEqual([
      "budget/AGENT.md",
      "budget/budget-rules.md",
      "budget/compare.md",
      "budget/create.md",
    ]);
    expect(model.advanced.find((item) => item.canonicalPath === "budget/compare.md")?.overlayPath).toBe(
      "documents/finance/budget/compare-user.md"
    );
  });
});
