import {
  BrowserActionBroker,
  type BrowserActionPolicy,
} from "./browser-policy";

const policy: BrowserActionPolicy = {
  allowedLinkOrigins: ["https://docs.braindrive.ai"],
  clipboardWrite: true,
  exportMimeTypes: ["application/pdf"],
  maxClipboardBytes: 16_384,
  maxExportBytes: 2_097_152,
};

describe("MCP App privileged browser policy", () => {
  it("allows only exact HTTPS origins after a host gesture and confirmation", async () => {
    const open = vi.fn(async () => true);
    const broker = new BrowserActionBroker(policy, { openExternal: open });

    await expect(broker.openLink("http://docs.braindrive.ai/help", true, true))
      .resolves.toMatchObject({ allowed: false, code: "link_scheme_denied" });
    await expect(broker.openLink("https://evil.invalid/help", true, true))
      .resolves.toMatchObject({ allowed: false, code: "link_origin_denied" });
    await expect(broker.openLink("https://docs.braindrive.ai/help", false, true))
      .resolves.toMatchObject({ allowed: false, code: "user_gesture_required" });
    await expect(broker.openLink("https://docs.braindrive.ai/help", true, false))
      .resolves.toMatchObject({ allowed: false, code: "owner_confirmation_required" });
    await expect(broker.openLink("https://docs.braindrive.ai/help", true, true))
      .resolves.toMatchObject({ allowed: true });
    expect(open).toHaveBeenCalledOnce();
  });

  it("brokers clipboard write only, with bounds, gesture, and confirmation", async () => {
    const writeClipboard = vi.fn(async () => undefined);
    const broker = new BrowserActionBroker(policy, { writeClipboard });
    await expect(broker.writeClipboard("safe text", false, true))
      .resolves.toMatchObject({ allowed: false, code: "user_gesture_required" });
    await expect(broker.writeClipboard("safe text", true, false))
      .resolves.toMatchObject({ allowed: false, code: "owner_confirmation_required" });
    await expect(broker.writeClipboard("x".repeat(16_385), true, true))
      .resolves.toMatchObject({ allowed: false, code: "clipboard_oversized" });
    await expect(broker.writeClipboard("safe text", true, true))
      .resolves.toMatchObject({ allowed: true });
    expect(writeClipboard).toHaveBeenCalledWith("safe text");
  });

  it("validates export initiation without accepting a raw path", () => {
    const broker = new BrowserActionBroker(policy);
    expect(broker.validateExport({ safeFilename: "resume.pdf", mimeType: "application/pdf", sizeBytes: 8_000 }, true, true))
      .toMatchObject({ allowed: true });
    expect(broker.validateExport({ safeFilename: "../resume.pdf", mimeType: "application/pdf", sizeBytes: 8_000 }, true, true))
      .toMatchObject({ allowed: false, code: "export_name_denied" });
    expect(broker.validateExport({ safeFilename: "resume.pdf", mimeType: "text/html", sizeBytes: 8_000 }, true, true))
      .toMatchObject({ allowed: false, code: "export_type_denied" });
    expect(JSON.stringify(broker.validateExport({ safeFilename: "resume.pdf", mimeType: "application/pdf", sizeBytes: 8_000 }, true, true)))
      .not.toMatch(/\/(?:home|Users|tmp|var)\//);
  });

  it("defaults every action to a safe actionable denial", async () => {
    const broker = new BrowserActionBroker({
      allowedLinkOrigins: [],
      clipboardWrite: false,
      exportMimeTypes: [],
      maxClipboardBytes: 1,
      maxExportBytes: 1,
    });
    await expect(broker.openLink("https://docs.braindrive.ai", true, true))
      .resolves.toMatchObject({ allowed: false, code: "link_origin_denied" });
    await expect(broker.writeClipboard("x", true, true))
      .resolves.toMatchObject({ allowed: false, code: "clipboard_denied" });
    expect(broker.validateExport({ safeFilename: "resume.pdf", mimeType: "application/pdf", sizeBytes: 1 }, true, true))
      .toMatchObject({ allowed: false, code: "export_type_denied" });
  });
});
