import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Docker development first-party app package boundary", () => {
  it("mounts both separately buildable packages read-only for the enabled fixtures", async () => {
    const compose = await readFile(
      resolve(process.cwd(), "../../installer/docker/compose.dev.yml"),
      "utf8",
    );

    expect(compose).toContain("../../builds/resume_builder:/app/resume_builder:ro");
    expect(compose).toContain("../../builds/brief_builder:/app/brief_builder:ro");
  });

  it("selects the Docker adapter without publishing an app endpoint, Docker socket, host secret, or extra privilege", async () => {
    const compose = await readFile(resolve(process.cwd(), "../../installer/docker/compose.dev.yml"), "utf8");
    const appService = compose.slice(compose.indexOf("  app:"), compose.indexOf("\n  web:"));

    expect(appService).toContain("BRAINDRIVE_APP_PLATFORM_TARGET: docker_linux_x64");
    expect(appService).toContain("no-new-privileges:true");
    expect(appService).not.toMatch(/^\s{4}ports:/m);
    expect(appService).not.toMatch(/docker\.sock|BRAINDRIVE_APP_CONNECTION_TOKEN|BRAINDRIVE_ENDPOINT_BIND/);
    expect(appService).not.toMatch(/\/home\/|\/Users\/|[A-Za-z]:\\/);
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
