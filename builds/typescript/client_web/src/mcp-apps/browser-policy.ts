export type BrowserActionPolicy = {
  allowedLinkOrigins: string[];
  clipboardWrite: boolean;
  exportMimeTypes: string[];
  maxClipboardBytes: number;
  maxExportBytes: number;
};

export type BrowserActionResult = {
  allowed: boolean;
  code: string;
  safeMessage: string;
};

const allow = (safeMessage: string): BrowserActionResult => ({ allowed: true, code: "allowed", safeMessage });
const deny = (code: string, safeMessage: string): BrowserActionResult => ({ allowed: false, code, safeMessage });

export class BrowserActionBroker {
  constructor(
    private readonly policy: BrowserActionPolicy,
    private readonly actions: {
      openExternal?: (url: string) => Promise<boolean>;
      writeClipboard?: (value: string) => Promise<void>;
    } = {},
  ) {}

  async openLink(url: string, userGesture: boolean, ownerConfirmed: boolean): Promise<BrowserActionResult> {
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { return deny("link_invalid", "The app requested an invalid link."); }
    if (parsed.protocol !== "https:") return deny("link_scheme_denied", "Only secure HTTPS links can be opened.");
    if (!this.policy.allowedLinkOrigins.includes(parsed.origin)) return deny("link_origin_denied", "This link destination is not allowed for the app.");
    if (!userGesture) return deny("user_gesture_required", "Use the host action to open this link.");
    if (!ownerConfirmed) return deny("owner_confirmation_required", "Confirm the destination in BrainDrive before opening it.");
    if (!this.actions.openExternal || !(await this.actions.openExternal(parsed.toString()))) {
      return deny("link_open_failed", "BrainDrive could not open the approved link.");
    }
    return allow("The approved link was opened.");
  }

  async writeClipboard(value: string, userGesture: boolean, ownerConfirmed: boolean): Promise<BrowserActionResult> {
    if (!this.policy.clipboardWrite) return deny("clipboard_denied", "Clipboard access is not enabled for this app.");
    if (new TextEncoder().encode(value).byteLength > this.policy.maxClipboardBytes) return deny("clipboard_oversized", "The clipboard request is too large.");
    if (!userGesture) return deny("user_gesture_required", "Use the host action to copy this value.");
    if (!ownerConfirmed) return deny("owner_confirmation_required", "Confirm the copy action in BrainDrive.");
    if (!this.actions.writeClipboard) return deny("clipboard_unavailable", "Clipboard access is unavailable.");
    try { await this.actions.writeClipboard(value); }
    catch { return deny("clipboard_failed", "BrainDrive could not copy the approved value."); }
    return allow("The approved value was copied.");
  }

  validateExport(
    input: { safeFilename: string; mimeType: string; sizeBytes: number },
    userGesture: boolean,
    ownerConfirmed: boolean,
  ): BrowserActionResult {
    if (!/^[^/\\]{1,128}$/.test(input.safeFilename)) return deny("export_name_denied", "The export filename is invalid.");
    if (!this.policy.exportMimeTypes.includes(input.mimeType)) return deny("export_type_denied", "This export type is not enabled for the app.");
    const extensionMatches = input.mimeType === "application/pdf"
      ? input.safeFilename.toLocaleLowerCase("en-US").endsWith(".pdf")
      : input.mimeType === "text/plain"
        ? input.safeFilename.toLocaleLowerCase("en-US").endsWith(".txt")
        : true;
    if (!extensionMatches) return deny("export_name_denied", "The export filename does not match its file type.");
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > this.policy.maxExportBytes) return deny("export_oversized", "The export exceeds the host limit.");
    if (!userGesture) return deny("user_gesture_required", "Use the host export action to save this file.");
    if (!ownerConfirmed) return deny("owner_confirmation_required", "Confirm the export in BrainDrive.");
    return allow("The export can be initiated by the host.");
  }
}
