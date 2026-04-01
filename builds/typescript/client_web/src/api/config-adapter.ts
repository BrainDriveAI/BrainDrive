import { buildLocalOwnerHeaders } from "./local-auth";

export type GatewayInstallMode = "local" | "quickstart" | "prod" | "unknown";

type GatewayConfig = {
  mode?: string;
  gateway_url?: string;
  install_mode?: string;
};

export type GatewayClientConfig = {
  mode: "local" | "managed";
  gatewayUrl: string;
  installMode: GatewayInstallMode;
};

export async function getConfig(): Promise<GatewayClientConfig> {
  try {
    const response = await fetch("/api/config", {
      headers: buildLocalOwnerHeaders(),
    });
    if (!response.ok) {
      return { mode: "local", gatewayUrl: "/api", installMode: "unknown" };
    }

    const payload = (await response.json()) as GatewayConfig;
    return {
      mode: toDeploymentMode(payload.mode),
      gatewayUrl: payload.gateway_url || "/api",
      installMode: toInstallMode(payload.install_mode),
    };
  } catch {
    return { mode: "local", gatewayUrl: "/api", installMode: "unknown" };
  }
}

function toDeploymentMode(value: unknown): "local" | "managed" {
  return value === "managed" ? "managed" : "local";
}

function toInstallMode(value: unknown): GatewayInstallMode {
  if (value === "local" || value === "quickstart" || value === "prod") {
    return value;
  }
  return "unknown";
}
