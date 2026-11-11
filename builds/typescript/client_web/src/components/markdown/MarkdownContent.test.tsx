import { render, screen } from "@testing-library/react";

import MarkdownContent from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders markdown headings, paragraphs, lists, tables, links, checklists, and long sections", () => {
    const longParagraph = "Readable section content. ".repeat(30);
    const content = `# Owner goals

A paragraph with **important context**.

- First item
- Second item

| Goal | Status |
| --- | --- |
| Walk | Active |

[Open the plan](https://example.test/plan)

- [x] Read the page
- [ ] Review the next step

${longParagraph}`;

    const { container } = render(<MarkdownContent content={content} />);

    expect(screen.getByRole("heading", { level: 1, name: "Owner goals" })).toBeInTheDocument();
    expect(screen.getByText("First item")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the plan" })).toHaveAttribute(
      "href",
      "https://example.test/plan"
    );
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(container.textContent).toContain("Readable section content.");
    expect(container.textContent).not.toContain("| Goal | Status |");
  });
});
