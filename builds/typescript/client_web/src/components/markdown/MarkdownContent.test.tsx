import { render, screen } from "@testing-library/react";

import MarkdownContent from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("preserves readable separators for table text extraction", () => {
    render(
      <MarkdownContent
        content={[
          "| Date | Unclear Merchant | Amount | Action Needed |",
          "|---|---|---:|---|",
          "| 2026-03-29 | MJP Services | $184.00 | Categorize |",
        ].join("\n")}
      />
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    const extracted = document.body.textContent ?? "";
    expect(extracted).toContain("Date | Unclear Merchant");
    expect(extracted).not.toContain("DateUnclear");
  });
});
