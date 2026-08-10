import { render, screen } from "@testing-library/react";

import * as gateway from "@/api/gateway-adapter";
import DocumentView from "./DocumentView";

vi.mock("@/api/gateway-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/gateway-adapter")>("@/api/gateway-adapter");
  return { ...actual, readFileContent: vi.fn(), writeFileContent: vi.fn() };
});

describe("DocumentView published documents", () => {
  it("renders app-published Markdown through the normal viewer without offering edits", async () => {
    vi.mocked(gateway.readFileContent).mockResolvedValue("# General Resume\n\nApproved content.");
    render(
      <DocumentView
        projectId="career"
        projectName="Career"
        file={{
          name: "published/ai.braindrive.resume-builder/general-resume.md",
          path: "documents/career/published/ai.braindrive.resume-builder/general-resume.md",
          readOnly: true,
          sourceLabel: "Resume Builder",
          sourceType: "app_published",
        }}
        onBack={() => undefined}
      />
    );

    expect((await screen.findAllByRole("heading", { name: "General Resume", level: 1 })).length).toBeGreaterThan(0);
    expect(screen.getByText("Published by Resume Builder")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
