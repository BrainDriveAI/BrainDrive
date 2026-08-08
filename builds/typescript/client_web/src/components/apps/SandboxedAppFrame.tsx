import { useCallback, useEffect, useRef, useState } from "react";

import { callResumeBuilderCapability, closeResumeBuilderSession, finalizeResumeBuilderExport, sendResumeBuilderBridgeMessage, type AppLaunch } from "@/api/apps-adapter";
import { isTauriRuntime } from "@/api/runtime-api-base";

const MAX_BRIDGE_MESSAGE_BYTES = 65_536;

export function isTrustedSandboxMessage(event: MessageEvent, frame: HTMLIFrameElement | null): boolean {
  return Boolean(frame?.contentWindow && event.source === frame.contentWindow && event.origin === "null");
}

type BridgeEnvelope = {
  message_id: string;
  type: string;
  payload?: { capability?: string; input?: Record<string, unknown> } & Record<string, unknown>;
};

export async function saveHostPdfExport(result: unknown): Promise<{ safe_destination_label: string; definition: unknown; parse_back: unknown }> {
  const value = result as { filename?: unknown; mime_type?: unknown; bytes_base64?: unknown; safe_destination_label?: unknown; definition?: unknown; parse_back?: unknown };
  if (typeof value.filename !== "string" || !/^[^/\\]+\.pdf$/i.test(value.filename) || value.mime_type !== "application/pdf" || typeof value.bytes_base64 !== "string" || typeof value.safe_destination_label !== "string") {
    throw new Error("invalid_export_result");
  }
  let safeDestinationLabel = value.safe_destination_label;
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const native = await invoke<{ outcome: "completed" | "cancelled"; safeDestinationLabel: string }>("save_resume_export", {
      request: { safeFilename: value.filename, mimeType: value.mime_type, bytesBase64: value.bytes_base64 },
    });
    if (native.outcome === "cancelled") throw new Error("cancelled");
    if (!/^[^/\\]+\.pdf$/i.test(native.safeDestinationLabel)) throw new Error("invalid_export_result");
    safeDestinationLabel = native.safeDestinationLabel;
  } else {
    const bytes = Uint8Array.from(atob(value.bytes_base64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = value.filename;
    anchor.rel = "noopener";
    anchor.click();
    queueMicrotask(() => URL.revokeObjectURL(url));
  }
  return { safe_destination_label: safeDestinationLabel, definition: value.definition, parse_back: value.parse_back };
}

export default function SandboxedAppFrame({ launch, onSessionClosed }: { launch: AppLaunch; onSessionClosed: () => void }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const closedRef = useRef(false);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownerRecordsRef = useRef(new Map<string, { label: string; detail: string }>());
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<BridgeEnvelope | null>(null);

  const postToApp = useCallback((message: unknown) => frameRef.current?.contentWindow?.postMessage(message, "*"), []);

  useEffect(() => {
    if (pendingConfirmation) confirmButtonRef.current?.focus();
  }, [pendingConfirmation]);

  useEffect(() => {
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
    const close = () => {
      if (closedRef.current) return;
      closedRef.current = true;
      void closeResumeBuilderSession(launch.session_id);
    };
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedSandboxMessage(event, frameRef.current)) return;
      let encoded: string;
      try { encoded = JSON.stringify(event.data); }
      catch { setStatus("error"); setError("The app sent an unreadable message."); return; }
      if (new TextEncoder().encode(encoded).byteLength > MAX_BRIDGE_MESSAGE_BYTES) {
        setStatus("error"); setError("The app sent a message that was too large."); close(); return;
      }
      const message = event.data as BridgeEnvelope;
      const isFactConfirmation = message.type === "capability.call" && message.payload?.capability === "career.facts.confirm";
      const isDefinitionApproval = message.type === "capability.call" && message.payload?.capability === "resume.definitions.write" && message.payload.input?.kind === "approve_definition";
      if (isFactConfirmation || isDefinitionApproval) {
        setPendingConfirmation(message);
        return;
      }
      void sendResumeBuilderBridgeMessage(launch.session_id, message).then(async (response) => {
        const result = (response as { result?: unknown }).result;
        if (message.type === "capability.call" && message.payload?.capability === "career.facts.propose") {
          const fact = (result as { fact?: { metadata?: { record_id?: unknown }; value?: unknown; fact_kind?: unknown } } | undefined)?.fact;
          if (typeof fact?.metadata?.record_id === "string" && typeof fact.value === "string") ownerRecordsRef.current.set(fact.metadata.record_id, { label: "Confirm career fact", detail: fact.value });
        }
        if (message.type === "capability.call" && message.payload?.capability === "resume.definitions.write") {
          const definition = (result as { definition?: { metadata?: { record_id?: unknown }; title?: unknown; statements?: unknown[] } } | undefined)?.definition;
          if (typeof definition?.metadata?.record_id === "string" && typeof definition.title === "string") ownerRecordsRef.current.set(definition.metadata.record_id, { label: "Approve resume version", detail: `${definition.title} · ${definition.statements?.length ?? 0} statements` });
        }
        if (message.type === "export.request") {
          const prepared = result as { artifact_revision_id?: unknown; artifact_digest?: unknown; safe_destination_label?: unknown };
          if (typeof prepared.artifact_revision_id !== "string" || typeof prepared.artifact_digest !== "string" || typeof prepared.safe_destination_label !== "string") {
            postToApp({ type: "host.result", request_message_id: message.message_id, error: { error: "recoverable_internal_failure" } });
            return;
          }
          try {
            const projection = await saveHostPdfExport(result);
            const receipt = await finalizeResumeBuilderExport({ artifact_revision_id: prepared.artifact_revision_id, artifact_digest: prepared.artifact_digest, safe_destination_label: projection.safe_destination_label, outcome: "completed" });
            postToApp({ type: "host.result", request_message_id: message.message_id, response: { ...projection, safe_destination_label: receipt.safe_destination_label } });
          } catch (exportError) {
            const outcome = exportError instanceof Error && exportError.message === "cancelled" ? "cancelled" : "failed";
            await finalizeResumeBuilderExport({ artifact_revision_id: prepared.artifact_revision_id, artifact_digest: prepared.artifact_digest, safe_destination_label: prepared.safe_destination_label, outcome }).catch(() => undefined);
            postToApp({ type: "host.result", request_message_id: message.message_id, error: { error: outcome === "cancelled" ? "cancelled" : "recoverable_internal_failure" } });
          }
          return;
        }
        postToApp({ type: "host.result", request_message_id: message.message_id, response });
      }).catch((requestError) => {
        const code = requestError instanceof Error ? requestError.message : "recoverable_internal_failure";
        postToApp({ type: "host.result", request_message_id: message.message_id, error: { error: code } });
        if (["session_closed", "session_expired"].includes(code)) { setStatus("error"); setError("The app connection was closed. Return to Apps and launch it again."); close(); }
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { close(); onSessionClosed(); }
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      cleanupTimerRef.current = setTimeout(close, 0);
    };
  }, [launch.session_id, onSessionClosed, postToApp]);

  const confirmationRecord = (() => {
    const input = pendingConfirmation?.payload?.input;
    const recordId = typeof input?.fact_record_id === "string" ? input.fact_record_id : typeof input?.definition_record_id === "string" ? input.definition_record_id : "";
    return ownerRecordsRef.current.get(recordId) ?? { label: "Confirm this owner action", detail: "BrainDrive will validate the saved record and reject stale or unsupported content." };
  })();

  const completeConfirmation = async (confirmed: boolean) => {
    const message = pendingConfirmation;
    setPendingConfirmation(null);
    if (!message?.payload?.capability || !message.payload.input) return;
    if (!confirmed) {
      postToApp({ type: "host.result", request_message_id: message.message_id, error: { error: "cancelled" } });
      frameRef.current?.focus();
      return;
    }
    try {
      const response = await callResumeBuilderCapability(message.payload.capability, message.payload.input, message.message_id, true);
      postToApp({ type: "host.result", request_message_id: message.message_id, response });
    } catch (requestError) {
      postToApp({ type: "host.result", request_message_id: message.message_id, error: { error: requestError instanceof Error ? requestError.message : "recoverable_internal_failure" } });
    } finally { frameRef.current?.focus(); }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Resume Builder app session">
      <div className="flex items-center justify-between border-b border-bd-border px-4 py-3 text-sm">
        <span aria-live="polite">{status === "loading" ? "Connecting securely…" : status === "ready" ? "App ready" : "App unavailable"}</span>
        <button type="button" onClick={onSessionClosed} className="rounded-md px-3 py-2 text-bd-text-secondary hover:bg-bd-bg-hover">Close app</button>
      </div>
      {error ? <div role="alert" className="m-4 rounded-lg border border-bd-danger px-4 py-3 text-sm text-bd-text-primary">{error}</div> : null}
      {pendingConfirmation ? (
        <div role="dialog" aria-modal="true" aria-labelledby="resume-owner-confirmation-title" className="m-4 rounded-xl border border-bd-amber bg-bd-bg-secondary p-4 shadow-xl">
          <h2 id="resume-owner-confirmation-title" className="font-heading text-lg font-semibold text-bd-text-heading">{confirmationRecord.label}</h2>
          <p className="mt-2 text-sm text-bd-text-primary">{confirmationRecord.detail}</p>
          <p className="mt-2 text-xs text-bd-text-secondary">This host-owned confirmation prevents the sandboxed app from approving facts or resume versions by itself.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button ref={confirmButtonRef} type="button" onClick={() => void completeConfirmation(true)} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary">Confirm</button>
            <button type="button" onClick={() => void completeConfirmation(false)} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary">Cancel</button>
          </div>
        </div>
      ) : null}
      <iframe
        ref={frameRef}
        title="Resume Builder"
        srcDoc={launch.resource.html}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'"
        onLoad={() => {
          setStatus("ready");
          postToApp({ type: "host.bootstrap", launch });
        }}
        className="min-h-[24rem] w-full flex-1 border-0 bg-bd-bg-primary"
      />
    </section>
  );
}
