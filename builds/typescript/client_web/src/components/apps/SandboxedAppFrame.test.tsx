import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, StrictMode } from "react";

import { AppCapabilityError, callAppCapability, callInternetSearchCapability, closeAppSession, discoverInternetSearchCapability } from "@/api/apps-adapter";
import { APPS_PROTOCOL_VERSION, BRIDGE_CHANNEL } from "@/mcp-apps/bridge";
import SandboxedAppFrame, { applyGroupedFactDecisions, isModelSettingsAction, isTrustedSandboxMessage, ownerFactConfirmationDetail, saveHostPdfExport, saveHostResumeExport } from "./SandboxedAppFrame";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

vi.mock("@/api/apps-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/apps-adapter")>("@/api/apps-adapter");
  return { ...actual, closeAppSession: vi.fn(async () => undefined), sendAppBridgeMessage: vi.fn(async () => ({ status: "ready" })), sendAppAppsBridgeMessage: vi.fn(async () => ({ result: {} })), callAppCapability: vi.fn(async () => ({ result: {} })), discoverInternetSearchCapability: vi.fn(async () => ({ discovery_version: 1, operation_id: "web.search@1", state: "available", callable: true })), callInternetSearchCapability: vi.fn(async () => ({ capability: "web.search", version: 1, status: "success", results: [] })), finalizeResumeBuilderExport: vi.fn(async (input: { safe_destination_label: string; outcome: string }) => ({ receipt_revision_id: crypto.randomUUID(), safe_destination_label: input.safe_destination_label, outcome: input.outcome })) };
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
    const rendered = render(<SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={launch} onSessionClosed={() => {}} />);
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
    await waitFor(() => expect(closeAppSession).toHaveBeenCalledWith("resume-builder", launch.session_id));
  });

  it("does not revoke the session during React strict-mode effect replay", async () => {
    const rendered = render(<StrictMode><SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={launch} onSessionClosed={() => {}} /></StrictMode>);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closeAppSession).not.toHaveBeenCalled();
    rendered.unmount();
    await waitFor(() => expect(closeAppSession).toHaveBeenCalledTimes(1));
  });

  it("keeps the live app session when the BrainDrive document is temporarily hidden", async () => {
    const onSessionClosed = vi.fn();
    const rendered = render(<SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={launch} onSessionClosed={onSessionClosed} />);
    const visibilityState = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    try {
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => { await Promise.resolve(); });

      expect(closeAppSession).not.toHaveBeenCalled();
      expect(onSessionClosed).not.toHaveBeenCalled();
    } finally {
      visibilityState.mockRestore();
      rendered.unmount();
    }

    await waitFor(() => expect(closeAppSession).toHaveBeenCalledWith("resume-builder", launch.session_id));
  });

  it("does not recreate the sandbox bridge when host callback identities change", async () => {
    const rendered = render(<SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={launch} onSessionClosed={() => {}} onOpenSettings={() => {}} />);
    const initialSource = screen.getByTitle("Resume Builder sandbox proxy").getAttribute("src");

    rendered.rerender(<SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={launch} onSessionClosed={() => {}} onOpenSettings={() => {}} />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTitle("Resume Builder sandbox proxy")).toHaveAttribute("src", initialSource);
    expect(closeAppSession).not.toHaveBeenCalled();

    rendered.unmount();
    await waitFor(() => expect(closeAppSession).toHaveBeenCalledTimes(1));
  });

  it("uses generic app labels and app-key session routing without granting Resume trusted actions", async () => {
    const rendered = render(<SandboxedAppFrame appKey="brief-builder" appId="ai.braindrive.brief-builder" appName="Brief Builder" launch={{ ...launch, resource: { ...launch.resource, uri: "ui://brief-builder/main" } }} onSessionClosed={() => {}} />);
    expect(screen.getByRole("region", { name: "Brief Builder app session" })).toBeInTheDocument();
    const frame = screen.getByTitle("Brief Builder sandbox proxy");
    expect(decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!)).toContain('view.title="Brief Builder"');
    rendered.unmount();
    await waitFor(() => expect(closeAppSession).toHaveBeenCalledWith("brief-builder", launch.session_id));
  });

  it("uses only host-projected capability confirmation text and supports cancel then accept", async () => {
    const ownerState = { state_version: 1 as const, state: "unavailable" as const, safe_message: "Review in BrainDrive.", retryable: false, refresh_required: false, current_revision: null, proposal_preserved: true };
    vi.mocked(callAppCapability)
      .mockRejectedValueOnce(new AppCapabilityError("Review in BrainDrive.", 403, "confirmation_required", ownerState, "brief.approvals.confirm", { title: "Approve this brief?", actionLabel: "Approve brief" }))
      .mockRejectedValueOnce(new AppCapabilityError("Review in BrainDrive.", 403, "confirmation_required", ownerState, "brief.approvals.confirm", { title: "Approve this brief?", actionLabel: "Approve brief" }))
      .mockResolvedValueOnce({ result: { approved: true } });
    render(<SandboxedAppFrame appKey="brief-builder" appId="ai.braindrive.brief-builder" appName="Brief Builder" launch={{ ...launch, resource: { ...launch.resource, uri: "ui://brief-builder/main" } }} onSessionClosed={() => {}} />);
    const frame = screen.getByTitle("Brief Builder sandbox proxy") as HTMLIFrameElement;
    const proxyHtml = decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!);
    const nonce = /const NONCE="([^"]+)"/.exec(proxyHtml)?.[1];
    expect(nonce).toBeTruthy();
    const send = async (message: unknown, source: "proxy" | "view" = "view") => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow!, data: { channel: BRIDGE_CHANNEL, direction: "proxy_to_host", proxy_nonce: nonce, source, message } }));
        await Promise.resolve();
      });
    };
    await send({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "proxy");
    await send({ jsonrpc: "2.0", id: "init", method: "ui/initialize", params: { protocolVersion: APPS_PROTOCOL_VERSION, appInfo: { name: "brief", version: "1.0.0" }, appCapabilities: {} } });
    await send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    const firstId = crypto.randomUUID();
    await send({ bridge_version: 1, message_id: firstId, type: "capability.call", payload: { capability: "brief.approvals.confirm", input: { title: "Forged app approval" } } });
    expect(await screen.findByRole("dialog", { name: "Approve this brief?" })).not.toHaveTextContent("Forged app approval");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const secondId = crypto.randomUUID();
    await send({ bridge_version: 1, message_id: secondId, type: "capability.call", payload: { capability: "brief.approvals.confirm", input: { record_id: crypto.randomUUID() } } });
    await userEvent.click(await screen.findByRole("button", { name: "Approve brief" }));
    await waitFor(() => expect(callAppCapability).toHaveBeenLastCalledWith("brief-builder", "brief.approvals.confirm", expect.any(Object), secondId, true));
  });

  it("automatically confirms Resume Builder capability mutations without opening a second dialog", async () => {
    const ownerState = { state_version: 1 as const, state: "unavailable" as const, safe_message: "Review in BrainDrive.", retryable: false, refresh_required: false, current_revision: null, proposal_preserved: true };
    vi.mocked(callAppCapability)
      .mockRejectedValueOnce(new AppCapabilityError("Review in BrainDrive.", 403, "confirmation_required", ownerState, "career.facts.confirm", { title: "Confirm career facts", actionLabel: "Confirm facts" }))
      .mockResolvedValueOnce({ result: { confirmed: true } });
    render(<SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={launch} onSessionClosed={() => {}} />);
    const frame = screen.getByTitle("Resume Builder sandbox proxy") as HTMLIFrameElement;
    const proxyHtml = decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!);
    const nonce = /const NONCE="([^"]+)"/.exec(proxyHtml)?.[1];
    expect(nonce).toBeTruthy();
    const send = async (message: unknown, source: "proxy" | "view" = "view") => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow!, data: { channel: BRIDGE_CHANNEL, direction: "proxy_to_host", proxy_nonce: nonce, source, message } }));
        await Promise.resolve();
      });
    };
    await send({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "proxy");
    await send({ jsonrpc: "2.0", id: "init", method: "ui/initialize", params: { protocolVersion: APPS_PROTOCOL_VERSION, appInfo: { name: "resume", version: "4.0.0" }, appCapabilities: {} } });
    await send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    const operationId = crypto.randomUUID();
    const input = { decisions: [{ fact_record_id: crypto.randomUUID(), fact_revision_id: crypto.randomUUID(), expected_revision: 1, decision: "accept", edited_value: null, review_note: null }] };
    await send({ bridge_version: 1, message_id: operationId, type: "capability.call", payload: { capability: "career.facts.confirm", input } });
    await waitFor(() => expect(callAppCapability).toHaveBeenLastCalledWith("resume-builder", "career.facts.confirm", input, operationId, true));
    expect(callAppCapability).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("forwards the app-bound request operation identity instead of substituting the bridge envelope identity", async () => {
    const inferenceLaunch = { ...launch, allowed_capabilities: [...launch.allowed_capabilities, "app.inference.request"] };
    render(<SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={inferenceLaunch} onSessionClosed={() => {}} />);
    const frame = screen.getByTitle("Resume Builder sandbox proxy") as HTMLIFrameElement;
    const proxyHtml = decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!);
    const nonce = /const NONCE="([^"]+)"/.exec(proxyHtml)?.[1];
    expect(nonce).toBeTruthy();
    const send = async (message: unknown, source: "proxy" | "view" = "view") => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow!, data: { channel: BRIDGE_CHANNEL, direction: "proxy_to_host", proxy_nonce: nonce, source, message } }));
        await Promise.resolve();
      });
    };
    await send({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "proxy");
    await send({ jsonrpc: "2.0", id: "init", method: "ui/initialize", params: { protocolVersion: APPS_PROTOCOL_VERSION, appInfo: { name: "resume", version: "4.0.0" }, appCapabilities: {} } });
    await send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    const operationId = crypto.randomUUID();
    const envelopeId = crypto.randomUUID();
    await send({
      bridge_version: 1,
      message_id: envelopeId,
      type: "capability.call",
      payload: {
        capability: "app.inference.request",
        input: { operation_id: operationId },
        request_operation_id: operationId,
      },
    });
    await waitFor(() => expect(callAppCapability).toHaveBeenCalledWith(
      "resume-builder",
      "app.inference.request",
      { operation_id: operationId },
      operationId,
      false,
    ));
    expect(callAppCapability).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), envelopeId, expect.anything());
  });

  it("forwards Brief Internet Search operation messages through the generic capability routes", async () => {
    const internetSearchLaunch = { ...launch, allowed_capabilities: [...launch.allowed_capabilities, "web.search", "web.read"], resource: { ...launch.resource, uri: "ui://brief-builder/main" } };
    render(<SandboxedAppFrame appKey="brief-builder" appId="ai.braindrive.brief-builder" appName="Brief Builder" launch={internetSearchLaunch} onSessionClosed={() => {}} />);
    const frame = screen.getByTitle("Brief Builder sandbox proxy") as HTMLIFrameElement;
    const proxyHtml = decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!);
    const nonce = /const NONCE="([^"]+)"/.exec(proxyHtml)?.[1];
    expect(nonce).toBeTruthy();
    const send = async (message: unknown, source: "proxy" | "view" = "view") => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow!, data: { channel: BRIDGE_CHANNEL, direction: "proxy_to_host", proxy_nonce: nonce, source, message } }));
        await Promise.resolve();
      });
    };
    const request = {
      request_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      input: { query: "generic consumption", max_results: 1 },
    };

    await send({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "proxy");
    await send({ jsonrpc: "2.0", id: "init", method: "ui/initialize", params: { protocolVersion: APPS_PROTOCOL_VERSION, appInfo: { name: "brief", version: "1.2.0" }, appCapabilities: {} } });
    await send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    await send({ bridge_version: 1, message_id: crypto.randomUUID(), type: "capability.discover", payload: { operation_id: "web.search@1" } });
    await send({ bridge_version: 1, message_id: crypto.randomUUID(), type: "capability.call", payload: { capability: "web.search@1", input: request } });

    await waitFor(() => expect(discoverInternetSearchCapability).toHaveBeenCalledWith("web.search@1"));
    await waitFor(() => expect(callInternetSearchCapability).toHaveBeenCalledWith("web.search@1", request));
    expect(callAppCapability).not.toHaveBeenCalledWith("brief-builder", "web.search@1", expect.anything(), expect.anything(), expect.anything());
  });

  it("does not forward Internet Search calls when the app launch grant omits the generic capability", async () => {
    render(<SandboxedAppFrame appKey="brief-builder" appId="ai.braindrive.brief-builder" appName="Brief Builder" launch={{ ...launch, resource: { ...launch.resource, uri: "ui://brief-builder/main" } }} onSessionClosed={() => {}} />);
    const frame = screen.getByTitle("Brief Builder sandbox proxy") as HTMLIFrameElement;
    const proxyHtml = decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!);
    const nonce = /const NONCE="([^"]+)"/.exec(proxyHtml)?.[1];
    expect(nonce).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow!, data: { channel: BRIDGE_CHANNEL, direction: "proxy_to_host", proxy_nonce: nonce, source: "view", message: { bridge_version: 1, message_id: crypto.randomUUID(), type: "capability.call", payload: { capability: "web.search@1", input: { request_id: crypto.randomUUID(), run_id: crypto.randomUUID(), input: { query: "denied" } } } } } }));
      await Promise.resolve();
    });

    await act(async () => { await Promise.resolve(); });
    expect(callInternetSearchCapability).not.toHaveBeenCalled();
    expect(callAppCapability).not.toHaveBeenCalledWith("brief-builder", "web.search@1", expect.anything(), expect.anything(), expect.anything());
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

  it("keeps one grouped confirmation while preserving individual accept and reject decisions", () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const input = { decisions: [
      { fact_record_id: crypto.randomUUID(), fact_revision_id: first, expected_revision: 1, decision: "accept", edited_value: null, review_note: null },
      { fact_record_id: crypto.randomUUID(), fact_revision_id: second, expected_revision: 1, decision: "accept", edited_value: null, review_note: null },
    ] };
    expect(applyGroupedFactDecisions(input, new Set([first]))).toEqual({ decisions: [
      expect.objectContaining({ fact_revision_id: first, decision: "accept" }),
      expect.objectContaining({ fact_revision_id: second, decision: "reject" }),
    ] });
  });

  it("shows owner-visible factual-unit text instead of structured storage JSON", () => {
    expect(ownerFactConfirmationDetail(JSON.stringify({ value_version: 1, owner_text: "Reduced handoff errors.", internal: "hidden" }))).toBe("Reduced handoff errors.");
    expect(ownerFactConfirmationDetail("Plain confirmed fact")).toBe("Plain confirmed fact");
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
