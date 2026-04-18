import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createEmptyAppliedState, loadAppliedState } from "./applied-state.js";
import { applyMigrationAcceptAll, applyMigrationItem } from "./apply-migration.js";
import type { ManifestMigrationItem, UpdatesManifest } from "./manifest.js";
import { planPendingMigrations } from "./planner.js";

type TestPaths = {
  temp_root: string;
  starter_root: string;
  memory_root: string;
};

function createManifest(items: ManifestMigrationItem[]): UpdatesManifest {
  const byVersion = new Map<string, ManifestMigrationItem[]>();
  for (const item of items) {
    const existing = byVersion.get(item.version) ?? [];
    existing.push(item);
    byVersion.set(item.version, existing);
  }

  return {
    versions: [...byVersion.entries()].map(([version, versionItems]) => ({
      version,
      ai_briefing: `Briefing for ${version}`,
      items: versionItems,
    })),
    items,
  };
}

function createWriteItem(params: {
  id: string;
  version: string;
  summary: string;
  actions: Array<{ source_path: string; target_path: string }>;
  depends_on?: string[];
}): ManifestMigrationItem {
  return {
    id: params.id,
    version: params.version,
    summary: params.summary,
    ai_briefing: "Apply updates safely.",
    depends_on: params.depends_on ?? [],
    file_actions: params.actions.map((action) => ({
      kind: "write" as const,
      source_path: action.source_path,
      target_path: action.target_path,
    })),
    source_file_paths: dedupeStrings(params.actions.map((action) => action.source_path)),
  };
}

async function createPaths(): Promise<TestPaths> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-apply-migration-"));
  const starterRoot = path.join(tempRoot, "starter-pack", "base");
  const memoryRoot = path.join(tempRoot, "memory");
  await mkdir(starterRoot, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  return {
    temp_root: tempRoot,
    starter_root: starterRoot,
    memory_root: memoryRoot,
  };
}

async function cleanupPaths(paths: TestPaths): Promise<void> {
  await rm(paths.temp_root, { recursive: true, force: true });
}

async function planForItems(paths: TestPaths, manifest: UpdatesManifest) {
  return planPendingMigrations(manifest, {
    current_version: "1.0.0",
    target_version: manifest.versions[manifest.versions.length - 1]?.version ?? "1.0.0",
    starter_pack_base_root: paths.starter_root,
    library_root: paths.memory_root,
    applied_state: createEmptyAppliedState(),
  });
}

describe("atomic migration apply", () => {
  it("records in_progress before mutation and creates a new file only after explicit acceptance", async () => {
    const paths = await createPaths();

    try {
      const item = createWriteItem({
        id: "1.1.0:new-file:1111aaaa",
        version: "1.1.0",
        summary: "Create new file",
        actions: [{ source_path: "templates/new-file.md", target_path: "documents/new-file.md" }],
      });
      const manifest = createManifest([item]);

      await mkdir(path.join(paths.starter_root, "templates"), { recursive: true });
      await writeFile(path.join(paths.starter_root, "templates", "new-file.md"), "new file content\n", "utf8");

      const plan = await planForItems(paths, manifest);
      let observedInProgress = false;

      const result = await applyMigrationItem({
        memory_root: paths.memory_root,
        starter_pack_base_root: paths.starter_root,
        manifest,
        plan,
        approval: {
          item_id: item.id,
          decision: "accept",
          approved_by: "owner",
        },
        on_before_mutations: async () => {
          const state = await loadAppliedState(paths.memory_root);
          observedInProgress = state.items[item.id]?.status === "in_progress";
          await expect(pathExists(path.join(paths.memory_root, "documents", "new-file.md"))).resolves.toBe(false);
        },
      });

      expect(observedInProgress).toBe(true);
      expect(result.status).toBe("applied");
      expect(await readFile(path.join(paths.memory_root, "documents", "new-file.md"), "utf8")).toBe(
        "new file content\n"
      );

      const finalState = await loadAppliedState(paths.memory_root);
      expect(finalState.items[item.id]?.status).toBe("applied");
    } finally {
      await cleanupPaths(paths);
    }
  });

  it("defaults changed files to merge and inserts new AGENT.md lines without losing local edits", async () => {
    const paths = await createPaths();

    try {
      const item = createWriteItem({
        id: "1.1.0:agent-merge:2222bbbb",
        version: "1.1.0",
        summary: "Merge AGENT.md",
        actions: [{ source_path: "base/AGENT.md", target_path: "AGENT.md" }],
      });
      const manifest = createManifest([item]);

      await mkdir(path.join(paths.starter_root, "base"), { recursive: true });
      await writeFile(
        path.join(paths.starter_root, "base", "AGENT.md"),
        ["# Agent", "- Keep concise", "- Use checklists", ""].join("\n"),
        "utf8"
      );
      await writeFile(
        path.join(paths.memory_root, "AGENT.md"),
        ["# Agent", "- Keep concise", "- Local customization", ""].join("\n"),
        "utf8"
      );

      const plan = await planForItems(paths, manifest);
      const result = await applyMigrationItem({
        memory_root: paths.memory_root,
        starter_pack_base_root: paths.starter_root,
        manifest,
        plan,
        approval: {
          item_id: item.id,
          decision: "accept",
          approved_by: "owner",
        },
      });

      expect(result.preview.files[0]?.default_action).toBe("merge");
      const merged = await readFile(path.join(paths.memory_root, "AGENT.md"), "utf8");
      expect(merged).toContain("- Use checklists");
      expect(merged).toContain("- Local customization");
      expect(result.status).toBe("applied");
    } finally {
      await cleanupPaths(paths);
    }
  });

  it("requires explicit overwrite action for replacement", async () => {
    const paths = await createPaths();

    try {
      const item = createWriteItem({
        id: "1.1.0:overwrite:3333cccc",
        version: "1.1.0",
        summary: "Overwrite file",
        actions: [{ source_path: "templates/config.md", target_path: "documents/config.md" }],
      });
      const manifest = createManifest([item]);

      await mkdir(path.join(paths.starter_root, "templates"), { recursive: true });
      await mkdir(path.join(paths.memory_root, "documents"), { recursive: true });
      await writeFile(path.join(paths.starter_root, "templates", "config.md"), "starter value\n", "utf8");
      await writeFile(path.join(paths.memory_root, "documents", "config.md"), "owner value\n", "utf8");

      const plan = await planForItems(paths, manifest);
      const result = await applyMigrationItem({
        memory_root: paths.memory_root,
        starter_pack_base_root: paths.starter_root,
        manifest,
        plan,
        approval: {
          item_id: item.id,
          decision: "accept",
          approved_by: "owner",
          file_actions: {
            "documents/config.md": "overwrite",
          },
        },
      });

      expect(result.preview.files[0]?.requires_explicit_overwrite).toBe(true);
      expect(await readFile(path.join(paths.memory_root, "documents", "config.md"), "utf8")).toBe(
        "starter value\n"
      );
      expect(result.status).toBe("applied");
    } finally {
      await cleanupPaths(paths);
    }
  });

  it("marks declined items as terminal without mutating files", async () => {
    const paths = await createPaths();

    try {
      const item = createWriteItem({
        id: "1.1.0:decline:4444dddd",
        version: "1.1.0",
        summary: "Decline update",
        actions: [{ source_path: "templates/skip.md", target_path: "documents/skip.md" }],
      });
      const manifest = createManifest([item]);

      await mkdir(path.join(paths.starter_root, "templates"), { recursive: true });
      await mkdir(path.join(paths.memory_root, "documents"), { recursive: true });
      await writeFile(path.join(paths.starter_root, "templates", "skip.md"), "starter\n", "utf8");
      await writeFile(path.join(paths.memory_root, "documents", "skip.md"), "owner\n", "utf8");

      const plan = await planForItems(paths, manifest);
      const result = await applyMigrationItem({
        memory_root: paths.memory_root,
        starter_pack_base_root: paths.starter_root,
        manifest,
        plan,
        approval: {
          item_id: item.id,
          decision: "decline",
          approved_by: "owner",
          note: "keep local customizations",
        },
      });

      expect(result.status).toBe("declined");
      expect(await readFile(path.join(paths.memory_root, "documents", "skip.md"), "utf8")).toBe("owner\n");

      const state = await loadAppliedState(paths.memory_root);
      expect(state.items[item.id]?.status).toBe("declined");
    } finally {
      await cleanupPaths(paths);
    }
  });

  it("stops accept-all on first failure, preserves rollback snapshot, and leaves remaining items pending", async () => {
    const paths = await createPaths();

    try {
      const failingItem = createWriteItem({
        id: "1.2.0:fail-first:5555eeee",
        version: "1.2.0",
        summary: "First action fails",
        actions: [
          { source_path: "templates/first.md", target_path: "documents/first.md" },
          { source_path: "templates/missing.md", target_path: "documents/missing.md" },
        ],
      });
      const pendingItem = createWriteItem({
        id: "1.2.0:pending-second:6666ffff",
        version: "1.2.0",
        summary: "Second action pending",
        actions: [{ source_path: "templates/second.md", target_path: "documents/second.md" }],
      });
      const manifest = createManifest([failingItem, pendingItem]);

      await mkdir(path.join(paths.starter_root, "templates"), { recursive: true });
      await mkdir(path.join(paths.memory_root, "documents"), { recursive: true });
      await writeFile(path.join(paths.starter_root, "templates", "first.md"), "starter-first\n", "utf8");
      await writeFile(path.join(paths.starter_root, "templates", "second.md"), "starter-second\n", "utf8");
      await writeFile(path.join(paths.memory_root, "documents", "first.md"), "owner-first\n", "utf8");

      const plan = await planForItems(paths, manifest);
      const result = await applyMigrationAcceptAll({
        memory_root: paths.memory_root,
        starter_pack_base_root: paths.starter_root,
        manifest,
        plan,
        approved_by: "owner",
      });

      expect(result.stopped_after_failure).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.status).toBe("failed");
      expect(result.pending_item_ids).toEqual([pendingItem.id]);
      expect(await readFile(path.join(paths.memory_root, "documents", "first.md"), "utf8")).toBe(
        "owner-first\n"
      );
      await expect(pathExists(path.join(paths.memory_root, "documents", "second.md"))).resolves.toBe(false);

      const state = await loadAppliedState(paths.memory_root);
      expect(state.items[failingItem.id]?.status).toBe("failed");
      expect(state.items[failingItem.id]?.snapshot_path).toBeTruthy();
      expect(state.items[failingItem.id]?.error_summary).toBeTruthy();
      expect(state.items[pendingItem.id]).toBeUndefined();
      expect(state.last_applied).toBeNull();
    } finally {
      await cleanupPaths(paths);
    }
  });

  it("supports idempotent retry after failure and advances last_applied only when target range is terminal and successful", async () => {
    const paths = await createPaths();

    try {
      const retryItem = createWriteItem({
        id: "1.2.0:retry-first:7777aaaa",
        version: "1.2.0",
        summary: "Retry first item",
        actions: [
          { source_path: "templates/retry-first.md", target_path: "documents/retry-first.md" },
          { source_path: "templates/retry-missing.md", target_path: "documents/retry-missing.md" },
        ],
      });
      const secondItem = createWriteItem({
        id: "1.2.0:retry-second:8888bbbb",
        version: "1.2.0",
        summary: "Retry second item",
        actions: [{ source_path: "templates/retry-second.md", target_path: "documents/retry-second.md" }],
      });
      const manifest = createManifest([retryItem, secondItem]);

      await mkdir(path.join(paths.starter_root, "templates"), { recursive: true });
      await mkdir(path.join(paths.memory_root, "documents"), { recursive: true });
      await writeFile(path.join(paths.starter_root, "templates", "retry-first.md"), "retry-first\n", "utf8");
      await writeFile(path.join(paths.starter_root, "templates", "retry-second.md"), "retry-second\n", "utf8");

      const plan = await planForItems(paths, manifest);

      const firstPass = await applyMigrationAcceptAll({
        memory_root: paths.memory_root,
        starter_pack_base_root: paths.starter_root,
        manifest,
        plan,
        approved_by: "owner",
      });
      expect(firstPass.stopped_after_failure).toBe(true);

      await writeFile(path.join(paths.starter_root, "templates", "retry-missing.md"), "retry-missing\n", "utf8");

      const secondPass = await applyMigrationAcceptAll({
        memory_root: paths.memory_root,
        starter_pack_base_root: paths.starter_root,
        manifest,
        plan,
        approved_by: "owner",
      });

      expect(secondPass.stopped_after_failure).toBe(false);
      expect(secondPass.results.map((entry) => entry.status)).toEqual(["applied", "applied"]);
      expect(await readFile(path.join(paths.memory_root, "documents", "retry-first.md"), "utf8")).toBe(
        "retry-first\n"
      );
      expect(await readFile(path.join(paths.memory_root, "documents", "retry-second.md"), "utf8")).toBe(
        "retry-second\n"
      );

      const state = await loadAppliedState(paths.memory_root);
      expect(state.items[retryItem.id]?.status).toBe("applied");
      expect(state.items[secondItem.id]?.status).toBe("applied");
      expect(state.last_applied).toBe("1.2.0");
    } finally {
      await cleanupPaths(paths);
    }
  });
});

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}
