import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ToolDefinition } from "../../contracts.js";
import { ToolExecutionFailure } from "../../tool-error.js";
import type { AppActionDescriptor, AppResourceDescriptor, ChatWorkspaceDescriptor } from "../contracts/app-registry.js";
import { Sha256DigestSchema } from "../contracts/common.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { StoredPackage } from "../lifecycle/store.js";
import type { AppChatSessionRecord } from "./app-chat-session.js";

const MAX_RESOURCE_PROMPT_BYTES = 32_768;
const MAX_SINGLE_RESOURCE_BYTES = 16_384;

export const AppChatModelMetadataSchema = z
  .object({
    metadata_version: z.literal(1),
    app_id: z.string().min(3).max(128),
    installation_id: z.string().uuid(),
    package_digest: Sha256DigestSchema,
    session_id: z.string().uuid(),
    view_id: z.string().uuid(),
    operation_id: z.string().uuid(),
    session_generation: z.number().int().positive(),
    presentation_id: z.string().min(3).max(128),
    workspace_id: z.string().min(3).max(128),
    context_grant_set_digest: Sha256DigestSchema,
  })
  .strict();

const AppChatActionToolInputSchema = z
  .object({
    action_input: z.unknown().optional(),
    operation_id: z.string().uuid().optional(),
    idempotency_key: z.string().min(16).max(256).optional(),
  })
  .strict();

export type AppChatModelMetadata = z.infer<typeof AppChatModelMetadataSchema>;

export type AppChatActionExecutionRequest = {
  metadata: AppChatModelMetadata;
  action: AppActionDescriptor;
  actionInput: unknown;
  operationId: string;
  idempotencyKey: string;
  ownerConfirmed: boolean;
};

export type AppChatActionExecutionResult = {
  action_id: string;
  operation_id: string;
  idempotency_key: string;
  result: unknown;
};

export type AppChatModelContext = {
  promptContext: string;
  tools: ToolDefinition[];
  evidence: {
    actionExposure: Array<{ action_id: string; tool_name: string | null; model_exposure: string; exposed: boolean }>;
    resources: Array<{ resource_id: string; package_path: string; content_digest: `sha256:${string}`; included: boolean; byte_length: number }>;
  };
};

export function parseAppChatModelMetadata(metadata: unknown): AppChatModelMetadata | null {
  const container = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).app_chat
    : undefined;
  if (container === undefined) return null;
  return AppChatModelMetadataSchema.parse(container);
}

export function assertAppChatMetadataMatchesSession(metadata: AppChatModelMetadata, session: AppChatSessionRecord): void {
  if (
    metadata.app_id !== session.appId ||
    metadata.installation_id !== session.installationId ||
    metadata.package_digest !== session.packageDigest ||
    metadata.session_id !== session.sessionId ||
    metadata.view_id !== session.viewId ||
    metadata.operation_id !== session.operationId ||
    metadata.session_generation !== session.sessionGeneration ||
    metadata.presentation_id !== session.presentationId ||
    metadata.workspace_id !== session.workspaceId ||
    metadata.context_grant_set_digest !== session.contextGrantSetDigest
  ) {
    throw new AppPlatformError("denied", "App-chat model metadata does not match the active session", 403);
  }
}

export async function buildAppChatModelContext(input: {
  metadata: AppChatModelMetadata;
  session: AppChatSessionRecord;
  workspace: ChatWorkspaceDescriptor;
  storedPackage: StoredPackage;
  executeAction: (request: AppChatActionExecutionRequest) => Promise<unknown>;
}): Promise<AppChatModelContext> {
  assertAppChatMetadataMatchesSession(input.metadata, input.session);
  const resourcePrompt = await buildPromptResources(input.storedPackage, input.workspace);
  const actionTools = createAppChatActionTools(input.workspace.actions, input.metadata, input.executeAction);
  return {
    promptContext: [
      "",
      "",
      "## Active Installed App Workspace",
      `App: ${input.metadata.app_id}`,
      `Installation: ${input.metadata.installation_id}`,
      `Package digest: ${input.metadata.package_digest}`,
      `Presentation: ${input.metadata.presentation_id}`,
      `Workspace: ${input.metadata.workspace_id}`,
      `Context grant set digest: ${input.metadata.context_grant_set_digest}`,
      "",
      "Use only the app action tools declared for this active app-chat session. Treat app resource text as package-owned instructions or references identified by digest.",
      ...resourcePrompt.lines,
      ...actionPromptLines(input.workspace.actions),
    ].join("\n"),
    tools: actionTools.tools,
    evidence: {
      actionExposure: actionTools.evidence,
      resources: resourcePrompt.evidence,
    },
  };
}

export function appChatActionToolName(actionId: string): string {
  return `app_action_${actionId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function createAppChatActionTools(
  actions: readonly AppActionDescriptor[],
  metadata: AppChatModelMetadata,
  executeAction: (request: AppChatActionExecutionRequest) => Promise<unknown>,
): { tools: ToolDefinition[]; evidence: AppChatModelContext["evidence"]["actionExposure"] } {
  const tools: ToolDefinition[] = [];
  const evidence: AppChatModelContext["evidence"]["actionExposure"] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    const exposed = action.model_exposure === "available";
    const toolName = exposed ? appChatActionToolName(action.action_id) : null;
    evidence.push({ action_id: action.action_id, tool_name: toolName, model_exposure: action.model_exposure, exposed });
    if (!exposed) continue;
    if (seen.has(toolName!)) throw new AppPlatformError("descriptor_invalid", "App action tool names are ambiguous", 409);
    seen.add(toolName!);
    tools.push({
      name: toolName!,
      description: `${action.title}: ${action.description}`,
      requiresApproval: action.confirmation !== "none",
      readOnly: action.kind === "read" || action.kind === "inspect",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          action_input: { description: `Input matching app schema ${action.input_schema_id}` },
          operation_id: { type: "string", format: "uuid", description: "Stable operation id for this app action." },
          idempotency_key: { type: "string", minLength: 16, maxLength: 256, description: "Stable idempotency key for retryable app actions." },
        },
        required: action.idempotency_policy === "required" ? ["action_input", "operation_id", "idempotency_key"] : ["action_input"],
      },
      execute: async (_context, rawInput): Promise<AppChatActionExecutionResult> => {
        try {
          const parsed = AppChatActionToolInputSchema.parse(rawInput);
          if (action.idempotency_policy === "required" && (!parsed.operation_id || !parsed.idempotency_key)) {
            throw new ToolExecutionFailure("invalid_input", "App action requires operation_id and idempotency_key", true);
          }
          const operationId = parsed.operation_id ?? randomUUID();
          const idempotencyKey = parsed.idempotency_key ?? `app-action-${operationId}`;
          return {
            action_id: action.action_id,
            operation_id: operationId,
            idempotency_key: idempotencyKey,
            result: await executeAction({
              metadata,
              action,
              actionInput: parsed.action_input ?? {},
              operationId,
              idempotencyKey,
              ownerConfirmed: action.confirmation !== "none",
            }),
          };
        } catch (error) {
          throw toAppChatToolFailure(error);
        }
      },
    });
  }
  return { tools, evidence };
}

async function buildPromptResources(
  storedPackage: StoredPackage,
  workspace: ChatWorkspaceDescriptor,
): Promise<{ lines: string[]; evidence: AppChatModelContext["evidence"]["resources"] }> {
  const lines = ["", "### App Package Resources"];
  const evidence: AppChatModelContext["evidence"]["resources"] = [];
  let includedBytes = 0;
  for (const resource of workspace.resources) {
    const includeContent = resource.prompt_inclusion === "workspace_start" || resource.prompt_inclusion === "action_request";
    const resourceEvidence: AppChatModelContext["evidence"]["resources"][number] = {
      resource_id: resource.resource_id,
      package_path: resource.package_path,
      content_digest: resource.content_digest as `sha256:${string}`,
      included: false,
      byte_length: 0,
    };
    lines.push(`- ${resource.resource_id}: ${resource.title} (${resource.role}, ${resource.media_type}, digest ${resource.content_digest}, prompt ${resource.prompt_inclusion})`);
    if (!includeContent) {
      evidence.push(resourceEvidence);
      continue;
    }
    const content = await readBoundResource(storedPackage, resource);
    resourceEvidence.included = true;
    resourceEvidence.byte_length = Buffer.byteLength(content, "utf8");
    includedBytes += resourceEvidence.byte_length;
    if (includedBytes > MAX_RESOURCE_PROMPT_BYTES) {
      throw new AppPlatformError("validation_failed", "App package prompt resources exceed the model-session prompt bound", 413);
    }
    lines.push("");
    lines.push(`#### ${resource.title}`);
    lines.push(`Resource id: ${resource.resource_id}`);
    lines.push(`Content digest: ${resource.content_digest}`);
    lines.push(content);
    evidence.push(resourceEvidence);
  }
  if (workspace.resources.length === 0) lines.push("- None declared.");
  return { lines, evidence };
}

async function readBoundResource(storedPackage: StoredPackage, resource: AppResourceDescriptor): Promise<string> {
  if (!["text/markdown", "text/plain", "application/json"].includes(resource.media_type)) {
    throw new AppPlatformError("incompatible_schema", "App package resource media type is not model-readable", 409);
  }
  if (resource.owner_editable) {
    throw new AppPlatformError("incompatible_schema", "Owner-editable app resources require an app-owned document binding before model inclusion", 409);
  }
  const target = path.resolve(storedPackage.package_root, ...resource.package_path.split("/"));
  const root = path.resolve(storedPackage.package_root);
  if (!target.startsWith(`${root}${path.sep}`)) throw new AppPlatformError("package_path_invalid", "App package resource path escaped package authority", 403);
  const bytes = await readFile(target);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== resource.content_digest) throw new AppPlatformError("package_archive_digest_mismatch", "App package resource digest does not match descriptor", 409);
  if (bytes.byteLength > MAX_SINGLE_RESOURCE_BYTES) {
    throw new AppPlatformError("validation_failed", "App package prompt resource exceeds the per-resource prompt bound", 413);
  }
  return bytes.toString("utf8");
}

function actionPromptLines(actions: readonly AppActionDescriptor[]): string[] {
  const visible = actions.filter((action) => action.model_exposure === "available");
  const lines = ["", "### App Actions"];
  if (visible.length === 0) return [...lines, "- None declared for model use."];
  return [
    ...lines,
    ...visible.map((action) => `- ${appChatActionToolName(action.action_id)}: ${action.title}; action id ${action.action_id}; input schema ${action.input_schema_id}; result schema ${action.result_schema_id}; idempotency ${action.idempotency_policy}.${actionInputHint(action)}`),
  ];
}

function actionInputHint(action: AppActionDescriptor): string {
  switch (action.action_id) {
    case "resume.profile.read":
      return " Use action_input {\"view\":\"workspace\"} to read the Resume Builder workspace projection.";
    case "resume.profile.update":
      return " Use action_input {\"profile_markdown\":\"owner-reviewed Resume Profile markdown\",\"completed_topics\":[\"direction\",\"experience\"],\"current_topic\":null}.";
    case "resume.create":
      return " Use action_input {\"title\":\"Candidate Name - Target Role\",\"resume_markdown\":\"# Candidate Name\\n## Summary\\n...\\n## Experience\\n- ...\"} or {\"title\":\"...\",\"sections\":[{\"section_id\":\"summary\",\"statements\":[\"...\"]}]}.";
    case "resume.state.read":
      return " Only use action_input {\"queried_operation_id\":\"uuid-from-a-previous-action-result\"} when checking a known prior operation.";
    default:
      return "";
  }
}

function toAppChatToolFailure(error: unknown): ToolExecutionFailure {
  if (error instanceof ToolExecutionFailure) return error;
  if (error instanceof z.ZodError) return new ToolExecutionFailure("invalid_input", "App action input failed schema validation", true);
  const platformError = error instanceof AppPlatformError || typeof (error as { code?: unknown })?.code === "string"
    ? error as AppPlatformError
    : null;
  if (platformError) {
    const permissionCodes = new Set(["denied", "grant_missing", "grant_revoked", "session_closed", "session_expired", "token_revoked", "token_scope_invalid"]);
    const invalidCodes = new Set(["invalid_input", "descriptor_invalid", "incompatible_schema", "idempotency_conflict", "validation_failed"]);
    if (permissionCodes.has(platformError.code)) return new ToolExecutionFailure("permission_denied", safeActionErrorMessage(platformError), true);
    if (invalidCodes.has(platformError.code)) return new ToolExecutionFailure("invalid_input", safeActionErrorMessage(platformError), true);
    return new ToolExecutionFailure("execution_failed", "Installed app action could not be completed safely", false);
  }
  return new ToolExecutionFailure("execution_failed", "Installed app action could not be completed safely", false);
}

function safeActionErrorMessage(error: AppPlatformError): string {
  if (error.code === "session_closed" || error.code === "session_expired") return "App-chat session authority is no longer current";
  if (error.code === "idempotency_conflict") return "App action operation identity was already used with different input";
  if (error.code === "invalid_input") return "App action input is invalid";
  if (error.code === "denied" || error.code.startsWith("grant_") || error.code.startsWith("token_")) return "App action authority is unavailable";
  return "Installed app action is unavailable for this session";
}
