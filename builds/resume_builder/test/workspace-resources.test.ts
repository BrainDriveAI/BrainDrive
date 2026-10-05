import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../resources/workspace/", import.meta.url));

describe("Resume Builder workspace package", () => {
  it("ships its own instructions, interview guide, and document templates", async () => {
    const manifest = JSON.parse(await readFile(path.join(workspaceRoot, "workspace.json"), "utf8")) as {
      workspace_root: string;
      resources: string[];
    };

    expect(manifest.workspace_root).toBe("apps/resume-builder");
    expect(manifest.resources).toEqual(["AGENT.md", "run-interview.md", "resume-profile.md", "resume.md"]);

    const agent = await readFile(path.join(workspaceRoot, "AGENT.md"), "utf8");
    expect(agent).toContain("expert career coach and resume-writing partner");
    expect(agent).toContain("must not add a responsibility, outcome, scope, title");
    await expect(readFile(path.join(workspaceRoot, "run-interview.md"), "utf8")).resolves.toContain("natural conversation");
    await expect(readFile(path.join(workspaceRoot, "resume-profile.md"), "utf8")).resolves.toContain("# Resume Profile");
    await expect(readFile(path.join(workspaceRoot, "resume.md"), "utf8")).resolves.toContain("# Resume");
  });
});
