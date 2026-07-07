import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listProjects } from "../../src/memory-core.js";

describe("memory-core project listing", () => {
  it("uses projects.json as the active project source of truth", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mcp-project-list-manifest-test-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "your-agent"), { recursive: true });
      await mkdir(path.join(memoryRoot, "documents", "braindrive-plus-one"), { recursive: true });
      await writeFile(path.join(memoryRoot, "documents", "your-agent", "AGENT.md"), "# Your Agent\n", "utf8");
      await writeFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "# Legacy\n", "utf8");
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        `${JSON.stringify([
          {
            id: "your-agent",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: null,
            default_skill_ids: [],
          },
        ], null, 2)}\n`,
        "utf8"
      );

      const result = await listProjects(memoryRoot);

      expect(result.projects.map((project) => project.name)).toEqual(["your-agent"]);
      expect(result.projects[0]?.path).toBe(path.join(memoryRoot, "documents", "your-agent"));
      expect(result.projects[0]?.files_present).toEqual(["AGENT.md"]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("canonicalizes legacy root agent manifest entries", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mcp-project-list-legacy-manifest-test-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "braindrive-plus-one"), { recursive: true });
      await writeFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "# Legacy\n", "utf8");
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        `${JSON.stringify([
          {
            id: "braindrive-plus-one",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: null,
            default_skill_ids: [],
          },
        ], null, 2)}\n`,
        "utf8"
      );

      const result = await listProjects(memoryRoot);

      expect(result.projects.map((project) => project.name)).toEqual(["your-agent"]);
      expect(result.projects[0]?.path).toBe(path.join(memoryRoot, "documents", "your-agent"));
      expect(result.projects[0]?.files_present).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("falls back to directory scanning when projects.json is missing", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mcp-project-list-fallback-test-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "finance"), { recursive: true });
      await writeFile(path.join(memoryRoot, "documents", "finance", "AGENT.md"), "# Finance\n", "utf8");

      const result = await listProjects(memoryRoot);

      expect(result.projects.map((project) => project.name)).toEqual(["finance"]);
      expect(result.projects[0]?.files_present).toEqual(["AGENT.md"]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
