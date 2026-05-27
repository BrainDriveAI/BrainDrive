import path from "node:path";

import { describe, expect, it } from "vitest";

import { lintDraft3MemoryStarterPack } from "../tools/architecture-lint/draft3-memory-lint.js";

describe("Draft 3 starter-pack layout", () => {
  it("passes Draft 3 architecture lint", async () => {
    const starterPackRoot = path.resolve("memory", "starter-pack");
    const result = await lintDraft3MemoryStarterPack(starterPackRoot);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
