import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { commitMemoryChange, ensureGitReady } from "../git.js";

export type AppWorkspaceResource = {
  readonly source_path: string;
  readonly target_path: string;
};

export type AppWorkspacePackage = {
  readonly app_id: string;
  readonly resources: readonly AppWorkspaceResource[];
};

export async function ensurePackagedAppWorkspace(
  memoryRoot: string,
  app: AppWorkspacePackage,
): Promise<void> {
  let created = false;
  for (const resource of app.resources) {
    const target = resolveWithin(memoryRoot, resource.target_path);
    const content = await readFile(resource.source_path, "utf8");
    try {
      await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      created = true;
    }
  }
  if (created) {
    await ensureGitReady(memoryRoot);
    await commitMemoryChange(memoryRoot, `Initialize ${app.app_id} workspace`);
  }
}

function resolveWithin(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`App workspace resource escapes owner memory: ${relativePath}`);
  }
  return target;
}
