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
        id: "braindrive-plus-one",
        name: "Your Agent",
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

});
