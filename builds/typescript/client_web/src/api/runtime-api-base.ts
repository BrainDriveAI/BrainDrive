type NativeRuntimeStatus = {
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
  cachedGatewayBaseUrl = normalizeBaseUrl(status.gatewayBaseUrl || "/api");
  cachedDesktopApiToken = status.desktopApiToken ?? null;
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
  return fetch(resolvedInput, {
    ...init,
    headers: mergeHeaders(await getDesktopApiHeaders(), init.headers),
  });
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

function mergeHeaders(base: Record<string, string>, headers?: HeadersInit): Record<string, string> {
  const merged = { ...base };
  if (!headers) {
    return merged;
  }

  const incoming = new Headers(headers);
  incoming.forEach((value, key) => {
    merged[key] = value;
  });
  return merged;
}

