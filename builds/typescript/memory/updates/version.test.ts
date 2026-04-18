import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import { describe, expect, it } from "vitest";

import { compareVersionTuples, loadVersionMetadata, versionsMatch } from "./version.js";

describe("version metadata", () => {
  it("loads stable metadata and canonicalizes version strings", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-version-stable-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "system"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "system", "version.json"),
        `${JSON.stringify({
          version: "  v26.4.18 ",
          released: " 2026-04-18T12:00:00Z ",
          channel: " stable ",
        }, null, 2)}\n`,
        "utf8"
      );

      const metadata = await loadVersionMetadata(memoryRoot);
      expect(metadata).toEqual({
        version: "26.4.18",
        released: "2026-04-18T12:00:00Z",
        channel: "stable",
      });
      expect(compareVersionTuples("  v26.4.18 ", "26.4.18")).toBe(0);
      expect(versionsMatch(" v26.4.18 ", "26.4.18")).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("loads dev metadata and compares numeric version tuples", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-version-dev-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "system"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "system", "version.json"),
        `${JSON.stringify({
          version: "v26.4.18.3",
          released: "2026-04-18T15:30:00Z",
          channel: "dev",
        }, null, 2)}\n`,
        "utf8"
      );

      const metadata = await loadVersionMetadata(memoryRoot);
      expect(metadata).toEqual({
        version: "26.4.18.3",
        released: "2026-04-18T15:30:00Z",
        channel: "dev",
      });
      expect(compareVersionTuples(metadata?.version ?? "", "26.4.18")).toBe(1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns a safe non-match when versions are unparsable", () => {
    expect(compareVersionTuples("release-26.4.18", "26.4.18")).toBeNull();
    expect(compareVersionTuples("26.4.beta", "26.4.0")).toBeNull();
    expect(versionsMatch("release-26.4.18", "26.4.18")).toBe(false);
  });
});
