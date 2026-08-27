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

export type AppPresentationProfileSummary =
  | {
      profile_version: 1;
      presentation_id: string;
      type: "surface";
      label: string;
      description: string;
      resource_uri: string;
      owner_visibility: "primary" | "secondary" | "internal";
    }
  | {
      profile_version: 1;
      presentation_id: string;
      type: "chat_workspace";
      label: string;
      description: string;
      workspace_id: string;
      owner_visibility: "primary" | "secondary" | "internal";
    };

export type AppPresentationSetSummary = {
  presentation_set_version: 1;
  default_presentation_id: string;
  profiles: AppPresentationProfileSummary[];
};

export type AppStatus = {
  contract_version: 1;
  identity: {
    app_id: string;
    display_name: string;
    publisher_id: string;
    publisher_name: string;
    installation_id: string | null;
    package_digest: string | null;
  };
  state: AppLifecycleState;
  generation: number;
  version: { installed: string | null; available: string };
  trust: { status: "verified" | "not_verified" | "quarantined"; policy_version: 1; signing_key_id: string | null; checked_at: string | null; revocation_status: string };
  route_key: string;
  source: { kind: "repository_fixture"; label: string };
  compatibility: { host: boolean | null; app_contract: number | null; mcp_protocol: string | null; data_schema: { read_min: number; read_max: number; write_version: number } | null };
  capabilities: { requested: string[]; granted: string[] };
  retention: {
    owner_data_preserved: true;
    retained_data_present: boolean | null;
    compatibility: "not_inspected" | "missing" | "ready" | "incompatible" | "repair_required";
    safe_message: string;
    uninstall_removes: string[];
    uninstall_retains: string[];
  };
  progress: AppLifecycleOperationView | null;
  recovery: { available: boolean; action: string };
  catalog?: {
    summary: string;
    icon: { package_path: string; media_type: "image/png" | "image/webp"; content_digest: string } | null;
    retention_summary: string;
    primary_resource_uri: string;
    provenance: "verified_first_party_package" | "host_registration";
    presentations?: AppPresentationSetSummary | null;
  } | null;
  availability?: {
    status: "available" | "unavailable";
    package_digest: string | null;
    error_code: string | null;
    safe_message: string | null;
  };
  available_actions: string[];
  updated_at: string;
  request_resolution?: "confirmed_response" | "refreshed_after_ambiguous_response";
};

export type AppCatalog = { catalog_version: 1; apps: AppStatus[] };

export type AppSurfaceLaunch = {
  launch_version: 1;
  kind?: "surface";
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

export type AppWorkspaceDocumentDescriptor = {
  document_version: 1;
  document_id: string;
  role: "conversation" | "source_document" | "derived_document" | "advanced_resource" | "recovery";
  title: string;
  description: string;
  editable: boolean;
  default_visibility: "primary" | "secondary" | "advanced";
  model_access: "none" | "read_reference" | "read_write_draft" | "action_result";
  resource_id: string | null;
  data_binding_id: string | null;
};

export type AppResourceDescriptor = {
  resource_version: 1;
  resource_id: string;
  role: "agent_instructions" | "interview_guide" | "quality_standard" | "template_standard" | "recovery_guidance" | "owner_reference";
  title: string;
  description: string;
  package_path: string;
  media_type: "text/markdown" | "text/plain" | "application/json";
  content_digest: `sha256:${string}`;
  owner_editable: boolean;
  prompt_inclusion: "never" | "workspace_start" | "document_open" | "action_request";
};

export type AppActionDescriptor = {
  action_version: 1;
  action_id: string;
  kind: "read" | "write" | "render" | "export" | "recover" | "inspect";
  title: string;
  description: string;
  input_schema_id: string;
  result_schema_id: string;
  confirmation: "none" | "owner_confirmation" | "trusted_owner_confirmation";
  idempotency_policy: "not_applicable" | "optional" | "required";
  model_exposure: "hidden" | "available";
};

export type AppChatContextProjection = {
  context_projection_set_version: 1;
  context_grant_set_digest: `sha256:${string}`;
  items: Array<
    | {
        context_projection_version: 1;
        context_id: string;
        kind: "career_context" | "owner_profile" | "workspace_context" | "app_state";
        state: "available";
        required: boolean;
        byte_length: number;
        content_digest: `sha256:${string}`;
        content: unknown;
      }
    | {
        context_projection_version: 1;
        context_id: string;
        kind: "career_context" | "owner_profile" | "workspace_context" | "app_state";
        state: "unavailable";
        required: boolean;
        reason: "not_granted" | "unsupported" | "too_large";
      }
  >;
};

export type AppChatWorkspaceLaunch = {
  launch_version: 1;
  kind: "chat_workspace";
  session: {
    session_id: string;
    view_id: string;
    operation_id: string;
    session_generation: number;
    owner_id: string;
    account_id: string;
    actor_id: string;
    app_id: string;
    publisher_id: string;
    installation_id: string;
    package_digest: `sha256:${string}`;
    lifecycle_generation: number;
    grant_id: string;
    grant_revision: number;
    revocation_generation: number;
    presentation_id: string;
    workspace_id: string;
    context_grant_set_digest: `sha256:${string}`;
    created_at: string;
    expires_at: string;
  };
  resumed: boolean;
  workspace: {
    workspace_version: 1;
    workspace_id: string;
    title: string;
    description: string;
    default_document_id: string;
    documents: AppWorkspaceDocumentDescriptor[];
    resources: AppResourceDescriptor[];
    actions: AppActionDescriptor[];
  };
  presentation: Extract<AppPresentationProfileSummary, { type: "chat_workspace" }>;
  context: AppChatContextProjection;
};

export type AppLaunch = AppSurfaceLaunch | AppChatWorkspaceLaunch;

export type OwnerSafeAppDataState = {
  state_version: 1;
  state: "ready" | "review_needed" | "conflict" | "cancelled" | "incompatible" | "recoverable_failure" | "unavailable";
  safe_message: string;
  retryable: boolean;
  refresh_required: boolean;
  current_revision: number | null;
  proposal_preserved: boolean;
};

export type HostConfirmationPresentation = {
  title: string;
  actionLabel: string;
};

export type AppSafeRecoveryMetadata = Record<string, string | number | boolean | Array<string | number | boolean>>;

export type AppSafeErrorEnvelope = {
  code: string;
  safe_message: string;
  retryable: boolean;
  correlation_id?: string;
  operation_id?: string;
  attempt_count?: number;
  completion_mode?: string;
  app_issue_ids?: string[];
  recovery_metadata?: AppSafeRecoveryMetadata;
  owner_state: OwnerSafeAppDataState;
};

export type AppCapabilityErrorMetadata = {
  retryable?: boolean;
  correlationId?: string | null;
  operationId?: string | null;
  attemptCount?: number | null;
  completionMode?: string | null;
  appIssueIds?: string[];
  recoveryMetadata?: AppSafeRecoveryMetadata | null;
};

export class AppCapabilityError extends GatewayError {
  readonly retryable: boolean;
  readonly correlationId: string | null;
  readonly operationId: string | null;
  readonly attemptCount: number | null;
  readonly completionMode: string | null;
  readonly appIssueIds: string[];
  readonly recoveryMetadata: AppSafeRecoveryMetadata | null;

  constructor(
    message: string,
    status: number,
    code: string,
    public readonly ownerState: OwnerSafeAppDataState,
    public readonly capability: string,
    public readonly confirmation: HostConfirmationPresentation | null,
    metadata: AppCapabilityErrorMetadata = {},
  ) {
    super(message, status, code);
    this.name = "AppCapabilityError";
    this.retryable = metadata.retryable === true;
    this.correlationId = safeUuid(metadata.correlationId);
    this.operationId = safeUuid(metadata.operationId);
    this.attemptCount = safeAttemptCount(metadata.attemptCount);
    this.completionMode = safeCompletionMode(metadata.completionMode);
    this.appIssueIds = safeAppIssueIds(metadata.appIssueIds);
    this.recoveryMetadata = safeRecoveryMetadata(metadata.recoveryMetadata);
  }

  get safeEnvelope(): AppSafeErrorEnvelope {
    return {
      code: this.code ?? "recoverable_internal_failure",
      safe_message: this.message,
      retryable: this.retryable,
      ...(this.correlationId ? { correlation_id: this.correlationId } : {}),
      ...(this.operationId ? { operation_id: this.operationId } : {}),
      ...(this.attemptCount !== null ? { attempt_count: this.attemptCount } : {}),
      ...(this.completionMode ? { completion_mode: this.completionMode } : {}),
      ...(this.appIssueIds.length > 0 ? { app_issue_ids: this.appIssueIds } : {}),
      ...(this.recoveryMetadata ? { recovery_metadata: this.recoveryMetadata } : {}),
      owner_state: this.ownerState,
    };
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

function appPath(appKey: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appKey) || appKey.length > 64) throw new Error("Invalid app key");
  return `/apps/${encodeURIComponent(appKey)}`;
}

export function getApp(appKey: string): Promise<AppStatus> {
  return requestJson(`${appPath(appKey)}/status`);
}

export function getAppCatalog(): Promise<AppCatalog> {
  return requestJson("/apps");
}

export function inspectApp(appKey: string): Promise<AppStatus> {
  return requestJson(`${appPath(appKey)}/inspect`);
}

export async function mutateApp(appKey: string, action: AppLifecycleAction, current: AppStatus, operationId = secureRandomUuid()): Promise<AppStatus> {
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
    const confirmed = await requestJson<AppStatus>(`${appPath(appKey)}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ...confirmed, request_resolution: "confirmed_response" };
  } catch (failure) {
    try {
      const refreshed = await getApp(appKey);
      const operationObserved = refreshed.progress?.operation_id === operationId;
      const stateChanged = refreshed.generation !== current.generation;
      if (operationObserved || stateChanged) return { ...refreshed, request_resolution: "refreshed_after_ambiguous_response" };
    } catch { /* preserve the original safe failure */ }
    throw failure;
  }
}

export function launchApp(appKey: string, entryPoint: "direct" | "career" = "direct", resume?: AppSurfaceLaunch): Promise<AppSurfaceLaunch> {
  return requestJson(`${appPath(appKey)}/launch`, {
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

export function launchAppChatWorkspace(
  appKey: string,
  input: {
    presentationId?: string;
    workspaceId?: string;
    resume?: AppChatWorkspaceLaunch;
  } = {},
): Promise<AppChatWorkspaceLaunch> {
  return requestJson(`${appPath(appKey)}/chat-workspaces/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(input.presentationId ? { presentation_id: input.presentationId } : {}),
      ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
      ...(input.resume ? {
        resume: {
          session_id: input.resume.session.session_id,
          view_id: input.resume.session.view_id,
          operation_id: input.resume.session.operation_id,
          session_generation: input.resume.session.session_generation,
        },
      } : {}),
    }),
  });
}

export function callAppCapability(appKey: string, capability: string, input: unknown, operationId: string, ownerConfirmed = false): Promise<{ result: unknown }> {
  return requestCapabilityJson(`${appPath(appKey)}/data/call`, capability, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability, operation_id: operationId, input, owner_confirmed: ownerConfirmed }),
  });
}

async function requestCapabilityJson<T>(path: string, capability: string, init: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}${path}`, init);
  if (!response.ok) {
    try {
      const payload = await response.json() as {
        owner_state?: OwnerSafeAppDataState;
        error?: {
          code?: string;
          safe_message?: string;
          retryable?: boolean;
          correlation_id?: string;
          operation_id?: string;
          attempt_count?: number;
          completion_mode?: string;
          app_issue_ids?: unknown;
          recovery_metadata?: unknown;
          confirmation?: { capability?: string; title?: string; action_label?: string };
        };
      };
      if (payload.error?.code && payload.error.safe_message && payload.owner_state) {
        const projection = payload.error.confirmation;
        const confirmation = projection?.capability === capability && typeof projection.title === "string" && typeof projection.action_label === "string"
          ? { title: projection.title, actionLabel: projection.action_label }
          : null;
        throw new AppCapabilityError(payload.error.safe_message, response.status, payload.error.code, payload.owner_state, capability, confirmation, {
          retryable: payload.error.retryable === true,
          correlationId: safeUuid(payload.error.correlation_id),
          operationId: safeUuid(payload.error.operation_id),
          attemptCount: safeAttemptCount(payload.error.attempt_count),
          completionMode: safeCompletionMode(payload.error.completion_mode),
          appIssueIds: safeAppIssueIds(payload.error.app_issue_ids),
          recoveryMetadata: safeRecoveryMetadata(payload.error.recovery_metadata),
        });
      }
    } catch (error) {
      if (error instanceof AppCapabilityError) throw error;
    }
    throw new GatewayError(`App request failed with status ${response.status}`, response.status, "recoverable_internal_failure");
  }
  return await response.json() as T;
}

const SAFE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_APP_ISSUE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\/[a-z][a-z0-9-]*$/;
const SAFE_COMPLETION_MODES = new Set(["none", "provider", "provider_generated", "deterministic_fallback", "conservative_fallback", "safe_failure"]);
const SAFE_RECOVERY_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_RECOVERY_STRING = /^[a-z0-9][a-z0-9_.:-]{0,127}$/i;
const FORBIDDEN_RECOVERY_KEY = /(^|_)(content|body|text|prompt|completion|document|description|source|path|destination|authorization|credential|api_key|token|secret|permission)(_|$)/i;

function safeUuid(value: unknown): string | null {
  return typeof value === "string" && SAFE_UUID.test(value) ? value : null;
}

function safeAttemptCount(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2 ? Number(value) : null;
}

function safeCompletionMode(value: unknown): string | null {
  return typeof value === "string" && SAFE_COMPLETION_MODES.has(value) ? value : null;
}

function safeAppIssueIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20 || value.some((candidate) => typeof candidate !== "string" || candidate.length > 160 || !SAFE_APP_ISSUE_ID.test(candidate))) return [];
  return [...new Set(value)];
}

function safeRecoveryMetadata(value: unknown): AppSafeRecoveryMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 16) return null;
  const safeScalar = (candidate: unknown): candidate is string | number | boolean => (
    typeof candidate === "boolean"
    || (Number.isInteger(candidate) && Math.abs(Number(candidate)) <= 1_000_000)
    || (typeof candidate === "string" && SAFE_RECOVERY_STRING.test(candidate))
  );
  for (const [key, candidate] of entries) {
    if (!SAFE_RECOVERY_KEY.test(key) || FORBIDDEN_RECOVERY_KEY.test(key)) return null;
    if (Array.isArray(candidate)) {
      if (candidate.length > 20 || !candidate.every(safeScalar)) return null;
    } else if (!safeScalar(candidate)) return null;
  }
  return JSON.stringify(value).length <= 4_096 ? value as AppSafeRecoveryMetadata : null;
}

export async function closeAppSession(appKey: string, sessionId: string): Promise<void> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}${appPath(appKey)}/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new GatewayError("Unable to close app session", response.status);
}

export function readAppChatWorkspaceSession(appKey: string, sessionId: string): Promise<AppChatWorkspaceLaunch["session"]> {
  return requestJson(`${appPath(appKey)}/chat-workspaces/sessions/${encodeURIComponent(sessionId)}`);
}

export function sendAppBridgeMessage(appKey: string, sessionId: string, message: unknown): Promise<unknown> {
  return requestJson(`${appPath(appKey)}/bridge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, origin: "null", source: "sandbox_iframe", message }),
  });
}

export function sendAppAppsBridgeMessage(appKey: string, launch: AppSurfaceLaunch, message: unknown, signal?: AbortSignal): Promise<unknown> {
  const operationId = secureRandomUuid();
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  const cancel = () => {
    void authenticatedFetch(`${GATEWAY_BASE_URL}${appPath(appKey)}/sessions/${encodeURIComponent(launch.session_id)}/requests/${operationId}`, { method: "DELETE" });
  };
  signal?.addEventListener("abort", cancel, { once: true });
  return requestJson(`${appPath(appKey)}/apps-bridge`, {
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
  return finalizeAppExport("resume-builder", input);
}

export function finalizeAppExport(appKey: string, input: {
  artifact_revision_id: string;
  artifact_digest: string;
  safe_destination_label: string;
  outcome: "completed" | "cancelled" | "failed";
}): Promise<{ receipt_revision_id: string; safe_destination_label: string; outcome: string }> {
  return requestJson(`${appPath(appKey)}/exports/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation_id: secureRandomUuid(), ...input }),
  });
}
