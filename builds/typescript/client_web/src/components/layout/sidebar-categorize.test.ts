import { describe, expect, it } from "vitest";

import type { ProjectFile } from "@/types/ui";

import { buildProjectSidebarModel } from "./sidebar-categorize";
import { projectDisplayLabel, rootProjectDisplayLabel, sidebarFileLabel } from "./sidebar-labels";

const financeFiles: ProjectFile[] = [
  { name: "AGENT.md", path: "documents/finance/AGENT.md" },
  { name: "AGENT-user.md", path: "documents/finance/AGENT-user.md" },
  { name: "spec.md", path: "documents/finance/spec.md" },
  { name: "plan.md", path: "documents/finance/plan.md" },
  { name: "2026-05-capital-one.md", path: "documents/finance/2026-05-capital-one.md" },
  { name: "archive/retired-budget/budget.md", path: "documents/finance/archive/retired-budget/budget.md" },
];

const gardenFiles: ProjectFile[] = [
  { name: "garden/AGENT.md", path: "documents/home/garden/AGENT.md" },
  { name: "garden/garden.md", path: "documents/home/garden/garden.md" },
  { name: "garden/garden-rules.md", path: "documents/home/garden/garden-rules.md" },
  { name: "garden/garden-rules-user.md", path: "documents/home/garden/garden-rules-user.md" },
  { name: "garden/compare.md", path: "documents/home/garden/compare.md" },
  { name: "garden/compare-user.md", path: "documents/home/garden/compare-user.md" },
  { name: "garden/reports/latest.md", path: "documents/home/garden/reports/latest.md" },
  { name: "garden/sources/seed-list.md", path: "documents/home/garden/sources/seed-list.md" },
];

describe("sidebar labels", () => {
  it("translates canonical files into owner-facing labels", () => {
    expect(projectDisplayLabel("finance", "Finance")).toBe("Your Finance");
    expect(projectDisplayLabel("career", "Career")).toBe("Your Career");
    expect(projectDisplayLabel("custom-id", "Fitness")).toBe("Your Fitness");
    expect(projectDisplayLabel("new-project", "Your New Project")).toBe("Your New Project");
    expect(rootProjectDisplayLabel("career", "Career")).toBe("Career");
    expect(rootProjectDisplayLabel("relationships", "Relationships")).toBe("Relationships");
    expect(rootProjectDisplayLabel("fitness", "Fitness")).toBe("Fitness");
    expect(rootProjectDisplayLabel("finance", "Finance")).toBe("Finance");
    expect(rootProjectDisplayLabel("new-project", "Your New Project")).toBe("Your New Project");
    expect(sidebarFileLabel({ name: "spec.md", path: "documents/finance/spec.md" }, "finance")).toBe("Your Goals");
    expect(sidebarFileLabel({ name: "plan.md", path: "documents/finance/plan.md" }, "finance")).toBe("Your Plan");
    expect(sidebarFileLabel({ name: "2026-05-capital-one.md", path: "documents/finance/2026-05-capital-one.md" }, "finance")).toBe("2026 05 Capital One");
    expect(sidebarFileLabel({ name: "garden.md", path: "documents/home/garden/garden.md" }, "home")).toBe("Garden");
  });
});

describe("sidebar categorization", () => {
  it("builds a Finance project model with parent files and no active Budget app", () => {
    const model = buildProjectSidebarModel("finance", financeFiles);

    expect(model.goals?.label).toBe("Your Goals");
    expect(model.plan?.label).toBe("Your Plan");
    expect(model.files.map((item) => item.canonicalPath)).toEqual([
      "2026-05-capital-one.md",
      "archive/retired-budget/budget.md",
    ]);
    expect(model.files.find((item) => item.canonicalPath === "2026-05-capital-one.md")?.label).toBe("2026 05 Capital One");
    expect(model.advanced.map((item) => item.canonicalPath)).toEqual([
      "AGENT-user.md",
      "AGENT.md",
    ]);
  });

  it("keeps nested folder files in the project model without creating child apps", () => {
    const model = buildProjectSidebarModel("home", gardenFiles);

    expect(model.files.map((item) => item.canonicalPath)).toEqual([
      "garden/garden.md",
      "garden/reports/latest.md",
      "garden/sources/seed-list.md",
    ]);
    expect(model.advanced.map((item) => item.canonicalPath)).toEqual([
      "garden/AGENT.md",
      "garden/compare-user.md",
      "garden/compare.md",
      "garden/garden-rules-user.md",
      "garden/garden-rules.md",
    ]);
    expect(model.advanced.find((item) => item.canonicalPath === "garden/compare.md")?.overlayPath).toBe(
      "documents/home/garden/compare-user.md"
    );
  });
});
