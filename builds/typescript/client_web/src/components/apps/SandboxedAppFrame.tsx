import { useCallback, useEffect, useRef, useState } from "react";

import {
  AppCapabilityError,
  callAppCapability,
  closeAppSession,
  finalizeResumeBuilderExport,
  sendAppAppsBridgeMessage,
  sendAppBridgeMessage,
  type AppLaunch,
  type HostConfirmationPresentation,
} from "@/api/apps-adapter";
import { isTauriRuntime } from "@/api/runtime-api-base";
import { BrowserActionBroker } from "@/mcp-apps/browser-policy";
import { McpAppBridgeController, type BridgeStatus } from "@/mcp-apps/bridge";
import { OUTER_PROXY_SANDBOX, VIEW_PERMISSION_POLICY, createSandboxProxyUrl } from "@/mcp-apps/sandbox-proxy";
import { secureRandomUuid } from "@/utils/browser-crypto";
import { openExternalUrl } from "@/utils/external-url";

export function isTrustedSandboxMessage(event: MessageEvent, frame: HTMLIFrameElement | null): boolean {
  return Boolean(frame?.contentWindow && event.source === frame.contentWindow && event.origin === "null");
}

export function isModelSettingsAction(action: unknown, value: unknown): boolean {
  return action === "navigate_settings" && value === "models";
}

export function applyGroupedFactDecisions(input: Record<string, unknown>, acceptedRevisionIds: ReadonlySet<string>): Record<string, unknown> {
  if (!Array.isArray(input.decisions)) return input;
  return {
    ...input,
    decisions: input.decisions.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
      const decision = candidate as Record<string, unknown>;
      const accepted = typeof decision.fact_revision_id === "string" && acceptedRevisionIds.has(decision.fact_revision_id);
      return { ...decision, decision: accepted ? "accept" : "reject", edited_value: null };
    }),
  };
}

export function ownerFactConfirmationDetail(value: string): string {
  try {
    const parsed = JSON.parse(value) as { owner_text?: unknown; text?: unknown };
    if (typeof parsed.owner_text === "string" && parsed.owner_text.trim()) return parsed.owner_text;
    if (typeof parsed.text === "string" && parsed.text.trim()) return parsed.text;
  } catch {
    // Plain owner-entered facts are already suitable for review.
  }
  return value;
}

type BridgeEnvelope = {
  bridge_version: 1;
  message_id: string;
  type: string;
  payload?: { capability?: string; input?: Record<string, unknown> } & Record<string, unknown>;
};

type PendingOwnerConfirmation = {
  message: BridgeEnvelope;
  presentation: HostConfirmationPresentation;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type PendingHostAction = {
  title: string;
  detail: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export async function saveHostResumeExport(result: unknown): Promise<{ safe_destination_label: string; definition: unknown; parse_back: unknown }> {
  const value = result as { filename?: unknown; mime_type?: unknown; bytes_base64?: unknown; safe_destination_label?: unknown; definition?: unknown; parse_back?: unknown };
  if (typeof value.filename !== "string" || typeof value.mime_type !== "string" || typeof value.bytes_base64 !== "string" || typeof value.safe_destination_label !== "string") {
    throw new Error("invalid_export_result");
  }
  const isPdf = value.mime_type === "application/pdf" && /^[^/\\]+\.pdf$/i.test(value.filename);
  const isText = value.mime_type === "text/plain" && /^[^/\\]+\.txt$/i.test(value.filename);
  if (!isPdf && !isText) throw new Error("invalid_export_result");
  const bytes = Uint8Array.from(atob(value.bytes_base64), (character) => character.charCodeAt(0));
  let textPayload = "";
  try { if (isText) textPayload = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("invalid_export_result"); }
  if ((isPdf && new TextDecoder("latin1").decode(bytes.subarray(0, 8)) !== "%PDF-1.4") || (isText && (!textPayload || bytes.includes(0)))) throw new Error("invalid_export_result");
  let safeDestinationLabel = value.safe_destination_label;
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const native = await invoke<{ outcome: "completed" | "cancelled"; safeDestinationLabel: string }>("save_resume_export", {
      request: { safeFilename: value.filename, mimeType: value.mime_type, bytesBase64: value.bytes_base64 },
    });
    if (native.outcome === "cancelled") throw new Error("cancelled");
    if (!(isPdf ? /^[^/\\]+\.pdf$/i : /^[^/\\]+\.txt$/i).test(native.safeDestinationLabel)) throw new Error("invalid_export_result");
    safeDestinationLabel = native.safeDestinationLabel;
  } else {
    const url = URL.createObjectURL(new Blob([bytes], { type: value.mime_type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = value.filename;
    anchor.rel = "noopener";
    anchor.click();
    queueMicrotask(() => URL.revokeObjectURL(url));
  }
  return { safe_destination_label: safeDestinationLabel, definition: value.definition, parse_back: value.parse_back };
}

export const saveHostPdfExport = saveHostResumeExport;

export default function SandboxedAppFrame({
  appKey,
  appId,
  appName,
  launch,
  onSessionClosed,
  onReload,
  onOpenSettings,
}: {
  appKey: string;
  appId: string;
  appName: string;
  launch: AppLaunch;
  onSessionClosed: () => void;
  onReload?: () => Promise<void>;
  onOpenSettings?: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const controllerRef = useRef<McpAppBridgeController | null>(null);
  const closedRef = useRef(false);
  const cleanupAbortRef = useRef<AbortController | null>(null);
  const ownerRecordsRef = useRef(new Map<string, { label: string; detail: string }>());
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<BridgeStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(720);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingOwnerConfirmation | null>(null);
  const [acceptedGroupRevisionIds, setAcceptedGroupRevisionIds] = useState<Set<string>>(new Set());
  const [pendingHostAction, setPendingHostAction] = useState<PendingHostAction | null>(null);

  useEffect(() => {
    if (pendingConfirmation || pendingHostAction) confirmButtonRef.current?.focus();
  }, [pendingConfirmation, pendingHostAction]);

  useEffect(() => {
    cleanupAbortRef.current?.abort();
    const cleanupAbort = new AbortController();
    cleanupAbortRef.current = cleanupAbort;
    closedRef.current = false;
    setStatus("loading");
    setError(null);
    const frame = frameRef.current;
    if (!frame) return;
    const proxyNonce = secureRandomUuid();
    const close = () => {
      if (closedRef.current) return;
      closedRef.current = true;
      controllerRef.current?.requestTeardown();
      controllerRef.current?.close("unmount");
      void closeAppSession(appKey, launch.session_id);
    };
    const browserBroker = new BrowserActionBroker({
      allowedLinkOrigins: ["https://docs.braindrive.ai"],
      clipboardWrite: true,
      exportMimeTypes: ["application/pdf", "text/plain"],
      maxClipboardBytes: 16_384,
      maxExportBytes: 2_097_152,
    }, {
      openExternal: openExternalUrl,
      writeClipboard: async (value) => navigator.clipboard.writeText(value),
    });
    const requestHostAction = (title: string, detail: string, run: () => Promise<unknown>) => new Promise<unknown>((resolve, reject) => {
      setPendingHostAction({ title, detail, run, resolve, reject });
    });
    const hydrate = (message: BridgeEnvelope): BridgeEnvelope & {
      app_id: string;
      installation_id: string;
      view_id: string;
      operation_id: string;
      sent_at: string;
    } => ({
      bridge_version: 1,
      message_id: message.message_id,
      app_id: appId,
      installation_id: launch.installation_id,
      view_id: launch.view_id,
      operation_id: launch.operation_id,
      sent_at: new Date().toISOString(),
      type: message.type,
      payload: message.type === "bridge.ready"
        ? (message.payload ?? {})
        : { ...(message.payload ?? {}), token_id: launch.bridge_token_id },
    });
    const handleLegacyMessage = async (message: BridgeEnvelope, signal: AbortSignal): Promise<unknown> => {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (message.type === "career.return" && appId !== "ai.braindrive.resume-builder") throw new Error("career_return_requires_trusted_app_adapter");
      if (message.type === "host.action") {
        const action = message.payload?.action;
        const value = message.payload?.value;
        if (action === "open_link" && typeof value === "string") {
          return await requestHostAction("Open external link?", value, () => browserBroker.openLink(value, true, true));
        }
        if (action === "copy_to_clipboard" && typeof value === "string") {
          return await requestHostAction("Copy app content?", "BrainDrive will copy only the displayed app value.", async () => {
            const decision = await browserBroker.writeClipboard(value, true, true);
            if (!decision.allowed) throw new Error(decision.code);
            return decision;
          });
        }
        if (isModelSettingsAction(action, value) && onOpenSettings) {
          onOpenSettings();
          return { status: "opened" };
        }
        throw new Error("browser_action_denied");
      }
      if (message.type === "export.request") {
        if (appId !== "ai.braindrive.resume-builder") throw new Error("export_requires_trusted_app_adapter");
        const requestedFormat = message.payload?.format === "text" ? "text" : "pdf";
        return await requestHostAction(requestedFormat === "text" ? "Export clean resume text?" : "Export resume PDF?", `BrainDrive will prepare the approved ${requestedFormat === "text" ? "clean text" : "PDF"} and initiate the host save flow. The app receives only a safe file label.`, async () => {
          const response = await sendAppBridgeMessage(appKey, launch.session_id, hydrate(message));
          const result = (response as { result?: unknown }).result;
          const prepared = result as { artifact_revision_id?: unknown; artifact_digest?: unknown; safe_destination_label?: unknown };
          if (typeof prepared.artifact_revision_id !== "string" || typeof prepared.artifact_digest !== "string" || typeof prepared.safe_destination_label !== "string") {
            throw new Error("recoverable_internal_failure");
          }
          try {
            const exportPayload = result as { filename?: unknown; mime_type?: unknown; bytes_base64?: unknown };
            if (typeof exportPayload.filename !== "string" || typeof exportPayload.mime_type !== "string" || typeof exportPayload.bytes_base64 !== "string") {
              throw new Error("invalid_export_result");
            }
            const padding = exportPayload.bytes_base64.endsWith("==") ? 2 : exportPayload.bytes_base64.endsWith("=") ? 1 : 0;
            const sizeBytes = Math.floor(exportPayload.bytes_base64.length * 3 / 4) - padding;
            const exportDecision = browserBroker.validateExport({ safeFilename: exportPayload.filename, mimeType: exportPayload.mime_type, sizeBytes }, true, true);
            if (!exportDecision.allowed) throw new Error(exportDecision.code);
            const projection = await saveHostResumeExport(result);
            const receipt = await finalizeResumeBuilderExport({ artifact_revision_id: prepared.artifact_revision_id, artifact_digest: prepared.artifact_digest, safe_destination_label: projection.safe_destination_label, outcome: "completed" });
            return { ...projection, safe_destination_label: receipt.safe_destination_label };
          } catch (exportError) {
            const outcome = exportError instanceof Error && exportError.message === "cancelled" ? "cancelled" : "failed";
            await finalizeResumeBuilderExport({ artifact_revision_id: prepared.artifact_revision_id, artifact_digest: prepared.artifact_digest, safe_destination_label: prepared.safe_destination_label, outcome }).catch(() => undefined);
            throw new Error(outcome === "cancelled" ? "cancelled" : "recoverable_internal_failure");
          }
        });
      }
      if (message.type === "capability.call" && typeof message.payload?.capability === "string" && message.payload.input) {
        try {
          const operationId = typeof message.payload.request_operation_id === "string" ? message.payload.request_operation_id : message.message_id;
          const response = await callAppCapability(appKey, message.payload.capability, message.payload.input, operationId, false);
          const result = response.result;
          if (appId === "ai.braindrive.resume-builder" && message.payload.capability === "career.facts.propose") {
            const fact = (result as { fact?: { metadata?: { record_id?: unknown }; value?: unknown } } | undefined)?.fact;
            if (typeof fact?.metadata?.record_id === "string" && typeof fact.value === "string") ownerRecordsRef.current.set(fact.metadata.record_id, { label: "Confirm career fact", detail: ownerFactConfirmationDetail(fact.value) });
          }
          if (appId === "ai.braindrive.resume-builder" && message.payload.capability === "resume.definitions.write") {
            const definition = (result as { definition?: { metadata?: { record_id?: unknown }; title?: unknown; statements?: unknown[] } } | undefined)?.definition;
            if (typeof definition?.metadata?.record_id === "string" && typeof definition.title === "string") ownerRecordsRef.current.set(definition.metadata.record_id, { label: "Approve resume version", detail: `${definition.title} · ${definition.statements?.length ?? 0} statements` });
          }
          return response;
        } catch (failure) {
          if (!(failure instanceof AppCapabilityError) || !failure.confirmation || failure.capability !== message.payload.capability) throw failure;
          const decisions = message.payload.input.decisions;
          setAcceptedGroupRevisionIds(new Set(Array.isArray(decisions) ? decisions.flatMap((decision) => decision && typeof decision === "object" && typeof (decision as Record<string, unknown>).fact_revision_id === "string" ? [(decision as Record<string, unknown>).fact_revision_id as string] : []) : []));
          return await new Promise((resolve, reject) => setPendingConfirmation({ message, presentation: failure.confirmation!, resolve, reject }));
        }
      }
      const response = await sendAppBridgeMessage(appKey, launch.session_id, hydrate(message));
      return response;
    };
    const controller = new McpAppBridgeController({
      launch,
      proxyNonce,
      sendToProxy: (value) => frame.contentWindow?.postMessage(value, "*"),
      onToolCall: async (name, args, _context, signal) => {
        const response = await sendAppAppsBridgeMessage(appKey, launch, { jsonrpc: "2.0", id: secureRandomUuid(), method: "tools/call", params: { name, arguments: args } }, signal) as { result?: unknown };
        return response.result;
      },
      onResourceRead: async (uri, _context, signal) => {
        const response = await sendAppAppsBridgeMessage(appKey, launch, { jsonrpc: "2.0", id: secureRandomUuid(), method: "resources/read", params: { uri } }, signal) as { result?: unknown };
        return response.result;
      },
      onOpenLink: (url) => requestHostAction("Open external link?", url, () => browserBroker.openLink(url, true, true)),
      onDownloadFile: async () => ({ isError: true, code: "export_requires_host_flow" }),
      onLegacyMessage: handleLegacyMessage,
      onResize: ({ height }) => setFrameHeight(height),
      onRequestTeardown: onSessionClosed,
      onStatus: setStatus,
      onViolation: (code) => {
        if (["message_oversized", "message_too_deep", "rate_limited"].includes(code)) {
          setStatus("error");
          setError("The app exceeded the secure bridge limits. Reload the app to reconnect.");
        }
      },
    });
    controllerRef.current = controller;
    const onMessage = (event: MessageEvent) => { void controller.receive(event, frame.contentWindow!); };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { close(); onSessionClosed(); }
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    frame.src = createSandboxProxyUrl(proxyNonce, appName);
    const connectionTimeout = window.setTimeout(() => {
      if (controller.state === "ready" || controller.state === "closed") return;
      setStatus("error");
      setError("The app did not complete its secure connection. Reload the app to try again.");
      controller.close("revoked");
    }, 10_000);
    return () => {
      window.clearTimeout(connectionTimeout);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      controller.requestTeardown();
      controller.close("unmount");
      if (controllerRef.current === controller) controllerRef.current = null;
      queueMicrotask(() => {
        if (!cleanupAbort.signal.aborted) close();
      });
    };
  }, [appId, appKey, appName, launch, onOpenSettings, onSessionClosed]);

  const confirmationRecord = (() => {
    const input = pendingConfirmation?.message.payload?.input;
    const label = pendingConfirmation?.presentation.title ?? "Review owner action";
    if (Array.isArray(input?.decisions) && appId === "ai.braindrive.resume-builder") return { label, detail: `${input.decisions.length} factual unit${input.decisions.length === 1 ? "" : "s"} will be decided together. Uncheck any unit that should remain unconfirmed.` };
    const recordId = typeof input?.fact_record_id === "string" ? input.fact_record_id : typeof input?.definition_record_id === "string" ? input.definition_record_id : typeof input?.request_record_id === "string" ? input.request_record_id : "";
    if (appId === "ai.braindrive.resume-builder" && input?.kind === "revision_outcome" && input.state === "generating") return { label, detail: "BrainDrive will generate a proposal from the confirmed fact snapshot. This does not approve a resume version." };
    if (appId === "ai.braindrive.resume-builder" && input?.kind === "revision_outcome" && input.state === "accepted") return { label, detail: "The proposal will remain unapproved until you separately validate and approve the resume version." };
    if (appId === "ai.braindrive.resume-builder" && input?.kind === "revision_outcome" && input.state === "rejected") return { label, detail: "The approved source remains unchanged and the rejected proposal stays in owner history." };
    if (appId === "ai.braindrive.resume-builder" && input?.kind === "revision_outcome" && input.state === "regenerate") return { label, detail: "BrainDrive will keep the source and request, then make one bounded retry." };
    if (appId === "ai.braindrive.resume-builder" && input?.kind === "revision_proposal" && input.owner_outcome === "edit") return { label, detail: "BrainDrive will validate the complete edited successor. Approval remains a separate owner action." };
    if (appId === "ai.braindrive.resume-builder" && input?.decision === "edit_and_accept" && typeof input.edited_value === "string") {
      return { label, detail: input.edited_value };
    }
    if (appId === "ai.braindrive.resume-builder" && input?.decision === "reject") {
      return { label, detail: "BrainDrive will stop using this item in new resume drafts. Its earlier confirmed version remains in history." };
    }
    return { label, detail: ownerRecordsRef.current.get(recordId)?.detail ?? "BrainDrive will validate the saved record and reject stale or unsupported content." };
  })();

  const confirmationUnits = (() => {
    if (appId !== "ai.braindrive.resume-builder") return [];
    const input = pendingConfirmation?.message.payload?.input;
    if (!Array.isArray(input?.decisions)) return [];
    return input.decisions.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const decision = candidate as Record<string, unknown>;
      const recordId = typeof decision.fact_record_id === "string" ? decision.fact_record_id : "";
      const revisionId = typeof decision.fact_revision_id === "string" ? decision.fact_revision_id : "";
      if (!recordId || !revisionId) return [];
      return [{ recordId, revisionId, detail: ownerRecordsRef.current.get(recordId)?.detail ?? "Proposed factual unit" }];
    });
  })();

  const completeConfirmation = async (confirmed: boolean) => {
    const message = pendingConfirmation;
    setPendingConfirmation(null);
    if (!message?.message.payload?.capability || !message.message.payload.input) return;
    if (!confirmed) {
      message.reject(new Error("cancelled"));
      frameRef.current?.focus();
      return;
    }
    try {
      const input = applyGroupedFactDecisions(message.message.payload.input, acceptedGroupRevisionIds);
      const operationId = typeof message.message.payload.request_operation_id === "string" ? message.message.payload.request_operation_id : message.message.message_id;
      const response = await callAppCapability(appKey, message.message.payload.capability, input, operationId, true);
      message.resolve(response);
    } catch (requestError) {
      message.reject(requestError instanceof Error ? requestError : new Error("recoverable_internal_failure"));
    } finally { frameRef.current?.focus(); }
  };

  const completeHostAction = async (confirmed: boolean) => {
    const action = pendingHostAction;
    setPendingHostAction(null);
    if (!action) return;
    if (!confirmed) {
      action.reject(new Error("cancelled"));
      frameRef.current?.focus();
      return;
    }
    try { action.resolve(await action.run()); }
    catch (failure) { action.reject(failure instanceof Error ? failure : new Error("recoverable_internal_failure")); }
    finally { frameRef.current?.focus(); }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || (!pendingConfirmation && !pendingHostAction)) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (pendingConfirmation) { setPendingConfirmation(null); pendingConfirmation.reject(new Error("cancelled")); }
        else if (pendingHostAction) { setPendingHostAction(null); pendingHostAction.reject(new Error("cancelled")); }
        frameRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, [pendingConfirmation, pendingHostAction]);

  const closeAndReturn = useCallback(() => {
    controllerRef.current?.requestTeardown();
    onSessionClosed();
  }, [onSessionClosed]);

  const reload = async () => {
    if (!onReload) return;
    setStatus("reconnecting");
    setError(null);
    controllerRef.current?.requestTeardown();
    controllerRef.current?.close("reload");
    try { await onReload(); }
    catch { setStatus("error"); setError("The app could not reconnect. Your saved work is preserved."); }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`${appName} app session`}>
      <div className="flex items-center justify-between border-b border-bd-border px-4 py-3 text-sm">
        <span role="status" aria-live="polite">{status === "loading" ? "Connecting securely…" : status === "ready" ? "App ready" : status === "reconnecting" ? "Reconnecting securely…" : status === "disabled" ? "App disabled" : status === "stopped" ? "App stopped" : "App unavailable"}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => frameRef.current?.focus()} className="rounded-md px-3 py-2 text-bd-text-secondary hover:bg-bd-bg-hover">Enter app</button>
          {onReload ? <button type="button" onClick={() => void reload()} className="rounded-md px-3 py-2 text-bd-text-secondary hover:bg-bd-bg-hover">Reload app</button> : null}
          <button type="button" onClick={closeAndReturn} className="rounded-md px-3 py-2 text-bd-text-secondary hover:bg-bd-bg-hover">Close app</button>
        </div>
      </div>
      {error ? <div role="alert" className="m-4 rounded-lg border border-bd-danger px-4 py-3 text-sm text-bd-text-primary">{error}</div> : null}
      {pendingConfirmation ? (
        <div ref={dialogRef} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="app-owner-confirmation-title" aria-describedby="app-owner-confirmation-detail app-owner-confirmation-boundary" className="m-4 rounded-xl border border-bd-amber bg-bd-bg-secondary p-4 shadow-xl">
          <h2 id="app-owner-confirmation-title" className="font-heading text-lg font-semibold text-bd-text-heading">{confirmationRecord.label}</h2>
          <p id="app-owner-confirmation-detail" className="mt-2 text-sm text-bd-text-primary">{confirmationRecord.detail}</p>
          {confirmationUnits.length ? <fieldset className="mt-3 space-y-2"><legend className="sr-only">Choose factual units to confirm</legend>{confirmationUnits.map((unit) => <label key={unit.revisionId} className="flex items-start gap-2 rounded-lg border border-bd-border p-3 text-sm text-bd-text-primary"><input type="checkbox" className="mt-1" checked={acceptedGroupRevisionIds.has(unit.revisionId)} onChange={(event) => setAcceptedGroupRevisionIds((current) => { const next = new Set(current); if (event.target.checked) next.add(unit.revisionId); else next.delete(unit.revisionId); return next; })} /><span>{unit.detail}</span></label>)}</fieldset> : null}
          <p id="app-owner-confirmation-boundary" className="mt-2 text-xs text-bd-text-secondary">This host-owned confirmation prevents sandboxed app content from approving an owner result by itself. Press Escape to cancel and return to the app.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button ref={confirmButtonRef} type="button" onClick={() => void completeConfirmation(true)} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary">{pendingConfirmation.presentation.actionLabel}</button>
            <button type="button" onClick={() => void completeConfirmation(false)} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary">Cancel</button>
          </div>
        </div>
      ) : null}
      {pendingHostAction ? (
        <div ref={dialogRef} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="app-host-action-title" aria-describedby="app-host-action-detail app-host-action-boundary" className="m-4 rounded-xl border border-bd-amber bg-bd-bg-secondary p-4 shadow-xl">
          <h2 id="app-host-action-title" className="font-heading text-lg font-semibold text-bd-text-heading">{pendingHostAction.title}</h2>
          <p id="app-host-action-detail" className="mt-2 break-words text-sm text-bd-text-primary">{pendingHostAction.detail}</p>
          <p id="app-host-action-boundary" className="mt-2 text-xs text-bd-text-secondary">This action is performed by BrainDrive. The app receives only a safe outcome and no host path or runtime credential. Press Escape to cancel and return to the app.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button ref={confirmButtonRef} type="button" onClick={() => void completeHostAction(true)} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary">Confirm</button>
            <button type="button" onClick={() => void completeHostAction(false)} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary">Cancel</button>
          </div>
        </div>
      ) : null}
      <iframe
        ref={frameRef}
        title={`${appName} sandbox proxy`}
        sandbox={OUTER_PROXY_SANDBOX}
        referrerPolicy="no-referrer"
        allow={VIEW_PERMISSION_POLICY}
        style={{ height: `${frameHeight}px`, maxHeight: "100%" }}
        className="min-h-[24rem] w-full flex-1 border-0 bg-bd-bg-primary"
      />
    </section>
  );
}
