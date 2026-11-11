import path from "node:path";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { lintDraft3MemoryStarterPack } from "../tools/architecture-lint/draft3-memory-lint.js";

describe("Draft 3 starter-pack layout", () => {
  it("passes Draft 3 architecture lint", async () => {
    const starterPackRoot = path.resolve("memory", "starter-pack");
    const result = await lintDraft3MemoryStarterPack(starterPackRoot);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("keeps Finance Journal separate from Budgeting execution", async () => {
    const financeJournal = await readFile(path.resolve(
      "memory", "starter-pack", "projects", "templates", "finance", "run-journal.md",
    ), "utf8");

    expect(financeJournal).toContain("Finance Journal is not a budgeting app");
    expect(financeJournal).toContain("Phase 3 app/tool handoff");
    expect(financeJournal).toContain("If no such tool is available, preserve a useful manual next step");
    expect(financeJournal).toContain("Leave only reflection or a concise summary the owner approves in Your Journal");
    expect(financeJournal).toContain("does not connect to banks");
  });
});
