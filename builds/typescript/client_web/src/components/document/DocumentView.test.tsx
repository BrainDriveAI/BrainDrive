import { render, screen, waitFor } from "@testing-library/react";

import DocumentView, { stripYamlFrontmatter } from "./DocumentView";

vi.mock("@/api/gateway-adapter", () => ({
  readFileContent: vi.fn(async () =>
    [
      "---",
      'title: "HarborlineInvestments RothIRA 2026 04"',
      "source_filename: HarborlineInvestments_RothIRA_2026-04.pdf",
      'conversion: "ai_pdf_to_markdown"',
      "---",
      "",
      "# Harborline Roth IRA",
      "",
      "Statement body.",
      "",
    ].join("\n")
  ),
  writeFileContent: vi.fn(),
}));

describe("DocumentView", () => {
  it("uses owner-facing headings for Finance goals and plan", async () => {
    const { rerender } = render(
      <DocumentView
        projectId="finance"
        projectName="Finance"
        file={{ name: "spec.md", path: "documents/finance/spec.md" }}
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByRole("heading", { name: "Your Goals" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "spec.md" })).not.toBeInTheDocument();

    rerender(
      <DocumentView
        projectId="finance"
        projectName="Finance"
        file={{ name: "plan.md", path: "documents/finance/plan.md" }}
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByRole("heading", { name: "Your Plan" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "plan.md" })).not.toBeInTheDocument();
  });

  it("hides raw frontmatter in read mode", async () => {
    render(
      <DocumentView
        projectId="finance"
        projectName="Finance"
        file={{ name: "harborlineinvestments-rothira-2026-04.md", path: "documents/finance/harborlineinvestments-rothira-2026-04.md" }}
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByRole("heading", { name: "Harborline Roth IRA" })).toBeInTheDocument();
    expect(screen.getByText("Statement body.")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText(/source_filename/)).not.toBeInTheDocument();
      expect(screen.queryByText(/ai_pdf_to_markdown/)).not.toBeInTheDocument();
    });
  });
});

describe("stripYamlFrontmatter", () => {
  it("removes a leading YAML frontmatter block and preserves body markdown", () => {
    expect(stripYamlFrontmatter("---\ntitle: Test\n---\n\n# Body\n")).toBe("# Body\n");
  });

  it("leaves ordinary markdown unchanged", () => {
    expect(stripYamlFrontmatter("# Body\n\n---\n")).toBe("# Body\n\n---\n");
  });
});
