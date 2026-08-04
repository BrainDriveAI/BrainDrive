type NativeRuntimeStatus = {
  state?: string;
  gatewayBaseUrl?: string;
  desktopApiToken?: string;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

let gatewayBaseUrlOverride: string | null = null;
let cachedGatewayBaseUrl: string | null = null;
let cachedDesktopApiToken: string | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function setGatewayBaseUrlForTests(baseUrl: string | null): void {
  gatewayBaseUrlOverride = baseUrl;
  cachedGatewayBaseUrl = null;
  cachedDesktopApiToken = null;
}

export async function resolveGatewayBaseUrl(): Promise<string> {
  if (gatewayBaseUrlOverride) {
    return gatewayBaseUrlOverride;
  }

  if (cachedGatewayBaseUrl) {
    return cachedGatewayBaseUrl;
  }

  if (!isTauriRuntime()) {
    cachedGatewayBaseUrl = "/api";
    return cachedGatewayBaseUrl;
  }

  const status = await getNativeRuntimeStatus();
  const state = status.state?.trim() || "unknown";
  if (state !== "ready") {
    throw new Error(`Desktop runtime handoff failed closed: runtime state is ${state}`);
  }

  if (!status.gatewayBaseUrl?.trim()) {
    throw new Error("Desktop runtime handoff failed closed: missing gateway URL");
  }
  if (!status.desktopApiToken?.trim()) {
    throw new Error("Desktop runtime handoff failed closed: missing transport token");
  }

  cachedGatewayBaseUrl = normalizeDesktopBaseUrl(status.gatewayBaseUrl);
  cachedDesktopApiToken = status.desktopApiToken;
  return cachedGatewayBaseUrl;
}

export async function resolveApiInput(input: RequestInfo | URL): Promise<RequestInfo | URL> {
  if (typeof input !== "string") {
    return input;
  }

  if (!input.startsWith("/api")) {
    return input;
  }

  const baseUrl = await resolveGatewayBaseUrl();
  if (baseUrl === "/api") {
    return input;
  }

  const path = input.replace(/^\/api\/?/, "");
  return path.length > 0 ? `${baseUrl}/${path}` : baseUrl;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const resolvedInput = await resolveApiInput(input);
  try {
    return await fetch(resolvedInput, {
      ...init,
      headers: mergeHeaders(await getDesktopApiHeaders(), init.headers),
    });
  } catch (error) {
    throw normalizeFetchError(error, resolvedInput);
  }
}

export async function getDesktopApiHeaders(): Promise<Record<string, string>> {
  if (!isTauriRuntime()) {
    return {};
  }

  await resolveGatewayBaseUrl();
  if (!cachedDesktopApiToken) {
    return {};
  }

  return {
    "x-braindrive-desktop-token": cachedDesktopApiToken,
  };
}

async function getNativeRuntimeStatus(): Promise<NativeRuntimeStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  const value = await invoke<NativeRuntimeStatus>("get_runtime_status");
  return value;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed || trimmed === "/api") {
    return "/api";
  }
  return trimmed.replace(/\/+$/, "");
}

function normalizeDesktopBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Desktop runtime handoff failed closed: invalid gateway URL");
  }

  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Desktop runtime handoff failed closed: invalid loopback gateway URL");
  }

  return normalized;
}

function mergeHeaders(base: Record<string, string>, headers?: HeadersInit): Record<string, string> {
  const merged: Record<string, string> = {};
  if (headers) {
    const incoming = new Headers(headers);
    incoming.forEach((value, key) => {
      merged[key] = value;
    });
  }

  for (const [key, value] of Object.entries(base)) {
    merged[key] = value;
  }
  return merged;
}

function normalizeFetchError(error: unknown, input: RequestInfo | URL): Error {
  if (!isTauriRuntime()) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : "the local gateway";
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Unable to reach the local BrainDrive runtime at ${target}: ${message}`);
}
