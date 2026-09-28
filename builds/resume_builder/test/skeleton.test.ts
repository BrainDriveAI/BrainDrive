import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTRACT_BINDING, RESUME_BUILDER_PACKAGE_ID, RUNTIME_ENABLED } from "../src/index.js";

describe("Resume Builder package boundary", () => {
  it("binds the accepted contract versions and declares its app-owned runtime", () => {
    expect(RESUME_BUILDER_PACKAGE_ID).toBe("ai.braindrive.resume-builder");
    expect(CONTRACT_BINDING).toEqual({
      appContractSchemaVersion: 1,
      resumeDataSchemaVersion: 3,
      resumeInferenceSchemaVersion: 1,
      appBridgeSchemaVersion: 1,
    });
    expect(RUNTIME_ENABLED).toBe(true);
  });

  it("ships its inference program as an app-owned runtime resource", async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      braindrive: { runtimeEnabled: boolean };
    };
    expect(packageJson.scripts).toEqual({ test: "vitest run", build: "tsc -p tsconfig.json" });
    expect(packageJson.braindrive.resumeDataSchemaVersion).toBe(3);
    expect(packageJson.braindrive.runtimeEnabled).toBe(true);
    const program = await readFile(resolve(process.cwd(), "resources/inference-program.js"), "utf8");
    expect(program).toContain('id: "resume.general-draft"');
    expect(program).toContain('id: "resume.interview-assist"');
    expect(program).toContain('id: "resume.craft-repair"');
    expect(program).toContain("prepareResumeInference");
    expect(program).toContain("adjudicateResumeInference");
    expect(program).not.toContain("BrainDrive Resume Builder structured proposal component");
  });
});
