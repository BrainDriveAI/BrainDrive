import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { commitMemoryChange, ensureGitReady } from "../git.js";

const execFileAsync = promisify(execFileCallback);

describe("memory git checkpoints", () => {
  it("preserves operation-specific messages after the baseline commit", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-git-test-"));

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
