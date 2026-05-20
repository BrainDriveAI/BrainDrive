import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultFolderIndexContent,
  ensureProjectIndex,
  removeProjectIndexEntry,
  removeProjectIndexEntryContent,
  upsertProjectIndexEntry,
  upsertProjectIndexEntryContent,
} from "./folder-index.js";

describe("folder index", () => {
  it("renders the default folder index with an empty supporting documents table", () => {
    const content = defaultFolderIndexContent();

    expect(content).toContain("# Folder Index");
    expect(content).toContain("| `AGENT.md` | Project-specific agent instructions. |");
    expect(content).toContain("| File | Type | Summary | Read When | Imported |");
    expect(content).toContain("| _No supporting documents yet._ | | | | |");
  });

  it("creates index.md when missing", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "folder-index-test-"));

    try {
      await ensureProjectIndex(memoryRoot, "finance");

      await expect(readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8"))
        .resolves.toContain("# Folder Index");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("upserts supporting document rows idempotently", () => {
    const first = upsertProjectIndexEntryContent(defaultFolderIndexContent(), {
      fileName: "statement.md",
      type: "Bank statement",
      summary: "Checking account statement with balances and transaction rows.",
      readWhen: "User asks about balances or statement transactions.",
      importedAt: "2026-05-14T16:00:00.000Z",
    });
    const second = upsertProjectIndexEntryContent(first, {
      fileName: "statement.md",
      type: "Bank statement",
      summary: "Updated checking account statement summary.",
      readWhen: "User asks about this statement.",
      importedAt: "2026-05-14T16:00:00.000Z",
    });

    expect(second).not.toContain("_No supporting documents yet._");
    expect(second).toContain("| `statement.md` | Bank statement | Updated checking account statement summary. | User asks about this statement. | 2026-05-14T16:00:00.000Z |");
    expect(second.match(/`statement\.md`/g)).toHaveLength(1);
  });

  it("preserves notes outside the supporting documents section", () => {
    const content = `${defaultFolderIndexContent()}Manual note.\n`;
    const next = upsertProjectIndexEntryContent(content, {
      fileName: "tax-return.md",
      type: "Tax return",
      summary: "Tax document.",
      readWhen: "User asks about taxes.",
      importedAt: "2026-05-14T16:00:00.000Z",
    });

    expect(next).toContain("Manual note.");
    expect(next).toContain("`tax-return.md`");
  });

  it("removes rows and restores the empty row", () => {
    const withEntry = upsertProjectIndexEntryContent(defaultFolderIndexContent(), {
      fileName: "statement.md",
      type: "Bank statement",
      summary: "Checking account statement.",
      readWhen: "User asks about balances.",
      importedAt: "2026-05-14T16:00:00.000Z",
    });
    const next = removeProjectIndexEntryContent(withEntry, "statement.md");

    expect(next).not.toContain("`statement.md`");
    expect(next).toContain("| _No supporting documents yet._ | | | | |");
  });

  it("supports nested supporting document paths", () => {
    const withEntry = upsertProjectIndexEntryContent(defaultFolderIndexContent(), {
      fileName: "statements/2026-05-capital-one.md",
      type: "Credit card statement",
      summary: "Capital One credit card statement for May 2026.",
      readWhen: "User asks about May 2026 Capital One spending.",
      importedAt: "2026-05-14T16:00:00.000Z",
    });
    const next = removeProjectIndexEntryContent(withEntry, "statements/2026-05-capital-one.md");

    expect(withEntry).toContain("`statements/2026-05-capital-one.md`");
    expect(next).not.toContain("`statements/2026-05-capital-one.md`");
    expect(next).toContain("| _No supporting documents yet._ | | | | |");
  });

  it("rejects unsafe nested index paths", () => {
    expect(() =>
      upsertProjectIndexEntryContent(defaultFolderIndexContent(), {
        fileName: "../statement.md",
        type: "Bank statement",
        summary: "Unsafe path.",
        readWhen: "Never.",
        importedAt: "2026-05-14T16:00:00.000Z",
      })
    ).toThrow("Index entry file name is required");
  });

  it("updates index.md on disk", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "folder-index-disk-test-"));

    try {
      await upsertProjectIndexEntry(memoryRoot, "career", {
        fileName: "resume.md",
        type: "Uploaded document",
        summary: "Current resume.",
        readWhen: "User asks about resume details.",
        importedAt: "2026-05-14T16:00:00.000Z",
      });
      await removeProjectIndexEntry(memoryRoot, "career", "resume.md");

      const content = await readFile(path.join(memoryRoot, "documents", "career", "index.md"), "utf8");
      expect(content).not.toContain("`resume.md`");
      expect(content).toContain("_No supporting documents yet._");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("preserves an existing index when ensureProjectIndex is called", async () => {
    const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "folder-index-existing-test-"));
    const indexPath = path.join(memoryRoot, "documents", "fitness", "index.md");

    try {
      await writeFile(indexPath, "# Custom Index\n", "utf8").catch(async () => {
        await ensureProjectIndex(memoryRoot, "fitness");
        await writeFile(indexPath, "# Custom Index\n", "utf8");
      });

      const content = await ensureProjectIndex(memoryRoot, "fitness");
      expect(content).toBe("# Custom Index\n");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });
});
