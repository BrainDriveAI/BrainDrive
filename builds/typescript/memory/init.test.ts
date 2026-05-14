import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { initializeMemoryLayout, scaffoldProjectFiles } from "./init.js";

describe("memory init project scaffolding", () => {
  it("scaffolds index.md for default projects without a starter pack", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-index-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await initializeMemoryLayout(rootDir, memoryRoot, {
        seedStarterSkills: false,
      });

      await expect(readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8"))
        .resolves.toContain("# Folder Index");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget.md"), "utf8"))
        .resolves.toContain("# Budget");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "rules.md"), "utf8"))
        .resolves.toContain("# Budget Rules");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "reports", "latest.md"), "utf8"))
        .resolves.toContain("# Latest Budget Report");
      const statements = await stat(path.join(memoryRoot, "documents", "finance", "statements"));
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
