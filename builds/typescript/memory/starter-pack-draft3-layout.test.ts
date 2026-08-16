import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { lintDraft3MemoryStarterPack } from "../tools/architecture-lint/draft3-memory-lint.js";

describe("Draft 3 starter-pack layout", () => {
  it("passes Draft 3 architecture lint", async () => {
    const starterPackRoot = path.resolve("memory", "starter-pack");
    const result = await lintDraft3MemoryStarterPack(starterPackRoot);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("makes profile approval independent from the required goals-and-plan write", async () => {
    const starterPackRoot = path.resolve("memory", "starter-pack", "projects", "templates");
    for (const project of ["career", "finance", "fitness", "new-project", "relationships"]) {
      const instructions = await readFile(path.join(starterPackRoot, project, "run-interview.md"), "utf8");
      expect(instructions).toContain("Profile approval is a separate, explicit yes/no decision.");
      expect(instructions).toContain("Write **Your Goals** and **Your Plan** in that same turn regardless of the profile decision.");
      expect(instructions).toContain("say it was not saved");
    }
  });
});
