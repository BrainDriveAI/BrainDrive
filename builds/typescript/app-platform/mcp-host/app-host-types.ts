import type { z } from "zod";

import type { ToolDefinition } from "../../contracts.js";
import type { AppChatModelMetadata } from "./app-chat-model.js";
import type { McpAppResourceSchema } from "../contracts/mcp-app.js";
import type { AppChatContextProjection, AppChatSessionResumeRequest } from "./app-chat-session.js";

type AppResource = z.infer<typeof McpAppResourceSchema>;

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
  resource: AppResource;
  allowed_tools: string[];
  allowed_capabilities: string[];
  entry_point: "direct" | "career";
};

export type AppChatWorkspaceLaunchInput = {
  presentationId?: string;
  workspaceId?: string;
  resume?: AppChatSessionResumeRequest;
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
    documents: readonly unknown[];
    resources: readonly unknown[];
    actions: readonly unknown[];
  };
  presentation: {
    profile_version: 1;
    presentation_id: string;
    type: "chat_workspace";
    label: string;
    description: string;
    workspace_id: string;
    owner_visibility: "primary" | "secondary" | "internal";
  };
  context: AppChatContextProjection;
};

export type AppChatModelContext = {
  prompt_context: string;
  tools: ToolDefinition[];
  evidence: {
    action_exposure: Array<{ action_id: string; tool_name: string | null; model_exposure: string; exposed: boolean }>;
    resources: Array<{ resource_id: string; package_path: string; content_digest: `sha256:${string}`; included: boolean; byte_length: number }>;
  };
};

export type AppChatModelContextRequest = AppChatModelMetadata;
