import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as appsApi from "@/api/apps-adapter";
import AppsPage from "./AppsPage";

vi.mock("@/api/apps-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/apps-adapter")>("@/api/apps-adapter");
  return { ...actual, getResumeBuilderApp: vi.fn(), mutateResumeBuilderApp: vi.fn(), launchResumeBuilderApp: vi.fn(), closeResumeBuilderSession: vi.fn(), sendResumeBuilderBridgeMessage: vi.fn(), callResumeBuilderCapability: vi.fn() };
});

const base = {
  contract_version: 1 as const, app_id: "ai.braindrive.resume-builder" as const, display_name: "Resume Builder" as const,
  publisher: "BrainDrive" as const, state: "not_installed" as const, generation: 0, installation_id: null,
  package_version: null, available_version: "3.0.0", capabilities: ["career.context.read", "app.inference.request"],
  inference_disclosure: "Uses your active compatible BrainDrive model without sharing credentials.",
  storage_disclosure: "Default uninstall preserves owner resume data.", retained_owner_data: true as const,
  updated_at: "2026-08-07T00:00:00.000Z",
};

const launch = {
  launch_version: 1 as const, session_id: crypto.randomUUID(), installation_id: crypto.randomUUID(), view_id: crypto.randomUUID(), operation_id: crypto.randomUUID(),
  bridge_token_id: crypto.randomUUID(), server_id: crypto.randomUUID(), expires_at: "2030-01-01T00:00:00.000Z",
  protocol: { core: "2026-07-28", apps_extension: "2026-01-26", server_name: "fixture", server_version: "3.0.0" },
  resource: { uri: "ui://resume-builder/main", mime_type: "text/html;profile=mcp-app" as const, content_digest: `sha256:${"a".repeat(64)}`, size_bytes: 32, html: "<!doctype html><main>Fixture</main>" },
  allowed_tools: ["fixture.status"],
  allowed_capabilities: ["career.context.read"],
  entry_point: "direct" as const,
};

describe("minimal Apps surface", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows identity, readable state, disclosures, capabilities, and installs from one control", async () => {
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(base);
    vi.mocked(appsApi.mutateResumeBuilderApp).mockResolvedValue({ ...base, state: "active", generation: 1, installation_id: crypto.randomUUID(), package_version: "3.0.0" });
    const user = userEvent.setup(); render(<AppsPage />);
    expect(await screen.findByRole("heading", { name: "Resume Builder" })).toBeInTheDocument();
    expect(screen.getByText("Not installed")).toBeInTheDocument();
    expect(screen.getByText("career.context.read")).toBeInTheDocument();
    expect(screen.getByText(/without sharing credentials/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Install Resume Builder" }));
    expect(appsApi.mutateResumeBuilderApp).toHaveBeenCalledWith("install");
    expect(await screen.findByText("Active and ready")).toBeInTheDocument();
  });

  it("shows disabled state without relying on color and exposes recovery controls", async () => {
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue({ ...base, state: "disabled", generation: 2, installation_id: crypto.randomUUID(), package_version: "3.0.0" });
    render(<AppsPage />);
    expect(await screen.findByText("Disabled — your saved data is retained")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeInTheDocument();
  });

  it("uses a single-column control surface at the base layout with responsive enhancement classes", async () => {
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue(base);
    render(<AppsPage />);
    const page = await screen.findByTestId("apps-page");
    expect(page).toHaveClass("px-4");
    expect(page.querySelector(".sm\\:grid-cols-2")).toBeInTheDocument();
  });

  it("returns keyboard focus to Launch after the sandbox session closes", async () => {
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue({ ...base, state: "active", generation: 1, installation_id: crypto.randomUUID(), package_version: "3.0.0" });
    vi.mocked(appsApi.launchResumeBuilderApp).mockResolvedValue(launch);
    const user = userEvent.setup();
    render(<AppsPage />);
    const launchButton = await screen.findByRole("button", { name: "Launch" });
    await user.click(launchButton);
    expect(await screen.findByTitle("Resume Builder")).toHaveAttribute("sandbox", "allow-scripts");
    await user.click(screen.getByRole("button", { name: "Close app" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toHaveFocus());
  });

  it("preserves a Career-originated launch instead of starting blank", async () => {
    vi.mocked(appsApi.getResumeBuilderApp).mockResolvedValue({ ...base, state: "active", generation: 1, installation_id: crypto.randomUUID(), package_version: "3.0.0" });
    vi.mocked(appsApi.launchResumeBuilderApp).mockResolvedValue({ ...launch, entry_point: "career" });
    const user = userEvent.setup();
    render(<AppsPage entryPoint="career" />);
    await user.click(await screen.findByRole("button", { name: "Continue from Career" }));
    expect(appsApi.launchResumeBuilderApp).toHaveBeenCalledWith("career");
  });
});
