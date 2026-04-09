import type { Project, ProjectFile } from "@/types/ui";

import { authenticatedFetch } from "./auth-adapter";
import { parseSSE } from "./sse-parser";
import {
  GatewayError,
  GatewayNotFoundError,
  type ApprovalDecision,
  type ChatEvent,
  type Conversation,
  type ConversationDetail,
  type ContextWindowWarning,
  type GatewayCredentialUpdateRequest,
  type GatewayCredentialUpdateResponse,
  type GatewayMemoryBackupRestoreRequest,
  type GatewayMemoryBackupRestoreResponse,
  type GatewayMemoryBackupRunResponse,
  type GatewayMemoryBackupSettingsUpdateRequest,
  type GatewayMigrationImportResult,
  type GatewayModelCatalog,
  type GatewayOnboardingStatus,
  type GatewaySkillBinding,
  type GatewaySkillSummary,
  type GatewaySettings,
} from "./types";

export const GATEWAY_BASE_URL = "/api";

type FileContentResponse = {
  content: string;
};

type ConversationListResponse = {
  conversations: Conversation[];
  total: number;
  limit: number;
  offset: number;
};

type SendMessageOptions = {
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
  onContextWarning?: (warning: ContextWindowWarning) => void;
};

type ErrorPayload = {
  code?: string;
  detail?: string;
  error?: string;
  message?: string;
};

type GatewayProject = {
  id: string;
  name: string;
  icon: string;
  conversation_id: string | null;
};

type ProjectListResponse = {
  projects: GatewayProject[];
};

type ProjectFileListResponse = {
  files: ProjectFile[];
};

type SkillListResponse = {
  skills: GatewaySkillSummary[];
};

type SkillBindingResponse = {
  skill_ids: string[];
  source?: "ui" | "slash" | "nl" | "api";
  conversation_id?: string;
  project_id?: string;
};

type ApprovalDecisionResponse = {
  request_id: string;
  decision: ApprovalDecision;
};

type ExportDownload = {
  fileName: string;
  blob: Blob;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUsage(value: unknown): value is { prompt_tokens: number; completion_tokens: number } {
  return (
    isRecord(value) &&
    typeof value.prompt_tokens === "number" &&
    typeof value.completion_tokens === "number"
  );
}

function isChatEvent(value: unknown): value is ChatEvent {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "text-delta":
      return typeof value.delta === "string";
    case "tool-call":
      return (
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        isRecord(value.input)
      );
    case "tool-result":
      return (
        typeof value.id === "string" &&
        (value.status === "ok" || value.status === "denied" || value.status === "error") &&
        "output" in value
      );
    case "approval-request":
      return (
        typeof value.request_id === "string" &&
        typeof value.tool_name === "string" &&
        typeof value.summary === "string"
      );
    case "approval-result":
      return (
        typeof value.request_id === "string" &&
        (value.decision === "approved" || value.decision === "denied")
      );
    case "error":
      return typeof value.code === "string" && typeof value.message === "string";
    case "done":
      return (
        typeof value.finish_reason === "string" &&
        (value.usage === undefined || isUsage(value.usage)) &&
        (value.conversation_id === undefined || typeof value.conversation_id === "string")
      );
    default:
      return false;
  }
}

async function readErrorPayload(response: Response): Promise<ErrorPayload | null> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return (await response.json()) as ErrorPayload;
  } catch {
    return null;
  }
}

async function toGatewayError(response: Response): Promise<GatewayError> {
  const payload = await readErrorPayload(response);
  const message =
    payload?.detail ??
    payload?.message ??
    payload?.error ??
    `Gateway request failed with status ${response.status}`;
  const code = payload?.code;

  if (response.status === 404) {
    return new GatewayNotFoundError(message, code);
  }

  return new GatewayError(message, response.status, code);
}

function toChatEvent(eventName: string, data: string): ChatEvent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(data);
  } catch {
    throw new GatewayError(`Malformed JSON for SSE event: ${eventName}`, 502, "invalid_sse");
  }

  const normalized = normalizeChatEventPayload(eventName, parsed);

  if (!isChatEvent(normalized)) {
    throw new GatewayError(`Invalid SSE payload for event: ${eventName}`, 502, "invalid_sse");
  }

  return normalized;
}

function normalizeChatEventPayload(eventName: string, parsed: unknown): unknown {
  if (!isRecord(parsed)) {
    return parsed;
  }

  const withType = typeof parsed.type === "string" ? parsed : { ...parsed, type: eventName };

  if (eventName === "text-delta" && typeof withType.delta !== "string" && typeof withType.content === "string") {
    return {
      ...withType,
      delta: withType.content,
    };
  }

  if (eventName === "tool-call" && !isRecord(withType.input) && isRecord(withType.arguments)) {
    return {
      ...withType,
      input: withType.arguments,
    };
  }

  if (eventName === "tool-result" && typeof withType.status !== "string" && "output" in withType) {
    return {
      ...withType,
      status: "error" in withType ? "error" : "ok",
    };
  }

  return withType;
}

function parseContextWindowWarning(headers: Headers): ContextWindowWarning | null {
  if (headers.get("x-context-window-warning") !== "1") {
    return null;
  }

  const estimatedTokens = Number.parseInt(headers.get("x-context-window-estimated-tokens") ?? "", 10);
  const budgetTokens = Number.parseInt(headers.get("x-context-window-budget-tokens") ?? "", 10);
  const ratio = Number.parseFloat(headers.get("x-context-window-ratio") ?? "");
  const threshold = Number.parseFloat(headers.get("x-context-window-threshold") ?? "");
  const managed = headers.get("x-context-window-managed") === "1";
  const message = headers.get("x-context-window-message") ?? "This session is getting long.";

  if (!Number.isFinite(estimatedTokens) || !Number.isFinite(budgetTokens) || !Number.isFinite(ratio)) {
    return null;
  }

  return {
    estimated_tokens: estimatedTokens,
    budget_tokens: budgetTokens,
    ratio,
    threshold: Number.isFinite(threshold) ? threshold : 0.8,
    managed,
    message,
  };
}

export async function* sendMessage(
  conversationId: string | null,
  content: string,
  options: SendMessageOptions = {}
): AsyncIterable<ChatEvent> {
  const headers: Record<string, string> = withLocalOwnerHeaders({
    "Content-Type": "application/json"
  });
  if (conversationId) {
    headers["x-conversation-id"] = conversationId;
  }

  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/message`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content,
      ...(options.metadata ? { metadata: options.metadata } : {})
    }),
    signal: options.signal
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const contextWarning = parseContextWindowWarning(response.headers);
  if (contextWarning) {
    options.onContextWarning?.(contextWarning);
  }

  for await (const event of parseSSE(response)) {
    yield toChatEvent(event.event, event.data);
  }
}

export async function listConversations(): Promise<Conversation[]> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/conversations`, {
    headers: withLocalOwnerHeaders(),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as ConversationListResponse;
  return payload.conversations;
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/conversations/${encodeURIComponent(id)}`,
    { headers: withLocalOwnerHeaders() }
  );

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as ConversationDetail;
}

export async function listProjects(): Promise<Project[]> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/projects`, {
    headers: withLocalOwnerHeaders(),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as ProjectListResponse;
  const projects = payload.projects ?? [];

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    icon: project.icon,
    conversationId: project.conversation_id
  }));
}

export async function listSkills(): Promise<GatewaySkillSummary[]> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/skills`, {
    headers: withLocalOwnerHeaders(),
  });
  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as SkillListResponse;
  return payload.skills ?? [];
}

export async function getConversationSkills(conversationId: string): Promise<string[]> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/conversations/${encodeURIComponent(conversationId)}/skills`,
    { headers: withLocalOwnerHeaders() }
  );
  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as SkillBindingResponse;
  return payload.skill_ids ?? [];
}

export async function updateConversationSkills(
  conversationId: string,
  skillIds: string[],
  source: GatewaySkillBinding["source"] = "ui"
): Promise<string[]> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/conversations/${encodeURIComponent(conversationId)}/skills`,
    {
      method: "PUT",
      headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        skill_ids: skillIds,
        source,
      }),
    }
  );
  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as SkillBindingResponse;
  return payload.skill_ids ?? [];
}

export async function getProjectSkills(projectId: string): Promise<string[]> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/projects/${encodeURIComponent(projectId)}/skills`,
    { headers: withLocalOwnerHeaders() }
  );
  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as SkillBindingResponse;
  return payload.skill_ids ?? [];
}

export async function updateProjectSkills(
  projectId: string,
  skillIds: string[],
  source: GatewaySkillBinding["source"] = "ui"
): Promise<string[]> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/projects/${encodeURIComponent(projectId)}/skills`,
    {
      method: "PUT",
      headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        skill_ids: skillIds,
        source,
      }),
    }
  );
  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as SkillBindingResponse;
  return payload.skill_ids ?? [];
}

export async function getProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/projects/${encodeURIComponent(projectId)}/files`,
    { headers: withLocalOwnerHeaders() }
  );

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as ProjectFileListResponse;
  return payload.files;
}

export async function readFileContent(projectId: string, filePath: string): Promise<string> {
  const params = new URLSearchParams({ path: filePath });
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/projects/${encodeURIComponent(projectId)}/file-content?${params.toString()}`,
    { headers: withLocalOwnerHeaders() }
  );

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as FileContentResponse;
  if (typeof payload.content !== "string") {
    throw new GatewayError("Invalid file content response", 502, "invalid_payload");
  }

  return payload.content;
}

export async function writeFileContent(
  projectId: string,
  filePath: string,
  content: string
): Promise<void> {
  const params = new URLSearchParams({ path: filePath });
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/projects/${encodeURIComponent(projectId)}/file-content?${params.toString()}`,
    {
      method: "PUT",
      headers: withLocalOwnerHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({ content })
    }
  );

  if (!response.ok) {
    throw await toGatewayError(response);
  }
}

export async function createProject(name: string, icon = "folder"): Promise<Project> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/projects`, {
    method: "POST",
    headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name, icon })
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const project = (await response.json()) as GatewayProject;

  return {
    id: project.id,
    name: project.name,
    icon: project.icon,
    conversationId: project.conversation_id
  };
}

export async function renameProject(id: string, name: string): Promise<void> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/projects/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name })
    }
  );

  if (!response.ok) {
    throw await toGatewayError(response);
  }
}

export async function deleteProject(id: string): Promise<void> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/projects/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: withLocalOwnerHeaders() }
  );

  if (!response.ok) {
    throw await toGatewayError(response);
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/conversations/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: withLocalOwnerHeaders(),
    }
  );

  if (!response.ok) {
    throw await toGatewayError(response);
  }
}

export async function submitApprovalDecision(
  requestId: string,
  decision: ApprovalDecision
): Promise<ApprovalDecisionResponse> {
  const response = await authenticatedFetch(
    `${GATEWAY_BASE_URL}/approvals/${encodeURIComponent(requestId)}`,
    {
      method: "POST",
      headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ decision }),
    }
  );

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as ApprovalDecisionResponse;
}

export async function getSettings(): Promise<GatewaySettings> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings`, {
    headers: withLocalOwnerHeaders(),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as GatewaySettings;
}

export async function updateSettings(
  patch: Partial<Pick<GatewaySettings, "default_model" | "active_provider_profile">> & {
    provider_base_url?: { provider_profile: string; base_url: string };
  }
): Promise<GatewaySettings> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings`, {
    method: "PUT",
    headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as GatewaySettings;
}

export async function updateMemoryBackupSettings(
  payload: GatewayMemoryBackupSettingsUpdateRequest
): Promise<GatewaySettings> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings/memory-backup`, {
    method: "PUT",
    headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as GatewaySettings;
}

export async function runMemoryBackupNow(): Promise<GatewayMemoryBackupRunResponse> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings/memory-backup/save`, {
    method: "POST",
    headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as GatewayMemoryBackupRunResponse;
}

export async function restoreMemoryBackup(
  payload: GatewayMemoryBackupRestoreRequest = {}
): Promise<GatewayMemoryBackupRestoreResponse> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings/memory-backup/restore`, {
    method: "POST",
    headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as GatewayMemoryBackupRestoreResponse;
}

export async function getOwnerProfile(): Promise<string | null> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/profile`, {
    headers: withLocalOwnerHeaders(),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as { content: string | null };
  return payload.content;
}

export async function updateOwnerProfile(content: string): Promise<void> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/profile`, {
    method: "PUT",
    headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }
}

export async function getOnboardingStatus(): Promise<GatewayOnboardingStatus> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings/onboarding-status`, {
    headers: withLocalOwnerHeaders(),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as GatewayOnboardingStatus;
}

export async function updateProviderCredential(
  payload: GatewayCredentialUpdateRequest
): Promise<GatewayCredentialUpdateResponse> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings/credentials`, {
    method: "PUT",
    headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as GatewayCredentialUpdateResponse;
}

export async function getProviderModels(
  providerProfile?: string
): Promise<GatewayModelCatalog> {
  const query = providerProfile && providerProfile.trim().length > 0
    ? `?provider_profile=${encodeURIComponent(providerProfile)}`
    : "";
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings/models${query}`, {
    headers: withLocalOwnerHeaders(),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as GatewayModelCatalog;
}

export type PullProgressCallback = (progress: {
  status: string;
  total?: number;
  completed?: number;
}) => void;

export async function pullProviderModel(
  model: string,
  providerProfile?: string,
  onProgress?: PullProgressCallback
): Promise<void> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings/models/pull`, {
    method: "POST",
    headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model,
      ...(providerProfile ? { provider_profile: providerProfile } : {}),
    }),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed = JSON.parse(trimmed) as { status?: string; total?: number; completed?: number };
        onProgress?.({
          status: parsed.status ?? "",
          total: parsed.total,
          completed: parsed.completed,
        });
      } catch {
        // skip malformed lines
      }
    }
  }

  if (buffer.trim().length > 0) {
    try {
      const parsed = JSON.parse(buffer.trim()) as { status?: string; total?: number; completed?: number };
      onProgress?.({
        status: parsed.status ?? "",
        total: parsed.total,
        completed: parsed.completed,
      });
    } catch {
      // skip
    }
  }
}

export async function deleteProviderModel(
  model: string,
  providerProfile?: string
): Promise<void> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/settings/models/delete`, {
    method: "POST",
    headers: withLocalOwnerHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model,
      ...(providerProfile ? { provider_profile: providerProfile } : {}),
    }),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }
}

export async function downloadLibraryExport(): Promise<ExportDownload> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/export`, {
    headers: withLocalOwnerHeaders(),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const fileName = extractExportFilename(response.headers.get("content-disposition"));
  const blob = await response.blob();
  return {
    fileName,
    blob,
  };
}

export async function importLibraryArchive(file: Blob): Promise<GatewayMigrationImportResult> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/migration/import`, {
    method: "POST",
    headers: withLocalOwnerHeaders({
      "Content-Type": "application/gzip",
    }),
    body: file,
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  return (await response.json()) as GatewayMigrationImportResult;
}

function extractExportFilename(contentDisposition: string | null): string {
  if (!contentDisposition) {
    return `memory-export-${Date.now()}.tar.gz`;
  }

  const quoted = /filename="([^"]+)"/i.exec(contentDisposition);
  if (quoted?.[1]) {
    return quoted[1];
  }

  const plain = /filename=([^;]+)/i.exec(contentDisposition);
  if (plain?.[1]) {
    return plain[1].trim();
  }

  return `memory-export-${Date.now()}.tar.gz`;
}

function withLocalOwnerHeaders(headers?: Record<string, string>): Record<string, string> {
  return {
    ...(headers ?? {}),
  };
}

// --- Managed mode account API ---

export type AccountInfo = {
  email: string;
  username: string;
  subscription_status: string;
  litellm_spend_dollars: number;
  litellm_budget_dollars: number;
  credits_remaining_dollars: number;
  credits_exhausted: boolean;
  created_at: string | null;
  password_changed_at: string | null;
  subscription_renewal_date: string | null;
  cancel_at_period_end: boolean;
  topup_total_dollars: number;
  topup_available: boolean;
};

export async function getAccount(): Promise<AccountInfo> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/account`);
  if (!response.ok) {
    throw await toGatewayError(response);
  }
  return (await response.json()) as AccountInfo;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/account/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!response.ok) {
    throw await toGatewayError(response);
  }
}

export async function changeEmail(
  newEmail: string,
  currentPassword: string
): Promise<void> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/account/change-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_email: newEmail, current_password: currentPassword }),
  });
  if (!response.ok) {
    throw await toGatewayError(response);
  }
}

export async function deleteAccount(
  currentPassword: string,
  confirmation: string
): Promise<void> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/account`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, confirmation }),
  });
  if (!response.ok) {
    throw await toGatewayError(response);
  }
}

export async function createPortalSession(): Promise<string> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/account/portal-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw await toGatewayError(response);
  }
  const data = (await response.json()) as { portal_url: string };
  return data.portal_url;
}

export async function createTopupSession(amountCents: number): Promise<string> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/account/topup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount_cents: amountCents }),
  });
  if (!response.ok) {
    throw await toGatewayError(response);
  }
  const data = (await response.json()) as { checkout_url: string };
  return data.checkout_url;
}

export {
  GatewayError,
  GatewayNotFoundError,
  type ChatEvent,
  type Conversation,
  type ConversationDetail,
  type GatewayCredentialUpdateResponse,
  type GatewayModelCatalog,
  type GatewayOnboardingStatus,
  type GatewaySettings
};

