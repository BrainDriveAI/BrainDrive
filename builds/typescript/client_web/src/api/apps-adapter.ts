import { authenticatedFetch } from "./auth-adapter";
import { GATEWAY_BASE_URL } from "./gateway-adapter";
import { GatewayError } from "./types";
import { secureRandomUuid } from "@/utils/browser-crypto";

export type AppLifecycleState = "not_installed" | "staged" | "active" | "disabled" | "updating" | "rollback_pending" | "uninstalling" | "quarantined" | "failed_recoverable";

export type AppLifecycleAction = "install" | "reinstall" | "update" | "disable" | "enable" | "rollback" | "uninstall" | "recover";

export type AppLifecycleOperationView = {
  operation_version: 1;
  operation_id: string;
  installation_id: string;
  kind: AppLifecycleAction | "quarantine" | "reconcile";
  status: "accepted" | "running" | "cancel_requested" | "committed" | "cancelled_before_commit" | "failed";
  stage: string;
  completed_stages: string[];
  commit_outcome: "not_committed" | "committed" | "committed_response_recovered" | "rolled_back_before_commit";
  prior_state: AppLifecycleState;
  target_state: AppLifecycleState;
  result_state: AppLifecycleState | null;
  error_code: string | null;
  recovery_action: string;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ResumeBuilderAppStatus = {
  contract_version: 1;
  identity: {
    app_id: "ai.braindrive.resume-builder";
    display_name: "Resume Builder";
    publisher_id: "ai.braindrive";
    publisher_name: "BrainDrive";
    installation_id: string | null;
    package_digest: string | null;
  };
  state: AppLifecycleState;
  generation: number;
  version: { installed: string | null; available: string };
  trust: { status: "verified" | "not_verified" | "quarantined"; policy_version: 1; signing_key_id: string | null; checked_at: string | null; revocation_status: string };
  source: { kind: "repository_fixture"; label: string };
  compatibility: { host: boolean | null; app_contract: 1; mcp_protocol: string; data_schema: { read_min: number; read_max: number; write_version: number } };
  capabilities: { requested: string[]; granted: string[] };
  retention: {
    owner_data_preserved: true;
    retained_data_present: boolean;
    compatibility: "missing" | "ready" | "incompatible" | "repair_required";
    safe_message: string;
    uninstall_removes: string[];
    uninstall_retains: string[];
  };
  progress: AppLifecycleOperationView | null;
  recovery: { available: boolean; action: string };
  updated_at: string;
  request_resolution?: "confirmed_response" | "refreshed_after_ambiguous_response";
};

export type AppCatalog = { catalog_version: 1; apps: ResumeBuilderAppStatus[] };

export type AppLaunch = {
  launch_version: 1;
  session_id: string;
  installation_id: string;
  view_id: string;
  operation_id: string;
  bridge_generation: number;
  resumed: boolean;
  bridge_token_id: string;
  server_id: string;
  expires_at: string;
  protocol: { core: string; apps_extension: string; server_name: string; server_version: string };
  resource: {
    uri: string;
    mime_type: "text/html;profile=mcp-app";
    content_digest: string;
    size_bytes: number;
    html: string;
  };
  allowed_tools: string[];
  allowed_capabilities: string[];
  entry_point: "direct" | "career";
};

export type OwnerSafeResumeDataState = {
  state_version: 1;
  state: "ready" | "review_needed" | "conflict" | "cancelled" | "incompatible" | "recoverable_failure";
  safe_message: string;
  retryable: boolean;
  refresh_required: boolean;
  current_revision: number | null;
  proposal_preserved: boolean;
};

export class ResumeCapabilityError extends GatewayError {
  constructor(
    message: string,
    status: number,
    code: string,
    public readonly ownerState: OwnerSafeResumeDataState,
  ) {
    super(message, status, code);
    this.name = "ResumeCapabilityError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}${path}`, init);
  if (!response.ok) {
    let message = `App request failed with status ${response.status}`;
    try { message = ((await response.json()) as { error?: string }).error ?? message; } catch { /* safe fallback */ }
    throw new GatewayError(message, response.status, message);
  }
  return (await response.json()) as T;
}

export function getResumeBuilderApp(): Promise<ResumeBuilderAppStatus> {
  return requestJson("/apps/resume-builder/status");
}

export function getAppCatalog(): Promise<AppCatalog> {
  return requestJson("/apps");
}

export function inspectResumeBuilderApp(): Promise<ResumeBuilderAppStatus> {
  return requestJson("/apps/resume-builder/inspect");
}

export async function mutateResumeBuilderApp(action: AppLifecycleAction, current: ResumeBuilderAppStatus, operationId = secureRandomUuid()): Promise<ResumeBuilderAppStatus> {
  const packageAction = action === "install" || action === "reinstall" || action === "update";
  const body = {
    operation_id: operationId,
    idempotency_key: operationId,
    expected_generation: current.generation,
    installation_id: action === "install" || action === "reinstall" ? null : current.identity.installation_id,
    ...(packageAction ? { version: current.version.available, approve_capabilities: true } : {}),
    ...(action === "uninstall" ? { confirm_retained_data: true } : {}),
  };
  try {
    const confirmed = await requestJson<ResumeBuilderAppStatus>(`/apps/resume-builder/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ...confirmed, request_resolution: "confirmed_response" };
  } catch (failure) {
    try {
      const refreshed = await getResumeBuilderApp();
      const operationObserved = refreshed.progress?.operation_id === operationId;
      const stateChanged = refreshed.generation !== current.generation;
      if (operationObserved || stateChanged) return { ...refreshed, request_resolution: "refreshed_after_ambiguous_response" };
    } catch { /* preserve the original safe failure */ }
    throw failure;
  }
}

export function launchResumeBuilderApp(entryPoint: "direct" | "career" = "direct", resume?: AppLaunch): Promise<AppLaunch> {
  return requestJson("/apps/resume-builder/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      entry_point: entryPoint,
      ...(resume ? {
        resume: {
          session_id: resume.session_id,
          view_id: resume.view_id,
          operation_id: resume.operation_id,
          bridge_generation: resume.bridge_generation,
        },
      } : {}),
    }),
  });
}

export function callResumeBuilderCapability(capability: string, input: unknown, operationId: string, ownerConfirmed = false): Promise<{ result: unknown }> {
  return requestCapabilityJson("/apps/resume-builder/data/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability, operation_id: operationId, input, owner_confirmed: ownerConfirmed }),
  });
}

async function requestCapabilityJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}${path}`, init);
  if (!response.ok) {
    try {
      const payload = await response.json() as {
        error?: { code?: string; safe_message?: string };
        owner_state?: OwnerSafeResumeDataState;
      };
      if (payload.error?.code && payload.error.safe_message && payload.owner_state) {
        throw new ResumeCapabilityError(payload.error.safe_message, response.status, payload.error.code, payload.owner_state);
      }
    } catch (error) {
      if (error instanceof ResumeCapabilityError) throw error;
    }
    throw new GatewayError(`App request failed with status ${response.status}`, response.status, "recoverable_internal_failure");
  }
  return await response.json() as T;
}

export async function closeResumeBuilderSession(sessionId: string): Promise<void> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/apps/resume-builder/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new GatewayError("Unable to close app session", response.status);
}

export function sendResumeBuilderBridgeMessage(sessionId: string, message: unknown): Promise<unknown> {
  return requestJson("/apps/resume-builder/bridge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, origin: "null", source: "sandbox_iframe", message }),
  });
}

export function sendResumeBuilderAppsBridgeMessage(launch: AppLaunch, message: unknown, signal?: AbortSignal): Promise<unknown> {
  const operationId = secureRandomUuid();
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  const cancel = () => {
    void authenticatedFetch(`${GATEWAY_BASE_URL}/apps/resume-builder/sessions/${encodeURIComponent(launch.session_id)}/requests/${operationId}`, { method: "DELETE" });
  };
  signal?.addEventListener("abort", cancel, { once: true });
  return requestJson("/apps/resume-builder/apps-bridge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      session_id: launch.session_id,
      envelope: {
        bridge_envelope_version: 1,
        message_id: operationId,
        installation_id: launch.installation_id,
        view_id: launch.view_id,
        operation_id: launch.operation_id,
        bridge_generation: launch.bridge_generation,
        direction: "app_to_host",
        provenance: { source_window_match: true, opaque_origin: "null", same_server_id: launch.server_id },
        sent_at: new Date().toISOString(),
        message,
      },
    }),
  }).finally(() => signal?.removeEventListener("abort", cancel));
}

export function finalizeResumeBuilderExport(input: {
  artifact_revision_id: string;
  artifact_digest: string;
  safe_destination_label: string;
  outcome: "completed" | "cancelled" | "failed";
}): Promise<{ receipt_revision_id: string; safe_destination_label: string; outcome: string }> {
  return requestJson("/apps/resume-builder/exports/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation_id: secureRandomUuid(), ...input }),
  });
}
