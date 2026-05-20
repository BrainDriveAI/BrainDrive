import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ToolContext } from "../../contracts.js";
import { ensureGitReady } from "../../git.js";
import { defaultFolderIndexContent, upsertProjectIndexEntryContent } from "../../memory/folder-index.js";
import { ToolExecutionFailure } from "../../tool-error.js";
import { fileOpsTools } from "./server.js";

function toolContext(memoryRoot: string): ToolContext {
  return {
    memoryRoot,
    correlationId: "test-correlation",
    auth: {
      actorId: "owner",
      actorType: "owner",
      mode: "local-owner",
      permissions: {
        memory_access: true,
        tool_access: true,
        system_actions: true,
        delegation: true,
        approval_authority: true,
        administration: true,
      },
    },
  };
}

describe("file ops memory_delete", () => {
  it("does not report success for a missing path", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-file-ops-"));
    const deleteTool = fileOpsTools().find((tool) => tool.name === "memory_delete");

    await expect(
      deleteTool?.execute(toolContext(memoryRoot), { path: "documents/missing.md" })
    ).rejects.toBeInstanceOf(ToolExecutionFailure);
  });

  it("removes a deleted project document from index.md", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-file-ops-index-"));
    const deleteTool = fileOpsTools().find((tool) => tool.name === "memory_delete");

    try {
      await mkdir(path.join(memoryRoot, "documents", "finance"), { recursive: true });
      await writeFile(path.join(memoryRoot, "documents", "finance", "statement.md"), "# Statement\n", "utf8");
      await writeFile(
        path.join(memoryRoot, "documents", "finance", "index.md"),
        upsertProjectIndexEntryContent(defaultFolderIndexContent(), {
          fileName: "statement.md",
          type: "Bank statement",
          summary: "Checking account statement.",
          readWhen: "User asks about balances.",
          importedAt: "2026-05-14T16:00:00.000Z",
        }),
        "utf8"
      );
      await ensureGitReady(memoryRoot);

      await deleteTool?.execute(toolContext(memoryRoot), { path: "documents/finance/statement.md" });

      const index = await readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8");
      expect(index).not.toContain("`statement.md`");
      expect(index).toContain("_No supporting documents yet._");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("removes a deleted nested project document from index.md", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-file-ops-nested-index-"));
    const deleteTool = fileOpsTools().find((tool) => tool.name === "memory_delete");

    try {
      await mkdir(path.join(memoryRoot, "documents", "finance", "statements"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "finance", "statements", "2026-05-capital-one.md"),
        "# Statement\n",
        "utf8"
      );
      await writeFile(
        path.join(memoryRoot, "documents", "finance", "index.md"),
        upsertProjectIndexEntryContent(defaultFolderIndexContent(), {
          fileName: "statements/2026-05-capital-one.md",
          type: "Credit card statement",
          summary: "Capital One credit card statement for May 2026.",
          readWhen: "User asks about May 2026 Capital One spending.",
          importedAt: "2026-05-14T16:00:00.000Z",
        }),
        "utf8"
      );
      await ensureGitReady(memoryRoot);

      await deleteTool?.execute(toolContext(memoryRoot), {
        path: "documents/finance/statements/2026-05-capital-one.md",
      });

      const index = await readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8");
      expect(index).not.toContain("`statements/2026-05-capital-one.md`");
      expect(index).toContain("_No supporting documents yet._");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("does not rewrite index.md when deleting a core project file", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-file-ops-core-"));
    const deleteTool = fileOpsTools().find((tool) => tool.name === "memory_delete");

    try {
      await mkdir(path.join(memoryRoot, "documents", "finance"), { recursive: true });
      await writeFile(path.join(memoryRoot, "documents", "finance", "spec.md"), "# Spec\n", "utf8");
      await writeFile(path.join(memoryRoot, "documents", "finance", "index.md"), defaultFolderIndexContent(), "utf8");
      await ensureGitReady(memoryRoot);

      await deleteTool?.execute(toolContext(memoryRoot), { path: "documents/finance/spec.md" });

      const index = await readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8");
      expect(index).toBe(defaultFolderIndexContent());
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });
});
