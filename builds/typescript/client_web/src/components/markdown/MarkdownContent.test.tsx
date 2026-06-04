import { render, screen } from "@testing-library/react";

import MarkdownContent from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders tables without exposing synthetic pipe markers in owner-visible text", () => {
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
    expect(extracted).toContain("Date");
    expect(extracted).toContain("Unclear Merchant");
    expect(extracted).toContain("MJP Services");
    expect(extracted).not.toContain("Date |");
    expect(extracted).not.toContain("Unclear Merchant |");
  });
});
