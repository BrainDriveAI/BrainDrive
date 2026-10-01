import { describe, expect, it } from "vitest";
import { parsePaperInlineMarkdown } from "./paper-inline-markdown";

describe("paper inline email emphasis", () => {
  it.each([
    ["_first_last@x.com_", false],
    ["__first_last@x.com__", true],
    ["___first_last@x.com___", true],
    ["*first_last@x.com*", false],
    ["**first_last@x.com**", true],
    ["first_last@x.com", false],
    ["`first_last@x.com`", false],
  ])("renders %s with intact intraword underscores", (markdown, bold) => {
    expect(parsePaperInlineMarkdown(markdown as string)).toEqual([{ text: "first_last@x.com", bold }]);
  });

  it("preserves literal email delimiters in code", () => {
    expect(parsePaperInlineMarkdown("`__first_last@x.com__` and snake_case"))
      .toEqual([{ text: "__first_last@x.com__ and snake_case", bold: false }]);
  });
});
