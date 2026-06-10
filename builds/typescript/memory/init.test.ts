import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { initializeMemoryLayout, scaffoldProjectFiles } from "./init.js";

describe("memory init project scaffolding", () => {
  it("scaffolds Draft 3 life-area layouts without legacy app or source folders", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-index-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await initializeMemoryLayout(rootDir, memoryRoot, {
        seedStarterSkills: false,
      });

      await expect(readFile(path.join(memoryRoot, "me", "profile.md"), "utf8"))
        .resolves.toContain("# Owner Profile");
      await expect(readFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "spec.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "plan.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "career", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "relationships", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "career", "run-interview.md"), "utf8"))
        .resolves.toContain("# Career Interview");
      await expect(readFile(path.join(memoryRoot, "documents", "career", "run-planning.md"), "utf8"))
        .resolves.toContain("# Career Planning");
      await expect(readFile(path.join(memoryRoot, "documents", "relationships", "run-interview.md"), "utf8"))
        .resolves.toContain("# Relationships Interview");
      await expect(readFile(path.join(memoryRoot, "documents", "relationships", "run-planning.md"), "utf8"))
        .resolves.toContain("# Relationships Planning");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "run-interview.md"), "utf8"))
        .resolves.toContain("# Fitness Interview");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "run-planning.md"), "utf8"))
        .resolves.toContain("# Fitness Planning");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "AGENT-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "run-interview-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "run-planning-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget-rules.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "create.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "compare.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "statements", "README.md"), "utf8"))
        .rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scaffolds architecture-aligned files for newly created custom projects", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-scaffold-project-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await scaffoldProjectFiles(rootDir, memoryRoot, "home-renovation", "Home Renovation");

      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "AGENT.md"), "utf8"))
        .resolves.toContain("# Home Renovation");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "spec.md"), "utf8"))
        .resolves.toContain("# Home Renovation Spec");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "run-interview.md"), "utf8"))
        .resolves.toContain("# Home Renovation Interview");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "plan.md"), "utf8"))
        .resolves.toContain("# Home Renovation Plan");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "run-planning.md"), "utf8"))
        .resolves.toContain("# Home Renovation Planning");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "AGENT-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "run-interview-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "run-planning-user.md"), "utf8"))
        .rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
