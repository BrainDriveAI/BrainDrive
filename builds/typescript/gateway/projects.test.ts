import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GatewayProjectService } from "./projects.js";

describe("GatewayProjectService projects", () => {
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

});
