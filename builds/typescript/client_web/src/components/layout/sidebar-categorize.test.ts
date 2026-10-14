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
    expect(projectDisplayLabel("finance", "Finance")).toBe("Your Finances");
    expect(projectDisplayLabel("career", "Career")).toBe("Your Career");
    expect(projectDisplayLabel("custom-id", "Fitness")).toBe("Your Fitness");
    expect(projectDisplayLabel("new-project", "Your New Project")).toBe("Your New Project");
    expect(rootProjectDisplayLabel("career", "Career")).toBe("Career");
    expect(rootProjectDisplayLabel("relationships", "Relationships")).toBe("Relationships");
    expect(rootProjectDisplayLabel("fitness", "Fitness")).toBe("Fitness");
    expect(rootProjectDisplayLabel("finance", "Finance")).toBe("Finances");
    expect(rootProjectDisplayLabel("new-project", "Your New Project")).toBe("Your New Project");
    expect(sidebarFileLabel({ name: "spec.md", path: "documents/finance/spec.md" }, "finance")).toBe("Your Goals");
    expect(sidebarFileLabel({ name: "plan.md", path: "documents/finance/plan.md" }, "finance")).toBe("Your Plan");
    expect(sidebarFileLabel({ name: "journal.md", path: "documents/finance/journal.md" }, "finance")).toBe("Your Journal");
    expect(sidebarFileLabel({ name: "run-journal.md", path: "documents/finance/run-journal.md" }, "finance")).toBe("Journal");
    expect(sidebarFileLabel({ name: "2026-05-capital-one.md", path: "documents/finance/2026-05-capital-one.md" }, "finance")).toBe("2026 05 Capital One");
    expect(sidebarFileLabel({ name: "garden.md", path: "documents/home/garden/garden.md" }, "home")).toBe("Garden");
  });
});

describe("sidebar categorization", () => {
  it("builds a Finance project model with parent files and no active Budget app", () => {
    const model = buildProjectSidebarModel("finance", financeFiles);

    expect(model.goals?.label).toBe("Your Goals");
    expect(model.plan?.label).toBe("Your Plan");
    expect(model.journal).toBeNull();
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

  it("groups flat journal state with plan files and keeps journal procedures advanced", () => {
    const model = buildProjectSidebarModel("fitness", [
      { name: "spec.md", path: "documents/fitness/spec.md" },
      { name: "plan.md", path: "documents/fitness/plan.md" },
      { name: "journal.md", path: "documents/fitness/journal.md" },
      { name: "run-journal.md", path: "documents/fitness/run-journal.md" },
      { name: "journal/journal.md", path: "documents/fitness/journal/journal.md" },
      { name: "journal/AGENT.md", path: "documents/fitness/journal/AGENT.md" },
      { name: "2026-07-note.md", path: "documents/fitness/2026-07-note.md" },
    ]);

    expect(model.goals?.label).toBe("Your Goals");
    expect(model.plan?.label).toBe("Your Plan");
    expect(model.journal?.label).toBe("Your Journal");
    expect(model.files.map((item) => item.canonicalPath)).toEqual(["2026-07-note.md"]);
    expect(model.advanced.map((item) => [item.canonicalPath, item.label])).toEqual([
      ["journal/AGENT.md", "Agent Instructions"],
      ["journal/journal.md", "Journal"],
      ["run-journal.md", "Journal"],
    ]);
  });

  it("shows app-published documents as ordinary named files with a Published badge", () => {
    const model = buildProjectSidebarModel("career", [{
      name: "published/ai.braindrive.resume-builder/general-resume.md",
      path: "documents/career/published/ai.braindrive.resume-builder/general-resume.md",
      displayName: "General Resume",
      readOnly: true,
      sourceLabel: "Resume Builder",
      sourceType: "app_published",
    }]);

    expect(model.files).toEqual([
      expect.objectContaining({ label: "General Resume", badge: "Published" }),
    ]);
  });
});


describe("owner-centered setup groups", () => {
  it("separates reusable setup from produced work without changing paths or file metadata", () => {
    const names = ["spec.md", "plan.md", "journal.md", "business-idea-brief.md",
      "business-idea-brief-template.md", "business-idea-interview.md", "AGENT.md",
      "AGENT-user.md", "run-interview.md", "run-interview-user.md", "run-planning.md", "run-journal.md"];
    const files = names.map((name) => ({ name, path: `documents/start-a-business/${name}` }));
    const model = buildProjectSidebarModel("start-a-business", files);
    expect(model.files.map((item) => item.canonicalPath)).toEqual(["business-idea-brief.md"]);
    expect(model.expert.skills.map((item) => item.canonicalPath)).toEqual(["business-idea-interview.md"]);
    expect(model.expert.templates.map((item) => item.canonicalPath)).toEqual(["business-idea-brief-template.md"]);
    expect(model.expert.instructions).toHaveLength(6);
    const displayed = [model.goals!, model.plan!, model.journal!, ...model.files, ...model.advanced];
    expect(displayed).toHaveLength(files.length);
    expect(new Set(displayed.map((item) => item.file.path)).size).toBe(files.length);
    displayed.forEach((item) => expect(files).toContain(item.file));
    expect(model.expert.instructions.find((item) => item.canonicalPath === "run-interview.md")?.overlayPath)
      .toBe("documents/start-a-business/run-interview-user.md");
  });

  it("supports explicit skill/template directories and leaves published artifacts and unknown files visible", () => {
    const files: ProjectFile[] = [
      { name: "skills/repair.md", path: "documents/custom/skills/repair.md" },
      { name: "templates/checklist.md", path: "documents/custom/templates/checklist.md" },
      { name: "interview-notes.md", path: "documents/custom/interview-notes.md" },
      { name: "published/brief-template.md", path: "documents/custom/published/brief-template.md", sourceType: "app_published", readOnly: true, displayName: "Published Brief" },
    ];
    const model = buildProjectSidebarModel("custom", files);
    expect(model.expert.skills.map((item) => item.file)).toEqual([files[0]]);
    expect(model.expert.templates.map((item) => item.file)).toEqual([files[1]]);
    expect(model.files.map((item) => item.file)).toEqual([files[2], files[3]]);
    expect(model.files[1]).toMatchObject({ label: "Published Brief", badge: "Published" });
  });
});


it("routes an existing page todo file separately from Work without using the global list", () => {
  const model = buildProjectSidebarModel("custom", [
    { name: "todo.md", path: "documents/custom/todo.md" },
    { name: "brief.md", path: "documents/custom/brief.md" },
  ]);
  expect(model.todo?.file.path).toBe("documents/custom/todo.md");
  expect(model.files.map((item) => item.file.name)).toEqual(["brief.md"]);
});
