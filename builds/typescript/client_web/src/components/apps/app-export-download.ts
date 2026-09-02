import { isTauriRuntime } from "@/api/runtime-api-base";

export type HostAppExportProjection = {
  safe_destination_label: string;
  definition: unknown;
  parse_back: unknown;
};

export type HostAppExportPayload = {
  filename: string;
  mime_type: "application/pdf" | "text/plain";
  bytes_base64: string;
  safe_destination_label: string;
  definition?: unknown;
  parse_back?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function appExportPayloadSizeBytes(bytesBase64: string): number {
  const padding = bytesBase64.endsWith("==") ? 2 : bytesBase64.endsWith("=") ? 1 : 0;
  return Math.floor(bytesBase64.length * 3 / 4) - padding;
}

export function parseHostAppExportPayload(result: unknown): HostAppExportPayload {
  if (!isRecord(result)) throw new Error("invalid_export_result");
  const { filename, mime_type, bytes_base64, safe_destination_label } = result;
  if (
    typeof filename !== "string" ||
    typeof mime_type !== "string" ||
    typeof bytes_base64 !== "string" ||
    typeof safe_destination_label !== "string"
  ) {
    throw new Error("invalid_export_result");
  }
  const isPdf = mime_type === "application/pdf" && /^[^/\\]+\.pdf$/i.test(filename);
  const isText = mime_type === "text/plain" && /^[^/\\]+\.txt$/i.test(filename);
  if (!isPdf && !isText) throw new Error("invalid_export_result");
  return {
    filename,
    mime_type: isPdf ? "application/pdf" : "text/plain",
    bytes_base64,
    safe_destination_label,
    definition: result.definition,
    parse_back: result.parse_back,
  };
}

export function decodeHostAppExportBytes(payload: HostAppExportPayload): Uint8Array {
  const bytes = Uint8Array.from(atob(payload.bytes_base64), (character) => character.charCodeAt(0));
  let textPayload = "";
  try {
    if (payload.mime_type === "text/plain") textPayload = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("invalid_export_result");
  }
  const isPdf = payload.mime_type === "application/pdf";
  if ((isPdf && new TextDecoder("latin1").decode(bytes.subarray(0, 8)) !== "%PDF-1.4") || (!isPdf && (!textPayload || bytes.includes(0)))) {
    throw new Error("invalid_export_result");
  }
  return bytes;
}

export async function saveHostAppExport(result: unknown): Promise<HostAppExportProjection> {
  const payload = parseHostAppExportPayload(result);
  const bytes = decodeHostAppExportBytes(payload);
  let safeDestinationLabel = payload.safe_destination_label;
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const native = await invoke<{ outcome: "completed" | "cancelled"; safeDestinationLabel: string }>("save_resume_export", {
      request: { safeFilename: payload.filename, mimeType: payload.mime_type, bytesBase64: payload.bytes_base64 },
    });
    if (native.outcome === "cancelled") throw new Error("cancelled");
    if (!(payload.mime_type === "application/pdf" ? /^[^/\\]+\.pdf$/i : /^[^/\\]+\.txt$/i).test(native.safeDestinationLabel)) throw new Error("invalid_export_result");
    safeDestinationLabel = native.safeDestinationLabel;
  } else {
    const blobBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([blobBytes], { type: payload.mime_type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = payload.filename;
    anchor.rel = "noopener";
    anchor.click();
    queueMicrotask(() => URL.revokeObjectURL(url));
  }
  return { safe_destination_label: safeDestinationLabel, definition: payload.definition, parse_back: payload.parse_back };
}
