import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("installed-app inference architecture boundary", () => {
  it("keeps app-specific inference fixtures out of the production gateway", async () => {
    const source = await readFile(new URL("./server.ts", import.meta.url), "utf8");

    expect(source).not.toContain("resume-inference/e2e-fixture");
    expect(source).not.toContain("BRAINDRIVE_E2E_RESUME_INFERENCE_FIXTURE");
  });

  it("keeps generic safe-recovery filters free of Resume-specific field names", async () => {
    const sources = await Promise.all([
      readFile(new URL("../app-platform/mcp-host/routes.ts", import.meta.url), "utf8"),
      readFile(new URL("../client_web/src/api/apps-adapter.ts", import.meta.url), "utf8"),
    ]);

    for (const source of sources) {
      const forbiddenFilter = source.match(/const FORBIDDEN_RECOVERY_KEY = \/[^\n]+/i)?.[0] ?? "";
      expect(forbiddenFilter).not.toMatch(/(?:\||\()resume(?:\||\))/i);
      expect(forbiddenFilter).not.toContain("job_description");
    }
  });
});
