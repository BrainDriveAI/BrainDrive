import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GatewayProjectService } from "./projects.js";

describe("GatewayProjectService uploads", () => {
  it("detaches a project from its stored conversation", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gateway-project-detach-conversation-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        JSON.stringify([{ id: "fitness", name: "Fitness", icon: "activity", conversation_id: "conv-fitness" }]),
        "utf8"
      );
      const projects = new GatewayProjectService(memoryRoot, { rootDir: tempRoot });

      await expect(projects.detachConversation("missing")).resolves.toBe(false);
      await expect(projects.detachConversation("fitness")).resolves.toBe(true);

      const manifest = JSON.parse(await readFile(path.join(memoryRoot, "documents", "projects.json"), "utf8")) as Array<{ id: string; conversation_id: string | null }>;
      expect(manifest.find((project) => project.id === "fitness")?.conversation_id).toBeNull();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("repairs manifests missing the protected Your Agent landing project", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gateway-project-root-agent-repair-"));
    const memoryRoot = path.join(tempRoot, "memory");
    const rootDir = path.resolve(".");

    try {
      await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        JSON.stringify([{ id: "finance", name: "Finance", icon: "dollar-sign" }]),
        "utf8"
      );
      const projects = new GatewayProjectService(memoryRoot, { rootDir });

      const listed = await projects.listProjects();

      expect(listed.projects[0]).toMatchObject({
        id: "braindrive-plus-one",
        name: "BrainDrive+1",
        icon: "sparkles",
      });
      expect(listed.projects.map((project) => project.id)).toEqual([
        "braindrive-plus-one",
        "finance",
      ]);
      await expect(readFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "utf8"))
        .resolves.toContain("# Your Agent - Agent Context");
      const manifest = JSON.parse(await readFile(path.join(memoryRoot, "documents", "projects.json"), "utf8")) as Array<{ id: string }>;
      expect(manifest.map((project) => project.id)).toEqual([
        "braindrive-plus-one",
        "finance",
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("updates index.md when creating an uploaded markdown file", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gateway-project-upload-index-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "finance"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        JSON.stringify([{ id: "finance", name: "Finance", icon: "dollar-sign" }]),
        "utf8"
      );
      const projects = new GatewayProjectService(memoryRoot, { rootDir: tempRoot });

      const file = await projects.createUploadedMarkdownFile(
        "finance",
        "Statement.pdf",
        "# Statement\n",
        (fileName) => ({
          type: "PDF document",
          summary: "Statement uploaded from Statement.pdf and saved as markdown.",
          readWhen: `User asks about ${fileName}.`,
          importedAt: "2026-05-14T16:00:00.000Z",
        })
      );

      expect(file).toEqual({
        name: "statement.md",
        path: "documents/finance/statement.md",
      });
      const index = await readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8");
      expect(index).toContain("| `statement.md` | PDF document | Statement uploaded from Statement.pdf and saved as markdown. | User asks about statement.md. | 2026-05-14T16:00:00.000Z |");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses the generated duplicate filename in index.md", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gateway-project-upload-duplicate-index-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "finance"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        JSON.stringify([{ id: "finance", name: "Finance", icon: "dollar-sign" }]),
        "utf8"
      );
      await writeFile(path.join(memoryRoot, "documents", "finance", "statement.md"), "# Existing\n", "utf8");
      const projects = new GatewayProjectService(memoryRoot, { rootDir: tempRoot });

      const file = await projects.createUploadedMarkdownFile(
        "finance",
        "statement.pdf",
        "# Statement\n",
        (fileName) => ({
          type: "PDF document",
          summary: "Duplicate statement.",
          readWhen: `User asks about ${fileName}.`,
          importedAt: "2026-05-14T16:00:00.000Z",
        })
      );

      expect(file?.name).toBe("statement-2.md");
      const index = await readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8");
      expect(index).toContain("`statement-2.md`");
      expect(index).not.toContain("`statement.md`");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("can place finance uploads in a statements subfolder and update the source README", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gateway-project-upload-statement-index-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "finance"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        JSON.stringify([{ id: "finance", name: "Finance", icon: "dollar-sign" }]),
        "utf8"
      );
      const projects = new GatewayProjectService(memoryRoot, { rootDir: tempRoot });

      const file = await projects.createUploadedMarkdownFile(
        "finance",
        "raw-upload.pdf",
        "# Statement\n",
        {
          directory: "budget/statements",
          preferredFileName: "2026-05-capital-one.md",
          indexEntry: (filePath) => ({
            type: "Credit card statement",
            summary: "Capital One credit card statement for May 2026.",
            readWhen: `User asks about ${filePath}.`,
            importedAt: "2026-05-14T16:00:00.000Z",
          }),
        }
      );

      expect(file).toEqual({
        name: "2026-05-capital-one.md",
        path: "documents/finance/budget/statements/2026-05-capital-one.md",
      });
      const readme = await readFile(path.join(memoryRoot, "documents", "finance", "budget", "statements", "README.md"), "utf8");
      expect(readme).toContain("# Budget Statements");
      expect(readme).toContain("| `budget/statements/2026-05-capital-one.md` | Credit card statement | Capital One credit card statement for May 2026. | User asks about budget/statements/2026-05-capital-one.md. | 2026-05-14T16:00:00.000Z |");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8")).rejects.toThrow();

      const listed = await projects.listProjectFiles("finance");
      expect(listed?.files).toEqual(expect.arrayContaining([
        {
          name: "budget/statements/2026-05-capital-one.md",
          path: "documents/finance/budget/statements/2026-05-capital-one.md",
        },
      ]));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
