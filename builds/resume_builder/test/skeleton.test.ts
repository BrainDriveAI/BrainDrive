import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTRACT_BINDING, RESUME_BUILDER_PACKAGE_ID, RUNTIME_ENABLED } from "../src/index.js";

describe("Resume Builder Milestone 1 package skeleton", () => {
  it("binds the accepted contract versions without enabling runtime behavior", () => {
    expect(RESUME_BUILDER_PACKAGE_ID).toBe("ai.braindrive.resume-builder");
    expect(CONTRACT_BINDING).toEqual({
      appContractSchemaVersion: 1,
      resumeDataSchemaVersion: 2,
      resumeInferenceSchemaVersion: 1,
      appBridgeSchemaVersion: 1,
    });
    expect(RUNTIME_ENABLED).toBe(false);
  });

  it("has no runtime execution scripts", async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      braindrive: { runtimeEnabled: boolean };
    };
    expect(packageJson.scripts).toEqual({ test: "vitest run", build: "tsc -p tsconfig.json" });
    expect(packageJson.braindrive.resumeDataSchemaVersion).toBe(2);
    expect(packageJson.braindrive.runtimeEnabled).toBe(false);
  });
});
