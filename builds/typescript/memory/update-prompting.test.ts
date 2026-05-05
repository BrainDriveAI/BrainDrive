import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import { describe, expect, it } from "vitest";

import type { ModelAdapter, ModelResponse } from "../adapters/base.js";
import type { GatewayEngineRequest, ToolDefinition } from "../contracts.js";
import { initializeMemoryLayout } from "./init.js";
import {
  generateMemoryUpdatePlan,
  getMemoryUpdateStatus,
  readMemoryUpdateReport,
  runAutomaticMemoryUpdate,
} from "./update-prompting.js";

class StaticJsonAdapter implements ModelAdapter {
  constructor(private readonly payload: unknown) {}

  async complete(_request: GatewayEngineRequest, _tools: ToolDefinition[]): Promise<ModelResponse> {
    return {
      assistantText: JSON.stringify(this.payload),
      toolCalls: [],
      finishReason: "stop",
    };
  }
}

async function writeStarterPack(rootDir: string): Promise<void> {
  const starterRoot = path.join(rootDir, "memory", "starter-pack");
  await mkdir(path.join(starterRoot, "base", "me"), { recursive: true });
  await mkdir(path.join(starterRoot, "skills"), { recursive: true });
  await writeFile(path.join(starterRoot, "base", "AGENT.md"), "# BrainDrive Agent\n\nUse the latest guidance.\n", "utf8");
  await writeFile(path.join(starterRoot, "base", "me", "todo.md"), "# My Todos\n\n## Active\n", "utf8");
  await writeFile(path.join(starterRoot, "skills", "focus.md"), "# Focus\n\nHelp the owner focus.\n", "utf8");
}

describe("memory update prompting", () => {
  it("auto-creates missing starter files and defers customized existing files without an LLM", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-update-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await writeStarterPack(rootDir);
      await mkdir(memoryRoot, { recursive: true });
      await writeFile(path.join(memoryRoot, "AGENT.md"), "# Owner Custom Agent\n\nKeep my custom guidance.\n", "utf8");

      const result = await runAutomaticMemoryUpdate(rootDir, memoryRoot, "26.5.1");

      expect(result).not.toBeNull();
      expect(result?.status).toBe("partially_applied");
      expect(result?.applied_paths).toContain("me/todo.md");
      expect(result?.applied_paths).toContain("skills/focus/SKILL.md");
      expect(result?.deferred_paths).toContain("AGENT.md");

      await expect(readFile(path.join(memoryRoot, "me", "todo.md"), "utf8")).resolves.toContain("# My Todos");
      await expect(readFile(path.join(memoryRoot, "skills", "focus", "SKILL.md"), "utf8")).resolves.toContain("# Focus");
      await expect(readFile(path.join(memoryRoot, "AGENT.md"), "utf8")).resolves.toContain("Owner Custom Agent");

      const report = await readMemoryUpdateReport(memoryRoot, "starter-pack-26.5.1");
      expect(report).toContain("BrainDrive Memory Update 26.5.1");
      expect(report).toContain("AGENT.md has custom content");
      expect(result?.backup_path).toBe("system/updates/backups/starter-pack-26.5.1.tar.gz");

      const status = await getMemoryUpdateStatus(rootDir, memoryRoot, "26.5.1");
      expect(status.pending).toBe(false);
      expect(status.memory_pack_version).toBe("26.5.1");
      expect(status.deferred_paths).toContain("AGENT.md");

      const repeatResult = await runAutomaticMemoryUpdate(rootDir, memoryRoot, "26.5.1");
      expect(repeatResult).toBeNull();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("owns starter skill creation when startup layout skips legacy skill bootstrap", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-update-startup-seed-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await writeStarterPack(rootDir);
      await initializeMemoryLayout(rootDir, memoryRoot, {
        seedDefaultProjects: false,
        seedStarterSkills: false,
      });

      await expect(readFile(path.join(memoryRoot, "skills", "focus", "SKILL.md"), "utf8")).rejects.toThrow();

      const result = await runAutomaticMemoryUpdate(rootDir, memoryRoot, "26.5.4");

      expect(result?.status).toBe("applied");
      expect(result?.applied_paths).toContain("skills/focus/SKILL.md");
      await expect(readFile(path.join(memoryRoot, "skills", "focus", "SKILL.md"), "utf8")).resolves.toContain("# Focus");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("applies an LLM-generated merge for customized AGENT.md", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-update-llm-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await writeStarterPack(rootDir);
      await mkdir(memoryRoot, { recursive: true });
      await writeFile(path.join(memoryRoot, "AGENT.md"), "# Owner Custom Agent\n\nKeep my custom guidance.\n", "utf8");

      const adapter = new StaticJsonAdapter({
        schema_version: 1,
        migration_id: "starter-pack-26.5.2",
        from_memory_pack_version: "unknown",
        to_memory_pack_version: "26.5.2",
        summary: "Merged the latest BrainDrive guidance.",
        auto_apply: true,
        owner_report: "BrainDrive updated your core memory instructions and preserved your custom guidance.",
        items: [
          {
            path: "AGENT.md",
            action: "merge",
            confidence: "high",
            owner_summary: "Updated the main agent instructions while keeping your custom guidance.",
            risk: "medium",
            auto_apply: true,
            replacement_content: "# Owner Custom Agent\n\nKeep my custom guidance.\n\nUse the latest guidance.\n",
          },
        ],
      });

      const plan = await generateMemoryUpdatePlan(rootDir, memoryRoot, "26.5.2", { adapter });
      expect(plan.items.find((item) => item.path === "AGENT.md")?.action).toBe("merge");

      const result = await runAutomaticMemoryUpdate(rootDir, memoryRoot, "26.5.2", { adapter });

      expect(result?.status).toBe("applied");
      expect(result?.applied_paths).toContain("AGENT.md");
      await expect(readFile(path.join(memoryRoot, "AGENT.md"), "utf8")).resolves.toContain("Use the latest guidance.");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("normalizes incomplete LLM plans without aborting startup updates", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-update-incomplete-llm-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await writeStarterPack(rootDir);
      await mkdir(memoryRoot, { recursive: true });

      const adapter = new StaticJsonAdapter({
        schema_version: 1,
        to_memory_pack_version: "26.5.5",
        summary: "Created missing starter content.",
        auto_apply: true,
        owner_report: "BrainDrive added new starter content.",
        items: [
          {
            path: "skills/focus/SKILL.md",
            action: "create",
            confidence: "high",
            owner_summary: "Added the Focus skill.",
            risk: "low",
            auto_apply: true,
            replacement_content: "# Focus\n\nHelp the owner focus.\n",
          },
        ],
      });

      const result = await runAutomaticMemoryUpdate(rootDir, memoryRoot, "26.5.5", { adapter });

      expect(result?.migration_id).toBe("starter-pack-26.5.5");
      expect(result?.applied_paths).toContain("skills/focus/SKILL.md");
      await expect(readFile(path.join(memoryRoot, "skills", "focus", "SKILL.md"), "utf8")).resolves.toContain("# Focus");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports no pending update when memory already matches the starter pack", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-update-current-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await writeStarterPack(rootDir);
      await mkdir(path.join(memoryRoot, "me"), { recursive: true });
      await mkdir(path.join(memoryRoot, "skills", "focus"), { recursive: true });
      await writeFile(path.join(memoryRoot, "AGENT.md"), "# BrainDrive Agent\n\nUse the latest guidance.\n", "utf8");
      await writeFile(path.join(memoryRoot, "me", "todo.md"), "# My Todos\n\n## Active\n", "utf8");
      await writeFile(path.join(memoryRoot, "skills", "focus", "SKILL.md"), "# Focus\n\nHelp the owner focus.\n", "utf8");

      const status = await getMemoryUpdateStatus(rootDir, memoryRoot, "26.5.3");

      expect(status.pending).toBe(false);
      expect(status.memory_pack_version).toBe("26.5.3");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
