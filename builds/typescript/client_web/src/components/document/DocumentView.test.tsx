import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as gateway from "@/api/gateway-adapter";
import DocumentView from "./DocumentView";

vi.mock("@/api/gateway-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/gateway-adapter")>("@/api/gateway-adapter");
  return { ...actual, readFileContent: vi.fn(), writeFileContent: vi.fn() };
});

describe("DocumentView published documents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

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
          quality: { state: "owner_approved", label: "Owner approved" },
        }}
        onBack={() => undefined}
      />
    );

    expect((await screen.findAllByRole("heading", { name: "General Resume", level: 1 })).length).toBeGreaterThan(0);
    expect(screen.getByText("Published by Resume Builder")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Resume quality status: Owner approved" })).toHaveTextContent("Owner approved");
    expect(screen.getByText("Approved content.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByText(/quality state:/i)).not.toBeInTheDocument();
  });

  it("restores unsaved normal project edits after the document view remounts", async () => {
    vi.mocked(gateway.readFileContent)
      .mockResolvedValueOnce("# Saved\n")
      .mockResolvedValueOnce("# Saved\n")
      .mockResolvedValueOnce("# Draft\n");
    vi.mocked(gateway.writeFileContent).mockResolvedValue();
    const file = {
      name: "plan.md",
      path: "documents/career/plan.md",
      readOnly: false,
    };
    const user = userEvent.setup();

    const first = render(
      <DocumentView
        projectId="career"
        projectName="Career"
        file={file}
        onBack={() => undefined}
      />
    );

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const firstEditor = screen.getByRole("textbox");
    await user.clear(firstEditor);
    await user.type(firstEditor, "# Draft\n");

    first.unmount();

    render(
      <DocumentView
        projectId="career"
        projectName="Career"
        file={file}
        onBack={() => undefined}
      />
    );

    expect(await screen.findByRole("textbox")).toHaveValue("# Draft\n");
    expect(screen.getByText(/Unsaved changes were restored/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(gateway.writeFileContent).toHaveBeenCalledWith("career", "documents/career/plan.md", "# Draft\n");
    expect(window.sessionStorage.getItem("braindrive:document-draft:career:documents/career/plan.md")).toBeNull();
    expect(await screen.findByText("Saved plan.md.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });
});
