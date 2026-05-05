import { buildLocalOwnerHeaders } from "./local-auth";
import { apiFetch } from "./runtime-api-base";

export type GatewayInstallMode = "dev" | "local" | "prod" | "unknown";
export type GatewayInstallLocation = "local" | "managed" | "unknown";

type GatewayConfig = {
  mode?: string;
  gateway_url?: string;
  billing_url?: string;
  install_mode?: string;
  install_location?: string;
  app_version?: string;
};

export type GatewayClientConfig = {
  mode: "local" | "managed";
  gatewayUrl: string;
  billingUrl: string;
  installMode: GatewayInstallMode;
  installLocation: GatewayInstallLocation;
  appVersion: string;
};

const DEFAULT_LOCAL_CONFIG: GatewayClientConfig = {
  mode: "local",
  gatewayUrl: "/api",
  billingUrl: "https://my.braindrive.ai/credits",
  installMode: "unknown",
  installLocation: "unknown",
  appVersion: "unknown",
};

export async function getConfig(): Promise<GatewayClientConfig> {
  // Retry on failure with exponential backoff before falling through to
  // the local-mode default. This endpoint determines whether BD Core
  // shows its own login screen or trusts gateway-injected auth (managed
  // mode); falling through to "local" prematurely on a transient network
  // hiccup or a still-booting container produces a confusing login screen
  // for users who are already authenticated via the gateway. After this
  // retry budget is exhausted, we still default to "local" — that's the
  // safe choice for genuine local installs where /api/config legitimately
  // 404s. The handoff path on the gateway side also probes this endpoint
  // before redirecting, so reaching this fallback at all should be rare.
  const attempts = [0, 500, 1000, 2000, 4000]; // ms backoff between attempts (5 total tries)
  let lastError: unknown = null;

  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) {
      await new Promise((r) => setTimeout(r, attempts[i]));
    }
    try {
      const response = await apiFetch("/api/config", {
        headers: buildLocalOwnerHeaders(),
      });
      if (!response.ok) {
        // Non-200: server reachable but unhappy. Could be 404 (genuine
        // local install with no managed gateway) or 502/503 (managed
        // container still booting). Retry — only fall through if we run
        // out of attempts.
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const payload = (await response.json()) as GatewayConfig;
      return {
        mode: toDeploymentMode(payload.mode),
        gatewayUrl: payload.gateway_url || "/api",
        billingUrl: payload.billing_url ?? "https://my.braindrive.ai/credits",
        installMode: toInstallMode(payload.install_mode),
        installLocation: toInstallLocation(payload.install_location),
        appVersion: toAppVersion(payload.app_version),
      };
    } catch (err) {
      lastError = err;
    }
  }

  // All attempts exhausted — log and fall through to local-mode default.
  // For a true local install this is correct; for a managed install it
  // means the gateway is genuinely down and the user can't authenticate
  // anyway, so showing the login screen is acceptable degraded UX.
  if (lastError) {
    console.warn("[BD Core] getConfig failed after retries, defaulting to local mode:", lastError);
  }
  return DEFAULT_LOCAL_CONFIG;
}

function toDeploymentMode(value: unknown): "local" | "managed" {
  return value === "managed" ? "managed" : "local";
}

function toInstallMode(value: unknown): GatewayInstallMode {
  if (value === "dev" || value === "local" || value === "prod") {
    return value;
  }
  return "unknown";
}

function toInstallLocation(value: unknown): GatewayInstallLocation {
  if (value === "local" || value === "managed") {
    return value;
  }
  return "unknown";
}

function toAppVersion(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "unknown";
}
