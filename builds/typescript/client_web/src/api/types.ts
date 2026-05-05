export type GatewayMessageRole = "system" | "user" | "assistant" | "tool";

export type GatewayToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type GatewayMessage = {
  role: GatewayMessageRole;
  content: string;
  tool_calls?: GatewayToolCall[];
  tool_call_id?: string;
};

export type Conversation = {
  id: string;
  title?: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type ConversationDetail = {
  id: string;
  title?: string | null;
  created_at: string;
  updated_at: string;
  messages: Array<
    GatewayMessage & {
      id?: string;
      timestamp?: string;
    }
  >;
};

type BaseChatEvent = {
  conversation_id?: string;
};

export type TextDeltaEvent = BaseChatEvent & {
  type: "text-delta";
  delta: string;
};

export type ToolCallEvent = BaseChatEvent & {
  type: "tool-call";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultEvent = BaseChatEvent & {
  type: "tool-result";
  id: string;
  status: "ok" | "denied" | "error";
  output: unknown;
};

export type ApprovalRequestEvent = BaseChatEvent & {
  type: "approval-request";
  request_id: string;
  tool_name: string;
  summary: string;
};

export type ApprovalResultEvent = BaseChatEvent & {
  type: "approval-result";
  request_id: string;
  decision: "approved" | "denied";
};

export type ChatErrorEvent = BaseChatEvent & {
  type: "error";
  code: string;
  message: string;
};

export type DoneEvent = BaseChatEvent & {
  type: "done";
  finish_reason: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
};

export type ChatEvent =
  | TextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | ApprovalResultEvent
  | ChatErrorEvent
  | DoneEvent;

export type ContextWindowWarning = {
  estimated_tokens: number;
  budget_tokens: number;
  ratio: number;
  threshold: number;
  managed: boolean;
  message: string;
};

export type ApprovalDecision = "approved" | "denied";
export type ApprovalMode = "ask-on-write" | "auto-approve";

export type PendingApproval = {
  requestId: string;
  toolName: string;
  summary: string;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  type: "tool-call" | "tool-result" | "approval-request" | "approval-result";
  message: string;
  createdAt: string;
  status?: "ok" | "error" | "denied" | "approved";
};

export type Session = {
  mode: "local";
  user: {
    id: string;
    name: string;
    initials: string;
    email: string;
    role: "owner";
  };
};

export type GatewayProviderProfile = {
  id: string;
  provider_id: string;
  base_url: string;
  model: string;
  credential_mode: "plain" | "secret_ref" | "unset";
  credential_ref: string | null;
};

export type GatewayMemoryBackupFrequency = "manual" | "after_changes" | "hourly" | "daily";

export type GatewayMemoryBackupSettings = {
  repository_url: string;
  frequency: GatewayMemoryBackupFrequency;
  token_configured: boolean;
  last_save_at?: string;
  last_attempt_at?: string;
  last_result: "never" | "success" | "failed";
  last_error: string | null;
};

export type GatewayMemoryBackupSettingsUpdateRequest = {
  repository_url: string;
  frequency: GatewayMemoryBackupFrequency;
  git_token?: string;
  token_secret_ref?: string;
};

export type GatewayMemoryBackupRunResult = {
  attempted_at: string;
  saved_at?: string;
  result: "success" | "failed" | "noop";
  message?: string;
};

export type GatewayMemoryBackupRestoreRequest = {
  target_commit?: string;
};

export type GatewayMemoryBackupRestoreResult = {
  attempted_at: string;
  restored_at: string;
  commit: string;
  source_branch: string;
  warnings: string[];
};

export type GatewayMemoryBackupRunResponse = {
  result: GatewayMemoryBackupRunResult;
  settings: GatewaySettings;
};

export type GatewayMemoryBackupRestoreResponse = {
  result: GatewayMemoryBackupRestoreResult;
  settings: GatewaySettings;
  logout_required?: boolean;
};

export type GatewaySettings = {
  default_model: string;
  approval_mode: ApprovalMode;
  active_provider_profile: string | null;
  default_provider_profile: string | null;
  available_models: string[];
  provider_profiles: GatewayProviderProfile[];
  memory_backup: GatewayMemoryBackupSettings | null;
};

export type GatewayOnboardingProvider = {
  profile_id: string;
  provider_id: string;
  credential_mode: "plain" | "secret_ref" | "unset";
  credential_ref: string | null;
  requires_secret: boolean;
  credential_resolved: boolean;
  resolution_source: "env_ref" | "vault" | "none";
  resolution_error: string | null;
};

export type GatewayOnboardingStatus = {
  onboarding_required: boolean;
  active_provider_profile: string | null;
  default_provider_profile: string | null;
  providers: GatewayOnboardingProvider[];
};

export type GatewayCredentialUpdateRequest = {
  provider_profile: string;
  mode?: "secret_ref" | "plain";
  api_key?: string;
  secret_ref?: string;
  required?: boolean;
  set_active_provider?: boolean;
};

export type GatewayCredentialUpdateResponse = {
  settings: GatewaySettings;
  onboarding: GatewayOnboardingStatus;
};

export type GatewayModelCatalogEntry = {
  id: string;
  name?: string;
  provider?: string;
  description?: string;
  context_length?: number;
  is_free?: boolean;
  tags?: string[];
};

export type GatewayModelCatalog = {
  provider_profile: string;
  provider_id: string;
  source: "provider" | "fallback";
  warning?: string;
  models: GatewayModelCatalogEntry[];
};

export type GatewaySkillSummary = {
  id: string;
  name: string;
  description: string;
  scope: "global";
  version: number;
  status: "active" | "archived";
  tags: string[];
  updated_at: string;
  seeded_from?: string;
};

export type GatewaySkillDetail = {
  skill: {
    manifest: GatewaySkillSummary;
    content: string;
    references: string[];
    assets: string[];
  };
};

export type GatewaySkillBinding = {
  skill_ids: string[];
  source?: "ui" | "slash" | "nl" | "api";
  conversation_id?: string;
  project_id?: string;
};

export type GatewayMigrationImportResult = {
  imported_at: string;
  schema_version: number;
  source_format: "migration-v1" | "legacy-memory-export";
  restored: {
    memory: boolean;
    secrets: boolean;
  };
  warnings: string[];
  settings: GatewaySettings;
  logout_required?: boolean;
};

export type GatewayMemoryUpdateStatus = {
  current_app_version: string;
  memory_pack_version: string;
  target_memory_pack_version: string;
  pending: boolean;
  migration_id: string;
  report_path: string | null;
  applied_paths: string[];
  deferred_paths: string[];
};

export class GatewayError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
  }
}

export class GatewayNotFoundError extends GatewayError {
  constructor(message: string, code?: string) {
    super(message, 404, code);
    this.name = "GatewayNotFoundError";
  }
}
