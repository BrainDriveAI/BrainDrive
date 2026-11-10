import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { commitMemoryChange, ensureGitReady } from "../../src/git.js";
import { listProjects, readMemoryFile } from "../../src/memory-core.js";

const execFileAsync = promisify(execFileCallback);

describe("memory git checkpoints", () => {
  it("preserves operation-specific messages after the baseline commit", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mcp-memory-git-test-"));

    try {
      await mkdir(path.join(tempRoot, "documents"), { recursive: true });
      await ensureGitReady(tempRoot);
      await writeFile(path.join(tempRoot, "documents", "note.md"), "one\n", "utf8");
      await ensureGitReady(tempRoot);
      await commitMemoryChange(tempRoot, "Write documents/note.md");

      const result = await execFileAsync("git", ["-C", tempRoot, "log", "--format=%s", "-2"]);
      expect(result.stdout.split(/\r?\n/).filter(Boolean)).toEqual([
        "Write documents/note.md",
        "Initialize memory root",
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("memory-core file reads", () => {
  it("returns a recoverable validation error when a directory is requested as a file", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mcp-memory-read-directory-test-"));

    try {
      await mkdir(path.join(tempRoot, "current-conversation"), { recursive: true });

      await expect(readMemoryFile(tempRoot, "current-conversation")).rejects.toMatchObject({
        code: "invalid_input",
        message: "Requested path is a directory; use memory_list to inspect it",
        recoverable: true,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

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
