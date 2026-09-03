import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ToolDefinition } from "../../contracts.js";
import { ToolExecutionFailure } from "../../tool-error.js";
import { AppActionDescriptorSchema, type AppActionDescriptor, type AppResourceDescriptor, type ChatWorkspaceDescriptor } from "../contracts/app-registry.js";
import { canonicalJson, Sha256DigestSchema } from "../contracts/common.js";
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

export type AppChatResourcePromptContent = {
  content: string;
  contentDigest: `sha256:${string}`;
  source: "package" | "owner_override";
  ownerRevision?: number;
};

export type AppChatModelContext = {
  promptContext: string;
  tools: ToolDefinition[];
  evidence: {
    actionExposure: Array<{ action_id: string; tool_name: string | null; model_exposure: string; exposed: boolean }>;
    resources: Array<{ resource_id: string; package_path: string; content_digest: `sha256:${string}`; included: boolean; byte_length: number; content_source?: "package" | "owner_override"; owner_revision?: number }>;
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
  resolveResourcePromptContent?: (resource: AppResourceDescriptor) => Promise<AppChatResourcePromptContent | null>;
  executeAction: (request: AppChatActionExecutionRequest) => Promise<unknown>;
}): Promise<AppChatModelContext> {
  assertAppChatMetadataMatchesSession(input.metadata, input.session);
  const resourcePrompt = await buildPromptResources(input.storedPackage, input.workspace, input.resolveResourcePromptContent);
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
      "Use only the app action tools declared for this active app-chat session. Treat app resource text as package-owned instructions or references unless the host marks it as an owner override.",
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
    const parsedAction = AppActionDescriptorSchema.safeParse(action);
    if (!parsedAction.success) {
      throw new AppPlatformError("descriptor_invalid", "App action descriptor is missing concrete schema resources", 409);
    }
    const descriptor = parsedAction.data;
    const exposed = descriptor.model_exposure === "available";
    const toolName = exposed ? appChatActionToolName(descriptor.action_id) : null;
    evidence.push({ action_id: descriptor.action_id, tool_name: toolName, model_exposure: descriptor.model_exposure, exposed });
    if (!exposed) continue;
    if (seen.has(toolName!)) throw new AppPlatformError("descriptor_invalid", "App action tool names are ambiguous", 409);
    seen.add(toolName!);
    tools.push({
      name: toolName!,
      description: `${descriptor.title}: ${descriptor.description}`,
      requiresApproval: descriptor.confirmation !== "none",
      readOnly: descriptor.kind === "read" || descriptor.kind === "inspect",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          action_input: descriptor.input_schema.schema,
          operation_id: { type: "string", format: "uuid", description: "Stable operation id for this app action." },
          idempotency_key: { type: "string", minLength: 16, maxLength: 256, description: "Stable idempotency key for retryable app actions." },
        },
        required: descriptor.idempotency_policy === "required" ? ["action_input", "operation_id", "idempotency_key"] : ["action_input"],
      },
      execute: async (_context, rawInput): Promise<AppChatActionExecutionResult> => {
        try {
          const parsed = AppChatActionToolInputSchema.parse(rawInput);
          if (descriptor.idempotency_policy === "required" && (!parsed.operation_id || !parsed.idempotency_key)) {
            throw new ToolExecutionFailure("invalid_input", "App action requires operation_id and idempotency_key", true);
          }
          const actionInput = parsed.action_input ?? {};
          const validationErrors = validateJsonValueAgainstActionSchema(actionInput, descriptor.input_schema.schema);
          if (validationErrors.length > 0) {
            throw new ToolExecutionFailure("invalid_input", "App action input failed schema validation", true);
          }
          const operationId = parsed.operation_id ?? randomUUID();
          const idempotencyKey = parsed.idempotency_key ?? `app-action-${operationId}`;
          const result = await executeAction({
            metadata,
            action: descriptor,
            actionInput,
            operationId,
            idempotencyKey,
            ownerConfirmed: descriptor.confirmation !== "none",
          });
          const resultValidationErrors = validateJsonValueAgainstActionSchema(result, descriptor.result_schema.schema);
          if (resultValidationErrors.length > 0) {
            throw new ToolExecutionFailure("execution_failed", "App action result failed schema validation", false);
          }
          return {
            action_id: descriptor.action_id,
            operation_id: operationId,
            idempotency_key: idempotencyKey,
            result,
          };
        } catch (error) {
          throw toAppChatToolFailure(error);
        }
      },
    });
  }
  return { tools, evidence };
}

export function validateJsonValueAgainstActionSchema(value: unknown, schema: Record<string, unknown>, path: string[] = []): string[] {
  const errors: string[] = [];
  if (!schemaTypeMatches(value, schema.type)) {
    errors.push(`${path.join(".") || "action_input"} type mismatch`);
    return errors;
  }
  if ("const" in schema && !Object.is(value, schema.const)) {
    errors.push(`${path.join(".") || "action_input"} const mismatch`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path.join(".") || "action_input"} enum mismatch`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path.join(".") || "action_input"} shorter than minLength`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path.join(".") || "action_input"} exceeds maxLength`);
    if (schema.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      errors.push(`${path.join(".") || "action_input"} format mismatch`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path.join(".") || "action_input"} shorter than minItems`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${path.join(".") || "action_input"} exceeds maxItems`);
    if (isJsonSchemaObject(schema.items)) {
      value.forEach((item, index) => errors.push(...validateJsonValueAgainstActionSchema(item, schema.items as Record<string, unknown>, [...path, String(index)])));
    }
  }
  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${[...path, key].join(".")} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${[...path, key].join(".")} is not declared`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && isJsonSchemaObject(childSchema)) {
        errors.push(...validateJsonValueAgainstActionSchema(value[key], childSchema, [...path, key]));
      }
    }
  }
  return errors;
}

function schemaTypeMatches(value: unknown, type: unknown): boolean {
  if (type === undefined) return true;
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => {
    if (item === "null") return value === null;
    if (item === "array") return Array.isArray(value);
    if (item === "object") return isPlainObject(value);
    if (item === "integer") return Number.isInteger(value);
    if (item === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof item === "string" && typeof value === item;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

async function buildPromptResources(
  storedPackage: StoredPackage,
  workspace: ChatWorkspaceDescriptor,
  resolveResourcePromptContent?: (resource: AppResourceDescriptor) => Promise<AppChatResourcePromptContent | null>,
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
    const promptContent = resource.owner_editable
      ? await readOwnerEditableResourcePrompt(resource, resolveResourcePromptContent)
      : await readPackageResourcePrompt(storedPackage, resource);
    resourceEvidence.included = true;
    resourceEvidence.content_digest = promptContent.contentDigest;
    resourceEvidence.byte_length = Buffer.byteLength(promptContent.content, "utf8");
    resourceEvidence.content_source = promptContent.source;
    if (promptContent.ownerRevision !== undefined) resourceEvidence.owner_revision = promptContent.ownerRevision;
    includedBytes += resourceEvidence.byte_length;
    if (includedBytes > MAX_RESOURCE_PROMPT_BYTES) {
      throw new AppPlatformError("validation_failed", "App package prompt resources exceed the model-session prompt bound", 413);
    }
    lines.push("");
    lines.push(`#### ${resource.title}`);
    lines.push(`Resource id: ${resource.resource_id}`);
    lines.push(`Content source: ${promptContent.source === "owner_override" ? `owner override revision ${promptContent.ownerRevision ?? "unknown"}` : "immutable package"}`);
    lines.push(`Content digest: ${promptContent.contentDigest}`);
    lines.push(promptContent.content);
    evidence.push(resourceEvidence);
  }
  if (workspace.resources.length === 0) lines.push("- None declared.");
  return { lines, evidence };
}

async function readOwnerEditableResourcePrompt(
  resource: AppResourceDescriptor,
  resolveResourcePromptContent?: (resource: AppResourceDescriptor) => Promise<AppChatResourcePromptContent | null>,
): Promise<AppChatResourcePromptContent> {
  if (!resolveResourcePromptContent) {
    throw new AppPlatformError("incompatible_schema", "Owner-editable app resources require an app-owned document binding before model inclusion", 409);
  }
  const promptContent = await resolveResourcePromptContent(resource);
  if (!promptContent) {
    throw new AppPlatformError("incompatible_schema", "Owner-editable app resources require an app-owned document binding before model inclusion", 409);
  }
  if (Buffer.byteLength(promptContent.content, "utf8") > MAX_SINGLE_RESOURCE_BYTES) {
    throw new AppPlatformError("validation_failed", "Owner-edited app prompt resource exceeds the per-resource prompt bound", 413);
  }
  return promptContent;
}

async function readPackageResourcePrompt(storedPackage: StoredPackage, resource: AppResourceDescriptor): Promise<AppChatResourcePromptContent> {
  if (!["text/markdown", "text/plain", "application/json"].includes(resource.media_type)) {
    throw new AppPlatformError("incompatible_schema", "App package resource media type is not model-readable", 409);
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
  return {
    content: bytes.toString("utf8"),
    contentDigest: resource.content_digest as `sha256:${string}`,
    source: "package",
  };
}

function actionPromptLines(actions: readonly AppActionDescriptor[]): string[] {
  const visible = actions.filter((action) => action.model_exposure === "available");
  const lines = ["", "### App Actions"];
  if (visible.length === 0) return [...lines, "- None declared for model use."];
  return [
    ...lines,
    ...visible.map((action) => [
      `- ${appChatActionToolName(action.action_id)}: ${action.title}; action id ${action.action_id}; input schema ${action.input_schema.schema_id}; result schema ${action.result_schema.schema_id}; idempotency ${action.idempotency_policy}.`,
      `  Input JSON Schema: ${canonicalJson(action.input_schema.schema)}`,
    ].join("\n")),
  ];
}

function toAppChatToolFailure(error: unknown): ToolExecutionFailure {
  if (error instanceof ToolExecutionFailure) return error;
  if (error instanceof z.ZodError) return new ToolExecutionFailure("invalid_input", "App action input failed schema validation", true);
  const platformError = error instanceof AppPlatformError || typeof (error as { code?: unknown })?.code === "string"
    ? error as AppPlatformError
    : null;
  if (platformError) {
    if (platformError.code === "cancelled") return new ToolExecutionFailure("execution_failed", "App action was cancelled", true);
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
  if (error.code === "validation_failed") return error.message;
  if (error.code === "denied" || error.code.startsWith("grant_") || error.code.startsWith("token_")) return "App action authority is unavailable";
  return "Installed app action is unavailable for this session";
}
