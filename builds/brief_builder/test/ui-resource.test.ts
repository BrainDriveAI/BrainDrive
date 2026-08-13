import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Brief Builder primary resource", () => {
  it("is one sandbox-safe, direct-entry, accessible screen", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("<title>Brief Builder</title>");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('for="source"');
    expect(html).toContain("Review and approve in BrainDrive");
    expect(html).toContain("Reject this draft");
    expect(html).toContain("The draft was rejected. Your prior approved revision is unchanged.");
    expect(html).toContain('rpcRequest("ui/initialize"');
    expect(html).toContain('rpcNotify("ui/notifications/initialized"');
    expect(html).toContain("crypto.getRandomValues");
    expect(html).not.toContain("crypto.randomUUID");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("Career");
    expect(html).not.toContain("resume");
  });

  it("declares only the accepted package identity and surface", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson).toMatchObject({ name: "@braindrive/brief-builder", braindrive: { appId: "ai.braindrive.brief-builder", routeKey: "brief-builder", primaryResource: "ui://brief-builder/main", inferencePurpose: "brief.generate@1" } });
  });
});
