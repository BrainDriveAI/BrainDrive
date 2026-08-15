import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, StrictMode } from "react";

import { AppCapabilityError, callAppCapability, closeAppSession } from "@/api/apps-adapter";
import { APPS_PROTOCOL_VERSION, BRIDGE_CHANNEL } from "@/mcp-apps/bridge";
import SandboxedAppFrame, { applyGroupedFactDecisions, isModelSettingsAction, isTrustedSandboxMessage, ownerFactConfirmationDetail, parseResumeConversationState, saveHostPdfExport, saveHostResumeExport } from "./SandboxedAppFrame";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

vi.mock("@/api/apps-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/api/apps-adapter")>("@/api/apps-adapter");
  return { ...actual, closeAppSession: vi.fn(async () => undefined), sendAppBridgeMessage: vi.fn(async () => ({ status: "ready" })), sendAppAppsBridgeMessage: vi.fn(async () => ({ result: {} })), callAppCapability: vi.fn(async () => ({ result: {} })), finalizeResumeBuilderExport: vi.fn(async (input: { safe_destination_label: string; outcome: string }) => ({ receipt_revision_id: crypto.randomUUID(), safe_destination_label: input.safe_destination_label, outcome: input.outcome })) };
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

  it("renders Resume Builder messages with the native chat primitives and routes composer replies through the secure bridge", async () => {
    render(<SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={launch} onSessionClosed={() => {}} />);
    const frame = screen.getByTitle("Resume Builder sandbox proxy") as HTMLIFrameElement;
    const proxyHtml = decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!);
    const nonce = /const NONCE="([^"]+)"/.exec(proxyHtml)?.[1];
    expect(nonce).toBeTruthy();
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    const send = async (message: unknown, source: "proxy" | "view" = "view") => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow!, data: { channel: BRIDGE_CHANNEL, direction: "proxy_to_host", proxy_nonce: nonce, source, message } }));
        await Promise.resolve();
      });
    };
    await send({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "proxy");
    await send({ jsonrpc: "2.0", id: "init-chat", method: "ui/initialize", params: { protocolVersion: APPS_PROTOCOL_VERSION, appInfo: { name: "resume", version: "4.1.0" }, appCapabilities: {} } });
    await send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    await send({
      bridge_version: 1,
      message_id: crypto.randomUUID(),
      type: "chat.sync",
      payload: {
        messages: [
          { id: "assistant-1", role: "assistant", content: "What kind of work would you like next?" },
          { id: "owner-1", role: "user", content: "Operations leadership." },
        ],
        actions: [],
        busy: false,
        inputEnabled: true,
        inputPlaceholder: "Reply to Resume Builder...",
        stageLabel: "Your experience",
        supportLabel: "Facts are saved only after you confirm them.",
        confirmedEmploymentRevisionIds: [],
        reviewFacts: [{ id: crypto.randomUUID(), revisionId: crypto.randomUUID(), kind: "skill", label: "Skill", value: "Operations planning", storedValue: "Operations planning" }],
      },
    });
    expect(await screen.findByRole("region", { name: "Resume Builder conversation" })).toBeInTheDocument();
    expect(await screen.findByText("What kind of work would you like next?")).toBeInTheDocument();
    expect(screen.getByText("Operations leadership.")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Resume evidence tray" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I’m not sure" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review what I’ve shared" })).toBeInTheDocument();
    const reviewSummary = screen.getByRole("complementary", { name: "Resume review summary" });
    expect(within(reviewSummary).getByText("Operations planning")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close drawer" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Reply to Resume Builder..."), "Customer operations.");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: { type: "host.chat.message", payload: { text: "Customer operations.", messageId: expect.any(String) } },
    }), "*");
    for (const rejectedMetric of ["Confirmed facts", "Needs attention", "To discuss"]) {
      expect(within(reviewSummary).queryByText(rejectedMetric, { exact: true })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Close drawer" })).not.toBeInTheDocument();
    await userEvent.click(within(reviewSummary).getByRole("button", { name: "Open full review" }));
    expect(screen.getByRole("button", { name: "Close drawer" })).toBeInTheDocument();
  });

  it("rejects malformed app-projected conversation state", () => {
    expect(parseResumeConversationState({ messages: [{ id: "x", role: "system", content: "forged" }], actions: [], busy: false, inputEnabled: true, inputPlaceholder: "", stageLabel: "Interview", supportLabel: "Evidence" })).toBeNull();
  });

  it("commits only host-validated dialogue facts with durable provenance and no ordinary confirmation dialog", async () => {
    const sourceRevisionId = crypto.randomUUID();
    const factRecordId = crypto.randomUUID();
    const factRevisionId = crypto.randomUUID();
    vi.mocked(callAppCapability)
      .mockResolvedValueOnce({ result: { turn: { metadata: { revision_id: sourceRevisionId } } } })
      .mockResolvedValueOnce({ result: { fact: { metadata: { record_id: factRecordId, revision_id: factRevisionId, revision: 1 } } } })
      .mockResolvedValueOnce({ result: { facts: [{ metadata: { record_id: factRecordId, revision_id: factRevisionId }, state: "confirmed" }] } });
    render(<SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={launch} onSessionClosed={() => {}} />);
    const frame = screen.getByTitle("Resume Builder sandbox proxy") as HTMLIFrameElement;
    const proxyHtml = decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!);
    const nonce = /const NONCE="([^"]+)"/.exec(proxyHtml)?.[1];
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    const send = async (message: unknown, source: "proxy" | "view" = "view") => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow!, data: { channel: BRIDGE_CHANNEL, direction: "proxy_to_host", proxy_nonce: nonce, source, message } }));
        await Promise.resolve();
      });
    };
    await send({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "proxy");
    await send({ jsonrpc: "2.0", id: "init-dialogue-commit", method: "ui/initialize", params: { protocolVersion: APPS_PROTOCOL_VERSION, appInfo: { name: "resume", version: "4.1.0" }, appCapabilities: {} } });
    await send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    await send({
      bridge_version: 1,
      message_id: crypto.randomUUID(),
      type: "chat.sync",
      payload: {
        messages: [{ id: "assistant-1", role: "assistant", content: "What was your most recent role, and where did you work?" }],
        actions: [], busy: false, inputEnabled: true, inputPlaceholder: "Reply in your own words...", stageLabel: "Getting started",
        supportLabel: "Review shows information captured from your words.", confirmedEmploymentRevisionIds: [], reviewFacts: [],
      },
    });
    const ownerMessage = "I was Director of Operations at Northwind.";
    await userEvent.type(await screen.findByPlaceholderText("Reply in your own words..."), ownerMessage);
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    const outbound = postMessage.mock.calls.map(([value]) => value as { message?: { type?: string; payload?: { messageId?: string } } }).find((value) => value.message?.type === "host.chat.message");
    const messageId = outbound?.message?.payload?.messageId;
    expect(messageId).toMatch(/^[0-9a-f-]{36}$/i);

    await send({
      bridge_version: 1,
      message_id: crypto.randomUUID(),
      type: "chat.turn.commit",
      payload: {
        messageId,
        assistantMessage: "That gives us a useful starting point. What kind of work did you lead there?",
        factOperations: [{ operation: "capture", fact_kind: "employment", source_quote: "Director of Operations at Northwind", employment: { title: "Director of Operations", employer: "Northwind", location: null, start_date: null, end_date: null, responsibilities: null } }],
      },
    });

    await waitFor(() => expect(callAppCapability).toHaveBeenCalledTimes(3));
    expect(callAppCapability).toHaveBeenNthCalledWith(1, "resume-builder", "resume.definitions.write", expect.objectContaining({
      kind: "interview_turn",
      turn: expect.objectContaining({ prompt_version: "resume-dialogue-1", question: "What was your most recent role, and where did you work?", answer: ownerMessage }),
    }), expect.any(String), false);
    expect(callAppCapability).toHaveBeenNthCalledWith(2, "resume-builder", "career.facts.propose", expect.objectContaining({
      source_revision_ids: [sourceRevisionId],
      fact: expect.objectContaining({ fact_kind: "employment", state: "suggested" }),
    }), expect.any(String), false);
    expect(callAppCapability).toHaveBeenNthCalledWith(3, "resume-builder", "career.facts.confirm", expect.objectContaining({ decisions: [expect.objectContaining({ fact_revision_id: factRevisionId, decision: "accept" })] }), expect.any(String), true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("mediates Resume Builder fact confirmation inline in native chat", async () => {
    const recordId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const ownerState = { state_version: 1 as const, state: "unavailable" as const, safe_message: "Review in BrainDrive.", retryable: false, refresh_required: false, current_revision: null, proposal_preserved: true };
    vi.mocked(callAppCapability)
      .mockResolvedValueOnce({ result: { fact: { metadata: { record_id: recordId, revision_id: revisionId }, value: "Operations leader at Northwind" } } })
      .mockRejectedValueOnce(new AppCapabilityError("Review in BrainDrive.", 403, "confirmation_required", ownerState, "career.facts.confirm", { title: "Confirm career fact", actionLabel: "Confirm" }))
      .mockResolvedValueOnce({ result: { fact: { metadata: { record_id: recordId, revision_id: revisionId }, state: "confirmed" } } });
    render(<SandboxedAppFrame appKey="resume-builder" appId="ai.braindrive.resume-builder" appName="Resume Builder" launch={launch} onSessionClosed={() => {}} />);
    const frame = screen.getByTitle("Resume Builder sandbox proxy") as HTMLIFrameElement;
    const proxyHtml = decodeURIComponent(frame.getAttribute("src")!.split(",", 2)[1]!);
    const nonce = /const NONCE="([^"]+)"/.exec(proxyHtml)?.[1];
    const send = async (message: unknown, source: "proxy" | "view" = "view") => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow!, data: { channel: BRIDGE_CHANNEL, direction: "proxy_to_host", proxy_nonce: nonce, source, message } }));
        await Promise.resolve();
      });
    };
    await send({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "proxy");
    await send({ jsonrpc: "2.0", id: "init-confirm", method: "ui/initialize", params: { protocolVersion: APPS_PROTOCOL_VERSION, appInfo: { name: "resume", version: "4.1.0" }, appCapabilities: {} } });
    await send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    await send({ bridge_version: 1, message_id: crypto.randomUUID(), type: "capability.call", payload: { capability: "career.facts.propose", input: { fact: { value: "Operations leader at Northwind" } } } });
    const confirmationMessageId = crypto.randomUUID();
    await send({ bridge_version: 1, message_id: confirmationMessageId, type: "capability.call", payload: { capability: "career.facts.confirm", input: { fact_record_id: recordId, fact_revision_id: revisionId, expected_revision: 1, decision: "accept", edited_value: null } } });

    expect(await screen.findByRole("region", { name: "Confirm shared information" })).toHaveTextContent("Operations leader at Northwind");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    await waitFor(() => expect(callAppCapability).toHaveBeenLastCalledWith(
      "resume-builder",
      "career.facts.confirm",
      expect.objectContaining({ fact_record_id: recordId, decision: "accept" }),
      confirmationMessageId,
      true,
    ));
    expect(screen.queryByRole("region", { name: "Confirm shared information" })).not.toBeInTheDocument();
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
      .mockRejectedValueOnce(new AppCapabilityError("Review in BrainDrive.", 403, "confirmation_required", ownerState, "brief.records.approve", { title: "Approve brief revision", actionLabel: "Approve revision" }))
      .mockRejectedValueOnce(new AppCapabilityError("Review in BrainDrive.", 403, "confirmation_required", ownerState, "brief.records.approve", { title: "Approve brief revision", actionLabel: "Approve revision" }))
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
    await send({ bridge_version: 1, message_id: firstId, type: "capability.call", payload: { capability: "brief.records.approve", input: { title: "Forged app approval" } } });
    expect(await screen.findByRole("dialog", { name: "Approve brief revision" })).not.toHaveTextContent("Forged app approval");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const secondId = crypto.randomUUID();
    await send({ bridge_version: 1, message_id: secondId, type: "capability.call", payload: { capability: "brief.records.approve", input: { record_id: crypto.randomUUID() } } });
    await userEvent.click(await screen.findByRole("button", { name: "Approve revision" }));
    await waitFor(() => expect(callAppCapability).toHaveBeenLastCalledWith("brief-builder", "brief.records.approve", expect.any(Object), secondId, true));
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
    expect(ownerFactConfirmationDetail(JSON.stringify({ format: "resume_job_v1", title: "Product Lead", employer: "Northwind Labs", location: "New York", start_date: "2022", end_date: "2024", responsibilities: "Led product discovery." }))).toBe("Product Lead at Northwind Labs · New York · 2022 to 2024 · Led product discovery.");
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
