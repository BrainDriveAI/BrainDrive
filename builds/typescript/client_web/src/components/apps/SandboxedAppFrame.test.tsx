import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";

import { closeResumeBuilderSession } from "@/api/apps-adapter";
import SandboxedAppFrame, { isModelSettingsAction, isTrustedSandboxMessage, saveHostPdfExport, saveHostResumeExport } from "./SandboxedAppFrame";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

vi.mock("@/api/apps-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/apps-adapter")>("@/api/apps-adapter");
  return { ...actual, closeResumeBuilderSession: vi.fn(async () => undefined), sendResumeBuilderBridgeMessage: vi.fn(async () => ({ status: "ready" })), callResumeBuilderCapability: vi.fn(async () => ({ result: {} })), finalizeResumeBuilderExport: vi.fn(async (input: { safe_destination_label: string; outcome: string }) => ({ receipt_revision_id: crypto.randomUUID(), safe_destination_label: input.safe_destination_label, outcome: input.outcome })) };
});

const launch = {
  launch_version: 1 as const, session_id: crypto.randomUUID(), installation_id: crypto.randomUUID(), view_id: crypto.randomUUID(), operation_id: crypto.randomUUID(),
  bridge_generation: 1, resumed: false,
  bridge_token_id: crypto.randomUUID(), server_id: crypto.randomUUID(), expires_at: "2030-01-01T00:00:00.000Z",
  protocol: { core: "2026-07-28", apps_extension: "2026-01-26", server_name: "fixture", server_version: "3.0.0" },
  resource: { uri: "ui://resume-builder/main", mime_type: "text/html;profile=mcp-app" as const, content_digest: `sha256:${"a".repeat(64)}`, size_bytes: 32, html: "<!doctype html><main>Fixture</main>" },
  allowed_tools: ["fixture.status"],
  allowed_capabilities: ["career.context.read", "career.facts.confirm", "resume.definitions.write", "resume.export.request"],
  entry_point: "direct" as const,
};

describe("sandboxed MCP App frame", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grants scripts only, denies same-origin/navigation/download/device authority, and closes on unmount", async () => {
    const rendered = render(<SandboxedAppFrame launch={launch} onSessionClosed={() => {}} />);
    const frame = screen.getByTitle("Resume Builder sandbox proxy");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-downloads");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame.getAttribute("allow")).toContain("camera 'none'");
    expect(frame).not.toHaveAttribute("srcdoc");
    expect(frame.getAttribute("src")).toMatch(/^data:text\/html/);
    const proxyHtml = decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!);
    expect(proxyHtml).toContain('view.setAttribute("sandbox","allow-scripts")');
    expect(proxyHtml).not.toContain(launch.session_id);
    expect(proxyHtml).not.toContain(launch.installation_id);
    expect(proxyHtml).not.toContain(launch.bridge_token_id);
    expect(proxyHtml).not.toContain(launch.resource.html);
    rendered.unmount();
    await waitFor(() => expect(closeResumeBuilderSession).toHaveBeenCalledWith(launch.session_id));
  });

  it("does not revoke the session during React strict-mode effect replay", async () => {
    const rendered = render(<StrictMode><SandboxedAppFrame launch={launch} onSessionClosed={() => {}} /></StrictMode>);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closeResumeBuilderSession).not.toHaveBeenCalled();
    rendered.unmount();
    await waitFor(() => expect(closeResumeBuilderSession).toHaveBeenCalledTimes(1));
  });

  it("requires both the exact iframe window and opaque sandbox origin", () => {
    const contentWindow = {} as Window;
    const frame = { contentWindow } as HTMLIFrameElement;
    expect(isTrustedSandboxMessage({ source: contentWindow, origin: "null" } as unknown as MessageEvent, frame)).toBe(true);
    expect(isTrustedSandboxMessage({ source: window, origin: "null" } as unknown as MessageEvent, frame)).toBe(false);
    expect(isTrustedSandboxMessage({ source: contentWindow, origin: "https://host.invalid" } as unknown as MessageEvent, frame)).toBe(false);
  });

  it("allowlists only the existing model-settings recovery action", () => {
    expect(isModelSettingsAction("navigate_settings", "models")).toBe(true);
    expect(isModelSettingsAction("navigate_settings", "providers/new")).toBe(false);
    expect(isModelSettingsAction("open_link", "models")).toBe(false);
  });

  it("validates browser export bytes and returns only a safe receipt projection to the app", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const projected = await saveHostPdfExport({ filename: "resume.pdf", mime_type: "application/pdf", bytes_base64: btoa("%PDF-1.4"), safe_destination_label: "resume.pdf", definition: { kind: "general" }, parse_back: "passed", artifact_revision_id: crypto.randomUUID() });
    expect(projected).toEqual({ safe_destination_label: "resume.pdf", definition: { kind: "general" }, parse_back: "passed" });
    expect(JSON.stringify(projected)).not.toContain("bytes_base64");
    expect(click).toHaveBeenCalled();
    create.mockRestore(); revoke.mockRestore(); click.mockRestore();
  });

  it("downloads only strict UTF-8 text with a .txt label and keeps bytes and paths out of the projection", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-text");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const payload = btoa(String.fromCharCode(...new TextEncoder().encode("Zoë 李\nExperience\n")));
    await expect(saveHostResumeExport({ filename: "resume.txt", mime_type: "text/plain", bytes_base64: payload, safe_destination_label: "resume.txt", definition: { kind: "general" }, parse_back: "passed" }))
      .resolves.toEqual({ safe_destination_label: "resume.txt", definition: { kind: "general" }, parse_back: "passed" });
    await expect(saveHostResumeExport({ filename: "resume.pdf", mime_type: "text/plain", bytes_base64: payload, safe_destination_label: "resume.pdf" })).rejects.toThrow("invalid_export_result");
    await expect(saveHostResumeExport({ filename: "resume.txt", mime_type: "text/plain", bytes_base64: btoa("safe\0text"), safe_destination_label: "resume.txt" })).rejects.toThrow("invalid_export_result");
    await expect(saveHostResumeExport({ filename: "resume.txt", mime_type: "text/plain", bytes_base64: btoa(String.fromCharCode(0xc3, 0x28)), safe_destination_label: "resume.txt" })).rejects.toThrow("invalid_export_result");
    create.mockRestore(); revoke.mockRestore(); click.mockRestore();
  });

  it("uses the native host chooser in Tauri, keeps the raw path opaque, and reports cancellation", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invokeMock.mockResolvedValueOnce({ outcome: "completed", safeDestinationLabel: "chosen-resume.pdf" });
    await expect(saveHostPdfExport({ filename: "resume.pdf", mime_type: "application/pdf", bytes_base64: btoa("%PDF-1.4"), safe_destination_label: "resume.pdf", definition: { kind: "general" }, parse_back: "passed" }))
      .resolves.toEqual({ safe_destination_label: "chosen-resume.pdf", definition: { kind: "general" }, parse_back: "passed" });
    expect(invokeMock).toHaveBeenCalledWith("save_resume_export", { request: { safeFilename: "resume.pdf", mimeType: "application/pdf", bytesBase64: btoa("%PDF-1.4") } });
    invokeMock.mockResolvedValueOnce({ outcome: "cancelled", safeDestinationLabel: "resume.pdf" });
    await expect(saveHostPdfExport({ filename: "resume.pdf", mime_type: "application/pdf", bytes_base64: btoa("%PDF-1.4"), safe_destination_label: "resume.pdf" })).rejects.toThrow("cancelled");
    delete window.__TAURI_INTERNALS__;
  });
});
