import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createEmptyAppliedState } from "./applied-state.js";
import type { ManifestMigrationItem, UpdatesManifest } from "./manifest.js";
import { planPendingMigrations, selectPendingMigrationItems } from "./planner.js";

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
      ai_briefing: versionItems[0]?.ai_briefing ?? "",
      items: versionItems,
    })),
    items,
  };
}

function createWriteItem(params: {
  id: string;
  version: string;
  summary: string;
  sourcePath: string;
  targetPath: string;
  dependsOn?: string[];
}): ManifestMigrationItem {
  return {
    id: params.id,
    version: params.version,
    summary: params.summary,
    ai_briefing: "Plan update actions based on starter-pack targets.",
    depends_on: params.dependsOn ?? [],
    file_actions: [
      {
        kind: "write",
        source_path: params.sourcePath,
        target_path: params.targetPath,
      },
    ],
    source_file_paths: [params.sourcePath],
  };
}

describe("pending migration planner", () => {
  it("classifies pending items as clean, conflicting, removed, and dependency-blocked", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-planner-"));
    const starterBaseRoot = path.join(tempRoot, "starter-base");
    const libraryRoot = path.join(tempRoot, "library");

    const cleanItem = createWriteItem({
      id: "1.1.0:clean:aaaa1111",
      version: "1.1.0",
      summary: "Apply clean update",
      sourcePath: "templates/clean.md",
      targetPath: "documents/clean.md",
    });
    const conflictingItem = createWriteItem({
      id: "1.1.0:conflicting:bbbb2222",
      version: "1.1.0",
      summary: "Apply conflicting update",
      sourcePath: "templates/conflicting.md",
      targetPath: "documents/conflicting.md",
    });
    const removedItem = createWriteItem({
      id: "1.1.0:removed:cccc3333",
      version: "1.1.0",
      summary: "Apply removed update",
      sourcePath: "templates/missing.md",
      targetPath: "documents/missing.md",
    });
    const blockedItem = createWriteItem({
      id: "1.1.0:blocked:dddd4444",
      version: "1.1.0",
      summary: "Apply dependency-blocked update",
      sourcePath: "templates/blocked.md",
      targetPath: "documents/blocked.md",
      dependsOn: [conflictingItem.id],
    });

    const manifest = createManifest([cleanItem, conflictingItem, removedItem, blockedItem]);

    try {
      await mkdir(path.join(starterBaseRoot, "templates"), { recursive: true });
      await mkdir(path.join(libraryRoot, "documents"), { recursive: true });

      await writeFile(path.join(starterBaseRoot, "templates", "clean.md"), "clean content\n", "utf8");
      await writeFile(path.join(starterBaseRoot, "templates", "conflicting.md"), "starter content\n", "utf8");
      await writeFile(path.join(starterBaseRoot, "templates", "blocked.md"), "blocked content\n", "utf8");
      await writeFile(path.join(libraryRoot, "documents", "conflicting.md"), "user modified content\n", "utf8");

      const plan = await planPendingMigrations(manifest, {
        current_version: "1.0.0",
        target_version: "1.1.0",
        starter_pack_base_root: starterBaseRoot,
        library_root: libraryRoot,
        applied_state: createEmptyAppliedState(),
      });

      const byId = new Map(plan.items.map((item) => [item.id, item]));
      expect(byId.get(cleanItem.id)?.classification).toBe("clean");
      expect(byId.get(conflictingItem.id)?.classification).toBe("conflicting");
      expect(byId.get(removedItem.id)?.classification).toBe("removed");
      expect(byId.get(blockedItem.id)?.classification).toBe("dependency-blocked");
      expect(byId.get(blockedItem.id)?.blocking_dependencies).toEqual([conflictingItem.id]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("selects cumulative pending items across skipped versions and omits declined decisions", () => {
    const itemOne = createWriteItem({
      id: "1.1.0:seed:1111aaaa",
      version: "1.1.0",
      summary: "Version 1.1 update",
      sourcePath: "templates/v1-1.md",
      targetPath: "documents/v1-1.md",
    });
    const itemTwo = createWriteItem({
      id: "1.3.0:seed:2222bbbb",
      version: "1.3.0",
      summary: "Version 1.3 update",
      sourcePath: "templates/v1-3.md",
      targetPath: "documents/v1-3.md",
    });

    const manifest = createManifest([itemOne, itemTwo]);

    const allPending = selectPendingMigrationItems(manifest, {
      current_version: "1.0.0",
      target_version: "1.3.0",
      applied_state: createEmptyAppliedState(),
    });
    expect(allPending.map((item) => item.id)).toEqual([itemOne.id, itemTwo.id]);

    const withDeclined = selectPendingMigrationItems(manifest, {
      current_version: "1.0.0",
      target_version: "1.3.0",
      applied_state: {
        last_applied: "1.0.0",
        items: {
          [itemOne.id]: {
            status: "declined",
            decided_at: "2026-04-18T12:00:00Z",
          },
        },
        runs: [],
      },
    });
    expect(withDeclined.map((item) => item.id)).toEqual([itemTwo.id]);
  });
});
