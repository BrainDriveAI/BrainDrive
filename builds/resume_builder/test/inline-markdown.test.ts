import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseInlineMarkdown } from "../src/inline-markdown.js";

describe("shared paper/PDF inline grammar", () => {
  it("keeps the standalone shipped parser identical to the canonical source", () => {
    expect(() => execFileSync(process.execPath, ["scripts/sync-inline-markdown.mjs", "--check"]))
      .not.toThrow();
  });

  it.each([
    ["_first_last@x.com_", "first_last@x.com", false],
    ["__first_last@x.com__", "first_last@x.com", true],
    ["___first_last@x.com___", "first_last@x.com", true],
    ["**_first_last@x.com_**", "first_last@x.com", true],
    ["first_last@x.com", "first_last@x.com", false],
    ["snake_case", "snake_case", false],
    ["`__first_last@x.com__`", "__first_last@x.com__", false],
    [String.raw`\_first_last@x.com\_`, "_first_last@x.com_", false],
    ["__https://x.com/_private_/first_last__", "https://x.com/_private_/first_last", true],
    ["C* and unmatched _", "C* and unmatched _", false],
  ] as const)("preserves text and strong styling for %s", (markdown, text, bold) => {
    expect(parseInlineMarkdown(markdown)).toEqual([{ text, bold }]);
  });
});
