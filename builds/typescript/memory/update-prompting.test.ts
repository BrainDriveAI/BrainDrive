import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import { describe, expect, it } from "vitest";

import type { ModelAdapter, ModelResponse } from "../adapters/base.js";
import type { GatewayEngineRequest, ToolDefinition } from "../contracts.js";
import { initializeMemoryLayout } from "./init.js";
import {
  generateStarterPackManifest,
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

async function writeProjectTemplate(rootDir: string, projectId: string): Promise<void> {
  const templateRoot = path.join(rootDir, "memory", "starter-pack", "projects", "templates", projectId);
  await mkdir(templateRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "AGENT.md"), `# ${projectId} Agent\n\nRead index.md.\n`, "utf8");
  if (projectId === "finance") {
    await mkdir(path.join(templateRoot, "budget"), { recursive: true });
    await mkdir(path.join(templateRoot, "statements"), { recursive: true });
    await mkdir(path.join(templateRoot, "reports"), { recursive: true });
    await writeFile(path.join(templateRoot, "spec.md"), "# Finance Spec\n\n**Status:** Starter\n\n**Last updated:** -\n\n## Changelog\n", "utf8");
    await writeFile(path.join(templateRoot, "run-interview.md"), "# Finance Interview\n", "utf8");
    await writeFile(path.join(templateRoot, "plan.md"), "# Finance Plan\n\n**Status:** Starter\n\n**Last updated:** -\n\n## Changelog\n", "utf8");
    await writeFile(path.join(templateRoot, "run-planning.md"), "# Finance Planning\n", "utf8");
    await writeFile(path.join(templateRoot, "budget", "AGENT.md"), "# Budget - Agent Context\n", "utf8");
    await writeFile(path.join(templateRoot, "budget", "budget.md"), "# Budget\n\n**Status:** Starter\n\n**Last updated:** -\n\n## Changelog\n", "utf8");
    await writeFile(path.join(templateRoot, "budget", "budget-rules.md"), "# Budget Rules\n", "utf8");
    await writeFile(path.join(templateRoot, "budget", "create.md"), "# Create Or Revise Saved Budget\n", "utf8");
    await writeFile(path.join(templateRoot, "budget", "compare.md"), "# Compare Actuals Against Saved Budget\n", "utf8");
    await writeFile(path.join(templateRoot, "statements", "README.md"), "# Finance Statements\n", "utf8");
    await writeFile(path.join(templateRoot, "reports", "README.md"), "# Finance Reports\n", "utf8");
    await writeFile(path.join(templateRoot, "reports", "latest.md"), "# Latest Budget Report\n", "utf8");
  } else {
    await writeFile(path.join(templateRoot, "index.md"), "# Folder Index\n\n## Supporting Documents\n\n| File | Type | Summary | Read When | Imported |\n|---|---|---|---|---|\n| _No supporting documents yet._ | | | | |\n", "utf8");
  }
  if (projectId === "fitness") {
    await mkdir(path.join(templateRoot, "health-docs"), { recursive: true });
    await writeFile(path.join(templateRoot, "health-docs", "index.md"), "# Health Docs Instruction Index\n", "utf8");
    await writeFile(path.join(templateRoot, "health-docs", "intake-and-disclaimer.md"), "# Health Document Intake And Disclaimer\n", "utf8");
    await writeFile(path.join(templateRoot, "health-docs", "relevance-and-routing.md"), "# Health Document Relevance And Routing\n", "utf8");
    await writeFile(path.join(templateRoot, "health-docs", "interpretation-voice.md"), "# Health Interpretation Voice\n", "utf8");
    await writeFile(path.join(templateRoot, "health-docs", "conflict-and-staleness.md"), "# Health Conflict And Staleness Rules\n", "utf8");
    await writeFile(path.join(templateRoot, "health-docs", "update-existing-plan.md"), "# Updating An Existing Fitness Plan With New Health Docs\n", "utf8");
  }
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

  it("includes seeded project templates in the starter-pack manifest and creates missing indexes", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-update-project-index-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await writeStarterPack(rootDir);
      await writeProjectTemplate(rootDir, "finance");
      await writeProjectTemplate(rootDir, "fitness");
      await mkdir(path.join(memoryRoot, "documents", "finance"), { recursive: true });
      await mkdir(path.join(memoryRoot, "documents", "fitness"), { recursive: true });
      await mkdir(path.join(memoryRoot, "me"), { recursive: true });
      await writeFile(path.join(memoryRoot, "AGENT.md"), "# BrainDrive Agent\n\nUse the latest guidance.\n", "utf8");
      await writeFile(path.join(memoryRoot, "me", "todo.md"), "# My Todos\n\n## Active\n", "utf8");
      await writeFile(path.join(memoryRoot, "documents", "finance", "AGENT.md"), "# Custom Finance Agent\n", "utf8");
      await writeFile(path.join(memoryRoot, "documents", "fitness", "AGENT.md"), "# Custom Fitness Agent\n", "utf8");

      const manifest = await generateStarterPackManifest(rootDir, "26.5.7");
      expect(manifest.files.map((file) => file.path)).not.toContain("documents/finance/index.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/AGENT.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/run-interview.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/run-planning.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/budget/AGENT.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/budget/budget.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/budget/budget-rules.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/budget/create.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/budget/compare.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/statements/README.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/reports/README.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/finance/reports/latest.md");
      expect(manifest.files.find((file) => file.path === "documents/finance/budget/budget-rules.md")).toMatchObject({
        ownership: "managed_base",
        role: "rule_framework",
        overlay_path: "documents/finance/budget/budget-rules-user.md",
      });
      expect(manifest.files.find((file) => file.path === "documents/finance/budget/budget.md")).toMatchObject({
        ownership: "owner_state",
        role: "state_artifact",
        merge_policy: "preserve_owner_state",
      });
      expect(manifest.files.map((file) => file.path)).toContain("documents/fitness/index.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/fitness/AGENT.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/fitness/health-docs/index.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/fitness/health-docs/intake-and-disclaimer.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/fitness/health-docs/relevance-and-routing.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/fitness/health-docs/interpretation-voice.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/fitness/health-docs/conflict-and-staleness.md");
      expect(manifest.files.map((file) => file.path)).toContain("documents/fitness/health-docs/update-existing-plan.md");

      const result = await runAutomaticMemoryUpdate(rootDir, memoryRoot, "26.5.7");

      expect(result?.applied_paths).toContain("documents/finance/run-interview.md");
      expect(result?.applied_paths).toContain("documents/finance/run-planning.md");
      expect(result?.applied_paths).toContain("documents/finance/budget/AGENT.md");
      expect(result?.applied_paths).toContain("documents/finance/budget/budget.md");
      expect(result?.applied_paths).toContain("documents/finance/budget/budget-rules.md");
      expect(result?.applied_paths).toContain("documents/finance/budget/create.md");
      expect(result?.applied_paths).toContain("documents/finance/budget/compare.md");
      expect(result?.applied_paths).toContain("documents/finance/statements/README.md");
      expect(result?.applied_paths).toContain("documents/finance/reports/README.md");
      expect(result?.applied_paths).toContain("documents/finance/reports/latest.md");
      expect(result?.deferred_paths).toContain("documents/finance/AGENT.md");
      expect(result?.applied_paths).toContain("documents/fitness/index.md");
      expect(result?.applied_paths).toContain("documents/fitness/health-docs/index.md");
      expect(result?.applied_paths).toContain("documents/fitness/health-docs/intake-and-disclaimer.md");
      expect(result?.applied_paths).toContain("documents/fitness/health-docs/relevance-and-routing.md");
      expect(result?.applied_paths).toContain("documents/fitness/health-docs/interpretation-voice.md");
      expect(result?.applied_paths).toContain("documents/fitness/health-docs/conflict-and-staleness.md");
      expect(result?.applied_paths).toContain("documents/fitness/health-docs/update-existing-plan.md");
      expect(result?.deferred_paths).toContain("documents/fitness/AGENT.md");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8"))
        .resolves.toContain("# Budget");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget-rules.md"), "utf8"))
        .resolves.toContain("# Budget Rules");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "reports", "latest.md"), "utf8"))
        .resolves.toContain("# Latest Budget Report");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "compare.md"), "utf8"))
        .resolves.toContain("# Compare Actuals Against Saved Budget");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "index.md"), "utf8"))
        .resolves.toContain("# Health Docs Instruction Index");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "interpretation-voice.md"), "utf8"))
        .resolves.toContain("# Health Interpretation Voice");
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
