import { isTauriRuntime } from "@/api/runtime-api-base";

export type TailscaleAccessState =
  | "off"
  | "needsSetup"
  | "ready"
  | "starting"
  | "running"
  | "conflict"
  | "needsAttention";

export type TailscaleReadinessState =
  | "missing"
  | "permissionDenied"
  | "unsupportedVersion"
  | "daemonUnavailable"
  | "signedOut"
  | "offline"
  | "missingDns"
  | "consentRequired"
  | "ready";

export type TailscaleErrorCode =
  | "ineligibleDeployment"
  | "ownerNotInitialized"
  | "notInstalled"
  | "permissionDenied"
  | "unsupportedVersion"
  | "daemonUnavailable"
  | "notSignedIn"
  | "offline"
  | "missingDns"
  | "consentRequired"
  | "conflict"
  | "commandTimeout"
  | "commandFailed"
  | "ambiguousOutcome"
  | "malformedOutput"
  | "outputTooLarge"
  | "persistence"
  | "bridgeUnavailable"
  | "staleOwnership"
  | "internal";

export type ServeOwnership =
  | "absent"
  | "ownedExact"
  | "occupiedUnowned"
  | "ownedDrifted"
  | "ambiguous";

export type TailnetBridgeState = "stopped" | "starting" | "running" | "failed";

export type TailscaleAccessAction =
  | "enable"
  | "retry"
  | "disable"
  | "checkAgain"
  | "completeSetup";

export type SemanticVersion = {
  major: number;
  minor: number;
  patch: number;
};

export type TailscaleReadiness = {
  state: TailscaleReadinessState;
  installedVersion: SemanticVersion | null;
  minimumSupportedVersion: SemanticVersion;
  backendState: string | null;
  online: boolean | null;
  dnsNameAvailable: boolean;
  errorCode: TailscaleErrorCode | null;
};

export type TailscaleAccessStatus = {
  state: TailscaleAccessState;
  desiredEnabled: boolean;
  readiness: TailscaleReadiness;
  ownership: ServeOwnership;
  bridgeState: TailnetBridgeState;
  accessUrl: string | null;
  setupUrl: string | null;
  availableActions: TailscaleAccessAction[];
  message: string;
  detail: string | null;
  errorCode: TailscaleErrorCode | null;
  checkedAtUnixMs: number;
};

export function getTailscaleAccessStatus(): Promise<TailscaleAccessStatus> {
  return invokeDesktop("get_tailscale_access_status");
}

export function enableTailscaleAccess(): Promise<TailscaleAccessStatus> {
  return invokeDesktop("enable_tailscale_access");
}

export function retryTailscaleAccess(): Promise<TailscaleAccessStatus> {
  return invokeDesktop("retry_tailscale_access");
}

export function disableTailscaleAccess(): Promise<TailscaleAccessStatus> {
  return invokeDesktop("disable_tailscale_access");
}

async function invokeDesktop(command: string): Promise<TailscaleAccessStatus> {
  if (!isTauriRuntime()) {
    throw new Error("Remote Access is only available in the BrainDrive desktop app.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TailscaleAccessStatus>(command, undefined);
}
