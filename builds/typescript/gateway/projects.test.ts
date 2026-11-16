import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GatewayProjectService } from "./projects.js";

describe("GatewayProjectService projects", () => {
  it("starts a new page with only its instructions, and never reuses a deleted page's folder", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gateway-project-new-expert-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "new-page"), { recursive: true });
      await writeFile(path.join(memoryRoot, "documents", "projects.json"), "[]", "utf8");
      await writeFile(path.join(memoryRoot, "documents", "new-page", "spec.md"), "Old page's goals", "utf8");
      const projects = new GatewayProjectService(memoryRoot, { rootDir: process.cwd() });

      const created = await projects.createProject("New page");

      expect(created.id).toBe("new-page-2");
      const folder = path.join(memoryRoot, "documents", "new-page-2");
      expect(await readFile(path.join(folder, "AGENT.md"), "utf8")).toContain("BrainDrive Starter");
      for (const file of ["spec.md", "plan.md", "journal.md", "run-interview.md"]) {
        expect(existsSync(path.join(folder, file))).toBe(false);
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

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
        id: "your-agent",
        name: "Your Agent",
        icon: "sparkles",
      });
      expect(listed.projects.map((project) => project.id)).toEqual([
        "your-agent",
        "finance",
      ]);
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "AGENT.md"), "utf8"))
        .resolves.toContain("# Your Agent - Agent Context");
      const manifest = JSON.parse(await readFile(path.join(memoryRoot, "documents", "projects.json"), "utf8")) as Array<{ id: string }>;
      expect(manifest.map((project) => project.id)).toEqual([
        "your-agent",
        "finance",
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("migrates a legacy protected root agent manifest entry", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gateway-project-root-agent-legacy-repair-"));
    const memoryRoot = path.join(tempRoot, "memory");
    const rootDir = path.resolve(".");

    try {
      await mkdir(path.join(memoryRoot, "documents", "braindrive-plus-one"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        JSON.stringify([
          {
            id: "braindrive-plus-one",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: "conversation-legacy",
            default_skill_ids: ["interview"],
          },
        ]),
        "utf8"
      );
      await writeFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "# Legacy Agent\n", "utf8");
      const projects = new GatewayProjectService(memoryRoot, { rootDir });

      const listed = await projects.listProjects();

      expect(listed.projects).toHaveLength(1);
      expect(listed.projects[0]).toMatchObject({
        id: "your-agent",
        name: "Your Agent",
        conversation_id: "conversation-legacy",
        default_skill_ids: ["interview"],
      });
      await expect(projects.readProjectFile("braindrive-plus-one", "documents/braindrive-plus-one/AGENT.md"))
        .resolves.toBe("# Legacy Agent\n");
      await expect(projects.readProjectFile("your-agent", "documents/your-agent/AGENT.md"))
        .resolves.toBe("# Legacy Agent\n");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("protects canonical and legacy root agent ids from mutation", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gateway-project-root-agent-protected-"));
    const memoryRoot = path.join(tempRoot, "memory");
    const rootDir = path.resolve(".");

    try {
      const projects = new GatewayProjectService(memoryRoot, { rootDir });
      await projects.listProjects();

      await expect(projects.renameProject("your-agent", "Renamed")).rejects.toMatchObject({
        code: "project_protected",
      });
      await expect(projects.renameProject("braindrive-plus-one", "Renamed")).rejects.toMatchObject({
        code: "project_protected",
      });
      await expect(projects.deleteProject("your-agent")).rejects.toMatchObject({
        code: "project_protected",
      });
      await expect(projects.deleteProject("braindrive-plus-one")).rejects.toMatchObject({
        code: "project_protected",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  describe("deleting one file from a page", () => {
    async function withPage(run: (projects: GatewayProjectService, pageRoot: string, tempRoot: string) => Promise<void>) {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gateway-project-delete-file-"));
      const memoryRoot = path.join(tempRoot, "memory");
      const pageRoot = path.join(memoryRoot, "documents", "finance");
      try {
        await mkdir(path.join(pageRoot, "added"), { recursive: true });
        await writeFile(path.join(memoryRoot, "documents", "projects.json"), JSON.stringify([{ id: "finance", name: "Finance", icon: "wallet", conversation_id: null }]), "utf8");
        for (const name of ["AGENT.md", "spec.md", "plan.md", "journal.md", "run-interview.md", "added/notes.md"]) await writeFile(path.join(pageRoot, name), `# ${name}`, "utf8");
        await run(new GatewayProjectService(memoryRoot, { rootDir: tempRoot }), pageRoot, tempRoot);
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    }

    it("deletes an owner-added file and a method file, and leaves everything else", async () => {
      await withPage(async (projects, pageRoot) => {
        await expect(projects.deleteProjectFile("finance", "documents/finance/added/notes.md")).resolves.toBe(true);
        await expect(projects.deleteProjectFile("finance", "finance/run-interview.md")).resolves.toBe(true);
        expect(existsSync(path.join(pageRoot, "added", "notes.md"))).toBe(false);
        expect(existsSync(path.join(pageRoot, "run-interview.md"))).toBe(false);
        for (const name of ["AGENT.md", "spec.md", "plan.md", "journal.md"]) expect(existsSync(path.join(pageRoot, name))).toBe(true);
      });
    });

    it("refuses the files a page needs: instructions, goals, plan and journal", async () => {
      await withPage(async (projects, pageRoot) => {
        for (const name of ["AGENT.md", "agent.md", "spec.md", "plan.md", "journal.md"]) {
          await expect(projects.deleteProjectFile("finance", `documents/finance/${name}`)).rejects.toMatchObject({ code: "file_protected" });
        }
        expect(existsSync(path.join(pageRoot, "AGENT.md"))).toBe(true);
      });
    });

    it("refuses a path outside the page, a folder, and a link that points elsewhere", async () => {
      await withPage(async (projects, pageRoot, tempRoot) => {
        const outside = path.join(tempRoot, "outside.md");
        await writeFile(outside, "keep me", "utf8");
        await symlink(outside, path.join(pageRoot, "link.md"));
        for (const bad of ["documents/finance/../projects.json", "documents/fitness/spec.md", "../outside.md", "documents/finance", "documents/finance/added", "documents/finance/link.md", ""]) {
          await expect(projects.deleteProjectFile("finance", bad)).rejects.toThrow("Invalid path");
        }
        expect(await readFile(outside, "utf8")).toBe("keep me");
        expect(existsSync(path.join(pageRoot, "added", "notes.md"))).toBe(true);
        expect(existsSync(path.join(tempRoot, "memory", "documents", "projects.json"))).toBe(true);
      });
    });

    it("reports a missing page and a missing file differently", async () => {
      await withPage(async (projects) => {
        await expect(projects.deleteProjectFile("nope", "documents/nope/x.md")).resolves.toBe(false);
        await expect(projects.deleteProjectFile("finance", "documents/finance/added/gone.md")).rejects.toMatchObject({ code: "ENOENT" });
      });
    });
  });

});
