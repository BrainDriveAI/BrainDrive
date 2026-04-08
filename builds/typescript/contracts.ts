export type RuntimeConfig = {
  memory_root: string;
  provider_adapter: string;
  conversation_store: "markdown";
  auth_mode: AuthMode;
  install_mode: InstallMode;
  tool_sources: string[];
  bind_address: string;
  safety_iteration_limit?: number;
  port?: number;
};

export type AuthMode = "local-owner" | "local" | "managed";
export type InstallMode = "local" | "quickstart" | "prod" | "unknown";

export type AdapterConfig = {
  base_url: string;
  model: string;
  api_key_env: string;
  provider_id?: string;
  provider_profiles?: Record<string, AdapterProfileConfig>;
  default_provider_profile?: string;
};

export type AdapterProfileConfig = {
  base_url: string;
  model: string;
  api_key_env: string;
  provider_id?: string;
};

export type PermissionSet = {
  memory_access: boolean;
  tool_access: boolean;
  system_actions: boolean;
  delegation: boolean;
  approval_authority: boolean;
  administration: boolean;
};

export type AuthState = {
  actor_id: string;
  actor_type: "owner";
  permissions: PermissionSet;
  mode: AuthMode;
  account_initialized?: boolean;
  account_username?: string;
  account_created_at?: string;
  credential_ref?: string;
  session_policy?: {
    access_ttl_seconds: number;
    refresh_ttl_seconds: number;
  };
  created_at: string;
  updated_at: string;
};

export type AuthContext = {
  actorId: string;
  actorType: "owner";
  permissions: PermissionSet;
  mode: AuthMode;
};

export type ClientMessageRequest = {
  content: string;
  metadata?: Record<string, unknown>;
};

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type ConversationMessage = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
};

export type ConversationRecord = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type ConversationDetail = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: ConversationMessage[];
};

export type GatewayToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type GatewayMessage = {
  role: MessageRole;
  content: string;
  tool_call_id?: string;
  tool_calls?: GatewayToolCall[];
};

export type GatewayEngineRequest = {
  messages: GatewayMessage[];
  metadata: {
    correlation_id: string;
    conversation_id?: string;
    trigger?: string;
    client_context?: Record<string, unknown>;
  };
};

export type StreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool-result"; id: string; status: "ok" | "denied" | "error"; output: unknown }
  | { type: "approval-request"; request_id: string; tool_name: string; summary: string }
  | { type: "approval-result"; request_id: string; decision: "approved" | "denied" }
  | { type: "done"; conversation_id: string; message_id: string; finish_reason: string }
  | { type: "error"; code: "provider_error" | "tool_error" | "context_overflow"; message: string };

export type PendingApproval = {
  requestId: string;
  toolCallId: string;
  conversationId: string;
  toolName: string;
  summary: string;
  createdAt: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  requiresApproval: boolean;
  readOnly: boolean;
  inputSchema: Record<string, unknown>;
  execute: (context: ToolContext, input: Record<string, unknown>) => Promise<unknown>;
};

export type ToolContext = {
  memoryRoot: string;
  auth: AuthContext;
  correlationId: string;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolExecutionResult = {
  status: "ok" | "denied" | "error";
  output: unknown;
  recoverable?: boolean;
};

export type HistoryEntry = {
  commit: string;
  message: string;
  timestamp: string;
  path: string;
  previous_state?: string;
};

export type ExportResult = {
  archive_path: string;
};

export type Preferences = {
  default_model: string;
  approval_mode: "ask-on-write";
  active_provider_profile?: string;
  provider_credentials?: Record<string, ProviderCredentialPreference>;
  provider_base_urls?: Record<string, string>;
  provider_default_models?: Record<string, string>;
  secret_resolution?: SecretResolutionPreference;
  memory_backup?: MemoryBackupPreference;
};

export type MemoryBackupFrequency = "manual" | "after_changes" | "hourly" | "daily";

export type MemoryBackupResult = "never" | "success" | "failed";

export type MemoryBackupPreference = {
  repository_url: string;
  frequency: MemoryBackupFrequency;
  token_secret_ref: string;
  last_save_at?: string;
  last_attempt_at?: string;
  last_result?: MemoryBackupResult;
  last_error?: string | null;
};

export type ProviderCredentialPreference =
  | {
      mode: "plain";
      required?: boolean;
    }
  | {
      mode: "secret_ref";
      secret_ref: string;
      env_ref?: string;
      required?: boolean;
    };

export type SecretResolutionPreference = {
  on_missing: "fail_closed" | "prompt_once";
};

export type ResolvedProviderCredential = {
  providerId: string;
  secretRef?: string;
  source: "env_ref" | "vault" | "prompt_once";
  apiKey: string;
};

export type AuditLogEvent = {
  timestamp: string;
  event: string;
  details: Record<string, unknown>;
};
