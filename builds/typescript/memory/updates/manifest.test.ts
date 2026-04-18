import { describe, expect, it } from "vitest";

import { ManifestParseError, parseUpdatesManifest } from "./manifest.js";

describe("updates manifest parser", () => {
  it("returns deterministic version-scoped items with source file paths", () => {
    const manifest = [
      "# Example Updates",
      "",
      "## Version 1.1.0",
      "### AI Briefing",
      "Apply baseline updates for the first cumulative release.",
      "",
      "### Item: Sync profile defaults",
      "- action: write preferences/default.local-dev.json -> preferences/default.json",
      "- action: write preferences/default.openrouter-secret-ref.json -> preferences/default.openrouter-secret-ref.json",
      "",
      "### Item: Remove deprecated note",
      "- action: delete me/deprecated-note.md",
      "",
      "## Version 1.2.0",
      "### AI Briefing",
      "Layer in a follow-up update.",
      "",
      "### Item: Sync version metadata",
      "- action: write system/version.json -> system/version.json",
      "",
    ].join("\n");

    const parsedFirst = parseUpdatesManifest(manifest);
    const parsedSecond = parseUpdatesManifest(manifest);

    expect(parsedFirst.versions).toHaveLength(2);
    expect(parsedFirst.items).toHaveLength(3);
    expect(parsedFirst.items[0]?.id).toBe(parsedSecond.items[0]?.id);
    expect(parsedFirst.items[1]?.id).toBe(parsedSecond.items[1]?.id);
    expect(parsedFirst.items[0]?.source_file_paths).toEqual([
      "preferences/default.local-dev.json",
      "preferences/default.openrouter-secret-ref.json",
    ]);
    expect(parsedFirst.items[1]?.source_file_paths).toEqual([]);
    expect(parsedFirst.items[0]?.version).toBe("1.1.0");
    expect(parsedFirst.items[2]?.version).toBe("1.2.0");
    expect(parsedFirst.versions[0]?.ai_briefing).toContain("first cumulative release");
  });

  it("rejects malformed input with a safe parse error", () => {
    const malformed = [
      "## Version 1.1.0",
      "### AI Briefing",
      "Missing action details should fail.",
      "",
      "### Item: Broken entry",
      "- depends_on: 1.0.0:seed:abc123",
    ].join("\n");

    expect(() => parseUpdatesManifest(malformed)).toThrow(ManifestParseError);
  });
});
