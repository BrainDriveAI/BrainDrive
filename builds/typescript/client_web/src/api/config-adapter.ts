import { buildLocalOwnerHeaders } from "./local-auth";

type GatewayConfig = {
  mode: "local";
  gateway_url: string;
};

export async function getConfig(): Promise<{ mode: "local"; gatewayUrl: string }> {
  try {
    const response = await fetch("/api/config", {
      headers: buildLocalOwnerHeaders(),
    });
    if (!response.ok) {
      return { mode: "local", gatewayUrl: "/api" };
    }

    const payload = (await response.json()) as GatewayConfig;
    return {
      mode: payload.mode,
      gatewayUrl: payload.gateway_url
    };
  } catch {
    return { mode: "local", gatewayUrl: "/api" };
  }
}
