import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Docker development Resume Builder package boundary", () => {
  it("mounts the separately buildable package read-only for the enabled fixture", async () => {
    const compose = await readFile(
      resolve(process.cwd(), "../../installer/docker/compose.dev.yml"),
      "utf8",
    );

    expect(compose).toContain("../../builds/resume_builder:/app/resume_builder:ro");
  });

  it("keeps the documented support bundle executable and path-redacted", async () => {
    const scriptPath = resolve(
      process.cwd(),
      "../../installer/docker/scripts/support-bundle.sh",
    );
    const [script, metadata] = await Promise.all([
      readFile(scriptPath, "utf8"),
      stat(scriptPath),
    ]);

    expect(script.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    if (process.platform !== "win32") expect(metadata.mode & 0o111).not.toBe(0);
    expect(script).not.toContain("compose-config-rendered.txt");
    for (const replacement of [
      "[MEMORY_ROOT]",
      "[APP_STATE_ROOT]",
      "[SECRETS_ROOT]",
      "[HOST_PATH]",
    ]) {
      expect(script).toContain(replacement);
    }
  });
});
