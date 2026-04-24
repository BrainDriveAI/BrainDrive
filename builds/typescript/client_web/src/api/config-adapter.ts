import { buildLocalOwnerHeaders } from "./local-auth";

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

export async function getConfig(): Promise<GatewayClientConfig> {
  try {
    const response = await fetch("/api/config", {
      headers: buildLocalOwnerHeaders(),
    });
    if (!response.ok) {
      return {
        mode: "local",
        gatewayUrl: "/api",
        billingUrl: "https://my.braindrive.ai/credits",
        installMode: "unknown",
        installLocation: "unknown",
        appVersion: "unknown"
      };
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
  } catch {
    return {
      mode: "local",
      gatewayUrl: "/api",
      billingUrl: "https://my.braindrive.ai/credits",
      installMode: "unknown",
      installLocation: "unknown",
      appVersion: "unknown"
    };
  }
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
