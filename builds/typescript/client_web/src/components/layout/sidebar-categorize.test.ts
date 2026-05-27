import { describe, expect, it } from "vitest";

import type { ProjectFile } from "@/types/ui";

import { categorizeAppFiles, categorizeProjectFiles } from "./sidebar-categorize";

function file(relativePath: string): ProjectFile {
  return { name: relativePath, path: `documents/finance/${relativePath}` };
}

describe("categorizeProjectFiles", () => {
  it("returns empty groups when given no files", () => {
    const result = categorizeProjectFiles([]);
    expect(result.triad).toEqual({});
    expect(result.apps).toEqual([]);
    expect(result.workFolders).toEqual([]);
    expect(result.advanced).toEqual([]);
  });

  it("places AGENT.md / spec.md / plan.md into the triad", () => {
    const files = [file("AGENT.md"), file("spec.md"), file("plan.md")];
    const result = categorizeProjectFiles(files);
    expect(result.triad.agent?.name).toBe("AGENT.md");
    expect(result.triad.goals?.name).toBe("spec.md");
    expect(result.triad.plan?.name).toBe("plan.md");
    expect(result.advanced).toEqual([]);
  });

  it("treats run-*.md and *-user.md root files as Advanced", () => {
    const files = [
      file("AGENT.md"),
      file("run-interview.md"),
      file("run-planning.md"),
      file("AGENT-user.md")
    ];
    const result = categorizeProjectFiles(files);
    expect(result.advanced.map((f) => f.name)).toEqual([
      "AGENT-user.md",
      "run-interview.md",
      "run-planning.md"
    ]);
  });

  it("treats a folder containing AGENT.md as an app", () => {
    const files = [
      file("AGENT.md"),
      file("budget/AGENT.md"),
      file("budget/budget.md"),
      file("budget/budget-rules.md"),
      file("budget/create.md")
    ];
    const result = categorizeProjectFiles(files);
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0].name).toBe("budget");
    expect(result.apps[0].files).toHaveLength(4);
    expect(result.workFolders).toEqual([]);
  });

  it("treats a folder without AGENT.md as a work folder", () => {
    const files = [
      file("AGENT.md"),
      file("reports/latest.md"),
      file("statements/README.md")
    ];
    const result = categorizeProjectFiles(files);
    expect(result.workFolders.map((f) => f.name).sort()).toEqual([
      "reports",
      "statements"
    ]);
    expect(result.apps).toEqual([]);
  });

  it("groups a realistic Finance project correctly", () => {
    const files = [
      file("AGENT.md"),
      file("spec.md"),
      file("plan.md"),
      file("run-interview.md"),
      file("run-planning.md"),
      file("budget/AGENT.md"),
      file("budget/budget.md"),
      file("budget/budget-rules.md"),
      file("budget/budget-rules-user.md"),
      file("budget/create.md"),
      file("budget/compare.md"),
      file("statements/README.md"),
      file("reports/README.md")
    ];
    const result = categorizeProjectFiles(files);

    expect(result.triad.agent?.name).toBe("AGENT.md");
    expect(result.triad.goals?.name).toBe("spec.md");
    expect(result.triad.plan?.name).toBe("plan.md");

    expect(result.apps).toHaveLength(1);
    expect(result.apps[0].name).toBe("budget");

    expect(result.workFolders.map((w) => w.name)).toEqual([
      "reports",
      "statements"
    ]);

    expect(result.advanced.map((f) => f.name)).toEqual([
      "run-interview.md",
      "run-planning.md"
    ]);
  });

  it("sorts apps and work folders alphabetically", () => {
    const files = [
      file("AGENT.md"),
      file("z-app/AGENT.md"),
      file("a-app/AGENT.md"),
      file("z-folder/notes.md"),
      file("a-folder/notes.md")
    ];
    const result = categorizeProjectFiles(files);
    expect(result.apps.map((a) => a.name)).toEqual(["a-app", "z-app"]);
    expect(result.workFolders.map((w) => w.name)).toEqual(["a-folder", "z-folder"]);
  });
});

describe("categorizeAppFiles", () => {
  it("groups a realistic Budget app correctly", () => {
    const files = [
      file("AGENT.md"),
      file("spec.md"),
      file("plan.md"),
      file("budget/AGENT.md"),
      file("budget/budget.md"),
      file("budget/budget-rules.md"),
      file("budget/budget-rules-user.md"),
      file("budget/create.md"),
      file("budget/compare.md"),
      file("budget/AGENT-user.md")
    ];
    const result = categorizeAppFiles(files, "budget");

    expect(result.triad.agent?.name).toBe("budget/AGENT.md");
    expect(result.triad.goals).toBeUndefined();
    expect(result.triad.plan).toBeUndefined();
    expect(result.state?.name).toBe("budget/budget.md");
    expect(result.rules?.base.name).toBe("budget/budget-rules.md");
    expect(result.rules?.overlay?.name).toBe("budget/budget-rules-user.md");

    expect(result.advanced.map((f) => f.name)).toEqual([
      "budget/AGENT-user.md",
      "budget/budget-rules-user.md",
      "budget/compare.md",
      "budget/create.md"
    ]);
  });

  it("ignores files outside the app folder", () => {
    const files = [
      file("AGENT.md"),
      file("budget/AGENT.md"),
      file("other-app/AGENT.md")
    ];
    const result = categorizeAppFiles(files, "budget");
    expect(result.triad.agent?.name).toBe("budget/AGENT.md");
    expect(result.advanced).toEqual([]);
  });

  it("surfaces spec.md / plan.md when defined at app scope", () => {
    const files = [
      file("budget/AGENT.md"),
      file("budget/spec.md"),
      file("budget/plan.md")
    ];
    const result = categorizeAppFiles(files, "budget");
    expect(result.triad.goals?.name).toBe("budget/spec.md");
    expect(result.triad.plan?.name).toBe("budget/plan.md");
  });

  it("returns no rules when the rules base file is absent", () => {
    const files = [
      file("budget/AGENT.md"),
      file("budget/budget-rules-user.md")
    ];
    const result = categorizeAppFiles(files, "budget");
    expect(result.rules).toBeUndefined();
    expect(result.advanced.map((f) => f.name)).toEqual([
      "budget/budget-rules-user.md"
    ]);
  });

  it("treats nested sub-folders inside the app as Advanced", () => {
    const files = [
      file("budget/AGENT.md"),
      file("budget/notes/scratch.md")
    ];
    const result = categorizeAppFiles(files, "budget");
    expect(result.advanced.map((f) => f.name)).toEqual([
      "budget/notes/scratch.md"
    ]);
  });
});
