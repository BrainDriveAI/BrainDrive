import { render, screen, waitFor } from "@testing-library/react";

import DocumentView, { stripFinanceTemplateScaffolding, stripYamlFrontmatter } from "./DocumentView";

const { readFileContentMock } = vi.hoisted(() => ({
  readFileContentMock: vi.fn(async () =>
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
}));

vi.mock("@/api/gateway-adapter", () => ({
  readFileContent: () => readFileContentMock(),
  writeFileContent: vi.fn(),
}));

describe("DocumentView", () => {
  beforeEach(() => {
    readFileContentMock.mockClear();
  });

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

  it("hides Finance template scaffolding from read mode", async () => {
    readFileContentMock.mockResolvedValueOnce([
      "# Finance Plan",
      "",
      "## Right Now - Your First Step",
      "",
      "*One thing the owner can do this week to make progress. Include step type, status, trace, rationale, and owner-facing next action.*",
      "",
      "- Gather credit card statement terms.",
    ].join("\n"));

    render(
      <DocumentView
        projectId="finance"
        projectName="Finance"
        file={{ name: "plan.md", path: "documents/finance/plan.md" }}
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByText("Gather credit card statement terms.")).toBeInTheDocument();
    expect(screen.queryByText(/Include step type/)).not.toBeInTheDocument();
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

describe("stripFinanceTemplateScaffolding", () => {
  it("removes known helper lines only for Finance spec and plan read views", () => {
    const content = [
      "## What You Want",
      "*The owner's confirmed financial goals as plan-usable statements, using the owner's words where possible. Include desired outcome, time horizon, concerns, and success criteria.*",
      "- Pay down debt.",
    ].join("\n");

    expect(stripFinanceTemplateScaffolding(content, "finance", "documents/finance/spec.md")).toBe("## What You Want\n- Pay down debt.");
    expect(stripFinanceTemplateScaffolding(content, "career", "documents/career/spec.md")).toContain("The owner's confirmed");
  });

  it("replaces stale active-plan placeholders in Finance Goals read mode", () => {
    const content = [
      "# Finance Spec",
      "**Status:** Interview complete - spec and plan active",
      "## The Plan",
      "Not captured yet.",
    ].join("\n\n");

    const rendered = stripFinanceTemplateScaffolding(content, "finance", "documents/finance/spec.md");

    expect(rendered).toContain("Plan active. See Your Plan for the current roadmap and first action.");
    expect(rendered).not.toContain("Not captured yet.");
  });

  it("softens directive Roth IRA wording in Finance Plan read mode", () => {
    const content = [
      "## Owner Decisions",
      "5. **Roth IRA boundary:** The Roth IRA is not a funding source. Contributions (which you can withdraw tax/penalty-free) stay invested. Earnings stay invested.",
    ].join("\n\n");

    const rendered = stripFinanceTemplateScaffolding(content, "finance", "documents/finance/plan.md");

    expect(rendered).toContain("This plan does not use the Roth IRA as a funding source");
    expect(rendered).toContain("separate owner decision with tax and retirement tradeoffs");
    expect(rendered).not.toMatch(/stay invested|tax\/penalty-free/i);
  });
});
