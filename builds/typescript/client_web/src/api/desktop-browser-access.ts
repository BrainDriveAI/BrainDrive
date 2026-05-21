import { isTauriRuntime } from "@/api/runtime-api-base";

export type BrowserAccessNetworkScope = "thisComputer" | "privateNetwork";

export type BrowserAccessStatus = {
  enabled: boolean;
  state: string;
  networkScope: BrowserAccessNetworkScope;
  bindAddress: string;
  requestedPort: number;
  port: number | null;
  urls: string[];
  configPath: string;
  firewallHint: string;
  lastError: string | null;
  accountInitialized: boolean | null;
};

export type BrowserAccessSettingsUpdate = {
  enabled: boolean;
  networkScope: BrowserAccessNetworkScope;
  port: number;
};

export type BrowserAccessFirewallResult = {
  ok: boolean;
  message: string;
  command: string;
};

export async function getBrowserAccessStatus(): Promise<BrowserAccessStatus> {
  return invokeDesktop<BrowserAccessStatus>("get_browser_access_status");
}

export async function updateBrowserAccessSettings(
  settings: BrowserAccessSettingsUpdate
): Promise<BrowserAccessStatus> {
  return invokeDesktop<BrowserAccessStatus>("update_browser_access_settings", { settings });
}

export async function restartBrowserAccess(): Promise<BrowserAccessStatus> {
  return invokeDesktop<BrowserAccessStatus>("restart_browser_access");
}

export async function applyBrowserAccessFirewallRule(enabled: boolean): Promise<BrowserAccessFirewallResult> {
  return invokeDesktop<BrowserAccessFirewallResult>("apply_browser_access_firewall_rule", { enabled });
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop Browser Access is only available in the BrainDrive desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
