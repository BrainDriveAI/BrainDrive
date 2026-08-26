import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { ensurePackagedAppWorkspace } from "./app-workspace-resources.js";

describe("packaged app workspace resources", () => {
  it("mounts package resources once without overwriting owner edits", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "app-workspace-resources-"));
    const packageRoot = path.join(root, "package");
    const memoryRoot = path.join(root, "memory");
    const sourcePath = path.join(packageRoot, "AGENT.md");
    const targetPath = "apps/example/AGENT.md";
    try {
      await mkdir(packageRoot, { recursive: true });
      await writeFile(sourcePath, "# Example App\n", { encoding: "utf8", flush: true });
      await ensurePackagedAppWorkspace(memoryRoot, {
        app_id: "org.example.app",
        resources: [{ source_path: sourcePath, target_path: targetPath }],
      });
      const mountedPath = path.join(memoryRoot, targetPath);
      await expect(readFile(mountedPath, "utf8")).resolves.toBe("# Example App\n");

      await writeFile(mountedPath, "# Owner edit\n", "utf8");
      await ensurePackagedAppWorkspace(memoryRoot, {
        app_id: "org.example.app",
        resources: [{ source_path: sourcePath, target_path: targetPath }],
      });
      await expect(readFile(mountedPath, "utf8")).resolves.toBe("# Owner edit\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
