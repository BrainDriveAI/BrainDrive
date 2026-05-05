import { buildLocalOwnerHeaders } from "./local-auth";
import { apiFetch } from "./runtime-api-base";
import type { Session } from "./types";

export type AuthMode = "local" | "local-owner" | "managed";

export type AuthBootstrapStatus = {
  account_initialized: boolean;
  mode: AuthMode;
};

export type AuthCredentials = {
  identifier: string;
  password: string;
};

const LOCAL_SESSION: Session = {
  mode: "local",
  user: {
    id: "owner",
    name: "Local Owner",
    initials: "LO",
    email: "owner@local.braindrive",
    role: "owner",
  },
};

let currentAuthMode: AuthMode = "local";
let hasLoadedBootstrapStatus = false;
let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export async function fetchBootstrapStatus(): Promise<AuthBootstrapStatus> {
  const response = await apiFetch("/api/auth/bootstrap-status", {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`bootstrap_status_${response.status}`);
  }

  const payload = (await response.json()) as Partial<AuthBootstrapStatus>;
  const mode = normalizeAuthMode(payload.mode);
  const accountInitialized = Boolean(payload.account_initialized);

  currentAuthMode = mode;
  hasLoadedBootstrapStatus = true;

  return {
    account_initialized: accountInitialized,
    mode,
  };
}

export async function restoreSession(): Promise<boolean> {
  await ensureBootstrapStatus();
  if (currentAuthMode !== "local") {
    return false;
  }

  const token = await refreshAccessToken();
  return Boolean(token);
}

export async function signup(credentials: AuthCredentials): Promise<void> {
  await ensureBootstrapStatus();

  if (currentAuthMode !== "local") {
    throw new Error("Password sign-up is unavailable in the current auth mode.");
  }

  const response = await apiFetch("/api/auth/signup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    throw await toAuthError(response);
  }

  accessToken = await readAccessToken(response);
}

export async function login(credentials: AuthCredentials): Promise<void> {
  await ensureBootstrapStatus();

  if (currentAuthMode !== "local") {
    throw new Error("Password sign-in is unavailable in the current auth mode.");
  }

  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    throw await toAuthError(response);
  }

  accessToken = await readAccessToken(response);
}

export async function logout(): Promise<void> {
  try {
    const authMode = await getAuthMode();
    if (authMode === "local") {
      await authenticatedFetch(
        "/api/auth/logout",
        {
          method: "POST",
        },
        { retryOnUnauthorized: false }
      );
    }
  } catch {
    // best-effort logout
  } finally {
    accessToken = null;
    refreshInFlight = null;
  }
}

export async function getSession(): Promise<Session> {
  try {
    const response = await authenticatedFetch("/api/session", { method: "GET" });
    if (!response.ok) {
      return LOCAL_SESSION;
    }

    return (await response.json()) as Session;
  } catch {
    return LOCAL_SESSION;
  }
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { retryOnUnauthorized?: boolean } = {}
): Promise<Response> {
  const retryOnUnauthorized = options.retryOnUnauthorized ?? true;
  const authMode = await getAuthMode();

  if (authMode === "local-owner") {
    return apiFetch(input, {
      ...init,
      headers: mergeHeaders(buildLocalOwnerHeaders(), init.headers),
    });
  }

  if (authMode === "managed") {
    const response = await apiFetch(input, init);
    if (response.status === 401) {
      // Session expired or container stopped — redirect to login
      window.location.href = "/login";
    }
    return response;
  }

  await ensureAccessToken();
  let response = await apiFetch(input, {
    ...init,
    credentials: "include",
    headers: mergeHeaders(buildBearerHeaders(), init.headers),
  });

  if (response.status !== 401 || !retryOnUnauthorized) {
    return response;
  }

  const refreshedToken = await refreshAccessToken();
  if (!refreshedToken) {
    return response;
  }

  response = await apiFetch(input, {
    ...init,
    credentials: "include",
    headers: mergeHeaders(buildBearerHeaders(), init.headers),
  });

  return response;
}

export async function getAuthMode(): Promise<AuthMode> {
  await ensureBootstrapStatus();
  return currentAuthMode;
}

export function __resetAuthAdapterForTests(): void {
  currentAuthMode = "local";
  hasLoadedBootstrapStatus = false;
  accessToken = null;
  refreshInFlight = null;
}

async function ensureBootstrapStatus(): Promise<void> {
  if (hasLoadedBootstrapStatus) {
    return;
  }

  await fetchBootstrapStatus();
}

async function ensureAccessToken(): Promise<void> {
  if (accessToken) {
    return;
  }

  await refreshAccessToken();
}

async function refreshAccessToken(): Promise<string | null> {
  if (currentAuthMode !== "local") {
    return null;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const response = await apiFetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        accessToken = null;
        return null;
      }

      accessToken = await readAccessToken(response);
      return accessToken;
    } catch {
      accessToken = null;
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function buildBearerHeaders(): Record<string, string> {
  if (!accessToken) {
    return {};
  }

  return {
    authorization: `Bearer ${accessToken}`,
  };
}

async function readAccessToken(response: Response): Promise<string> {
  const payload = (await response.json()) as {
    access_token?: string;
  };

  if (!payload.access_token || payload.access_token.trim().length === 0) {
    throw new Error("Missing access token");
  }

  return payload.access_token;
}

async function toAuthError(response: Response): Promise<Error> {
  const payload = await safeJson(response);
  const code = typeof payload?.error === "string" ? payload.error : "";

  if (code === "account_already_initialized") {
    return new Error("Account already initialized. Please sign in.");
  }

  if (code === "invalid_credentials") {
    return new Error("Invalid username or password.");
  }

  if (code === "signup_bootstrap_token_required") {
    return new Error("Sign-up requires the bootstrap token configured for this runtime.");
  }

  if (code === "signup_local_only") {
    return new Error("Sign-up is restricted to localhost until the first account is created.");
  }

  if (response.status === 429) {
    return new Error("Too many attempts. Please wait and try again.");
  }

  return new Error("Authentication failed.");
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeAuthMode(value: unknown): AuthMode {
  if (value === "local-owner" || value === "managed" || value === "local") {
    return value;
  }

  return "local";
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

export type { Session };
