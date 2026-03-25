import path from "node:path";
import { createReadStream } from "node:fs";
import Fastify from "fastify";
import { z } from "zod";

import { createGatewayAdapter } from "../adapters/gateway.js";
import { createModelAdapter, resolveAdapterConfigForPreferences } from "../adapters/index.js";
import type { ProviderModel } from "../adapters/base.js";
import { authorize, authorizeApprovalDecision } from "../auth/authorize.js";
import { authMiddleware } from "../auth/middleware.js";
import {
  loadAdapterConfig,
  loadPreferences,
  loadRuntimeConfig,
  ensureMemoryLayout,
  readBootstrapPrompt,
  savePreferences,
} from "../config.js";
import type { AdapterConfig, ClientMessageRequest, Preferences, RuntimeConfig } from "../contracts.js";
import { runAgentLoop } from "../engine/loop.js";
import { classifyProviderError } from "../engine/errors.js";
import { formatSseEvent } from "../engine/stream.js";
import { ToolExecutor } from "../engine/tool-executor.js";
import { ensureGitReady } from "../git.js";
import { auditLog } from "../logger.js";
import { ensureAuthState } from "../memory/auth-state.js";
import type { ConversationRepository } from "../memory/conversation-repository.js";
import { MarkdownConversationStore } from "../memory/conversation-store-markdown.js";
import { exportMemory } from "../memory/export.js";
import { discoverTools } from "../tools.js";
import { ApprovalStore } from "../engine/approval-store.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import { initializeMasterKey, loadMasterKey } from "../secrets/key-provider.js";
import { resolveSecretsPaths } from "../secrets/paths.js";
import { getVaultSecret, upsertVaultSecret } from "../secrets/vault.js";
import { GatewayConversationService } from "./conversations.js";
import { GatewayProjectService, isProjectMetadata, ProtectedProjectError } from "./projects.js";
import { GatewaySkillService } from "./skills.js";

const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "denied"]),
});

const projectCreateSchema = z.object({
  name: z.string().trim().min(1),
  icon: z.string().trim().min(1).optional(),
});

const projectRenameSchema = z.object({
  name: z.string().trim().min(1),
});

const fileContentWriteSchema = z.object({
  content: z.string(),
});

const skillCreateSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    content: z.string().min(1),
    tags: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const skillUpdateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    content: z.string().min(1).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one skill field is required",
  });

const skillBindingUpdateSchema = z
  .object({
    skill_ids: z.array(z.string().trim().min(1)),
    source: z.enum(["ui", "slash", "nl", "api"]).optional(),
  })
  .strict();

const settingsUpdateSchema = z
  .object({
    default_model: z.string().trim().min(1).optional(),
    active_provider_profile: z.union([z.string().trim().min(1), z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one settings field is required",
  });

const settingsModelsQuerySchema = z
  .object({
    provider_profile: z.string().trim().min(1).optional(),
  })
  .strict();

const settingsCredentialsUpdateSchema = z
  .object({
    provider_profile: z.string().trim().min(1),
    mode: z.enum(["secret_ref", "plain"]).optional(),
    api_key: z.string().trim().min(1).optional(),
    secret_ref: z.string().trim().min(1).optional(),
    required: z.boolean().optional(),
    set_active_provider: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const mode = value.mode ?? "secret_ref";
    if (mode === "secret_ref" && !value.api_key) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "api_key is required when mode=secret_ref",
      });
    }
    if (mode === "plain" && value.api_key !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "api_key is not allowed when mode=plain",
      });
    }
  });

export async function buildServer(rootDir = process.cwd()) {
  auditLog("startup.phase", { phase: "runtime-config" });
  const runtimeConfig = await loadRuntimeConfig(rootDir);

  auditLog("startup.phase", { phase: "adapter-config" });
  const adapterConfig = await loadAdapterConfig(rootDir, runtimeConfig.provider_adapter);

  auditLog("startup.phase", { phase: "tools" });
  const tools = await discoverTools(rootDir, runtimeConfig.memory_root, runtimeConfig.tool_sources);

  auditLog("startup.phase", { phase: "memory" });
  await ensureMemoryLayout(rootDir, runtimeConfig.memory_root);
  await ensureGitReady(runtimeConfig.memory_root);

  auditLog("startup.phase", { phase: "preferences" });
  const preferences = await loadPreferences(runtimeConfig.memory_root);
  const authState = await ensureAuthState(runtimeConfig.memory_root);
  const systemPrompt = await readBootstrapPrompt(runtimeConfig.memory_root);
  auditLog("startup.phase", { phase: "secrets" });
  const startupAdapterConfig = resolveAdapterConfigForPreferences(adapterConfig, preferences);
  try {
    const resolvedProviderCredential = await resolveProviderCredentialForStartup(
      runtimeConfig.provider_adapter,
      startupAdapterConfig,
      preferences
    );
    if (resolvedProviderCredential) {
      auditLog("secret.resolve", {
        provider_id: resolvedProviderCredential.providerId,
        provider_profile: preferences.active_provider_profile ?? adapterConfig.default_provider_profile,
        source: resolvedProviderCredential.source,
        secret_ref: resolvedProviderCredential.secretRef,
      });
    }
  } catch (error) {
    auditLog("secret.resolve_deferred", {
      provider_id: startupAdapterConfig.provider_id ?? "unknown",
      provider_profile: preferences.active_provider_profile ?? adapterConfig.default_provider_profile ?? "default",
      message: error instanceof Error ? error.message : "Unknown secret resolution error",
    });
  }
  const gatewayAdapter = createGatewayAdapter("openai-compatible");

  auditLog("startup.phase", { phase: "ready" });

  const app = Fastify({ logger: false });
  const approvalStore = new ApprovalStore();
  const toolExecutor = new ToolExecutor(tools);
  const conversations = new GatewayConversationService(createConversationRepository(runtimeConfig));
  const projects = new GatewayProjectService(runtimeConfig.memory_root, { rootDir });
  const skills = new GatewaySkillService(runtimeConfig.memory_root);

  app.get("/health", async () => ({ status: "ok" }));

  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health") {
      return;
    }

    await authMiddleware(request, reply, authState);
  });

  app.post("/message", async (request, reply) => {
    const normalizedRequest = gatewayAdapter.normalizeMessageRequest(request.body, request.headers["x-conversation-id"]);
    if (!normalizedRequest.ok) {
      sendInvalidRequest(reply, "/message", normalizedRequest.failure.issueCount);
      return;
    }

    const body: ClientMessageRequest = {
      content: normalizedRequest.request.content,
      ...(normalizedRequest.request.metadata ? { metadata: normalizedRequest.request.metadata } : {}),
    };
    const requestedConversationId = normalizedRequest.request.requestedConversationId;

    if (requestedConversationId && !conversations.hasConversation(requestedConversationId)) {
      auditLog("contract.error", {
        route: "/message",
        status: 404,
        reason: "conversation_not_found",
        conversation_id: requestedConversationId,
      });
      reply.code(404).send({ error: "Conversation not found" });
      return;
    }

    const { conversationId } = conversations.persistUserMessage(requestedConversationId, body);
    const projectId = isProjectMetadata(body.metadata) ? body.metadata.project.trim() : null;
    if (isProjectMetadata(body.metadata)) {
      await projects.attachConversation(body.metadata.project.trim(), conversationId);
    }
    const conversationSkillIds = conversations.getConversationSkills(conversationId) ?? [];
    const projectSkillIds = projectId ? (await projects.getProjectSkills(projectId)) ?? [] : [];
    const promptWithSkills = await skills.composePromptWithSkills(systemPrompt, [...projectSkillIds, ...conversationSkillIds]);
    auditLog("skills.apply", {
      conversation_id: conversationId,
      project_id: projectId,
      applied_skill_ids: promptWithSkills.applied,
      missing_skill_ids: promptWithSkills.missing,
      truncated: promptWithSkills.truncated,
    });
    const engineRequest = gatewayAdapter.buildEngineRequest({
      conversationId,
      correlationId: crypto.randomUUID(),
      messages: conversations.buildConversationMessages(conversationId, promptWithSkills.prompt),
      ...(body.metadata ? { clientMetadata: body.metadata } : {}),
    });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-conversation-id": conversationId,
    });

    let assistantBuffer = "";
    let currentAssistantMessageId = crypto.randomUUID();
    let lastPersistedAssistantMessageId: string | null = null;
    const pendingToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>();

    try {
      const livePreferences = await loadPreferences(runtimeConfig.memory_root);
      const liveAdapterConfig = resolveAdapterConfigForPreferences(adapterConfig, livePreferences);
      const liveProviderCredential = await resolveProviderCredentialForStartup(
        runtimeConfig.provider_adapter,
        liveAdapterConfig,
        livePreferences
      );
      if (liveProviderCredential) {
        auditLog("secret.resolve", {
          provider_id: liveProviderCredential.providerId,
          provider_profile: livePreferences.active_provider_profile ?? adapterConfig.default_provider_profile,
          source: liveProviderCredential.source,
          secret_ref: liveProviderCredential.secretRef,
        });
      }
      const modelAdapter = createModelAdapter(runtimeConfig.provider_adapter, liveAdapterConfig, livePreferences, {
        apiKey: liveProviderCredential?.apiKey,
      });

      for await (const event of runAgentLoop(
        modelAdapter,
        toolExecutor,
        approvalStore,
        engineRequest,
        request.authContext,
        {
          memoryRoot: runtimeConfig.memory_root,
          safetyIterationLimit: runtimeConfig.safety_iteration_limit,
        }
      )) {
        if (event.type === "tool-call") {
          pendingToolCalls.set(event.id, {
            name: event.name,
            input: event.input,
          });
        }

        if (event.type === "text-delta") {
          assistantBuffer += event.delta;
        }

        if (event.type === "tool-result") {
          const toolCall = pendingToolCalls.get(event.id);
          pendingToolCalls.delete(event.id);

          if (assistantBuffer.trim().length > 0) {
            conversations.appendAssistantMessage(conversationId, currentAssistantMessageId, assistantBuffer);
            lastPersistedAssistantMessageId = currentAssistantMessageId;
            assistantBuffer = "";
            currentAssistantMessageId = crypto.randomUUID();
          }

          conversations.appendToolMessage(
            conversationId,
            event.id,
            JSON.stringify({
              status: event.status,
              output: event.output,
            }),
            toolCall
          );
        }

        const outgoingEvent = gatewayAdapter.toClientStreamEvent(event, {
          conversationId,
          messageId: lastPersistedAssistantMessageId ?? currentAssistantMessageId,
        });
        reply.raw.write(formatSseEvent(outgoingEvent));
      }

      if (assistantBuffer.trim().length > 0) {
        conversations.appendAssistantMessage(conversationId, currentAssistantMessageId, assistantBuffer);
        lastPersistedAssistantMessageId = currentAssistantMessageId;
      }
    } catch (error) {
      auditLog("gateway.error", {
        conversation_id: conversationId,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      reply.raw.write(formatSseEvent(classifyProviderError(error)));
    } finally {
      reply.raw.end();
    }

    return reply;
  });

  app.post("/approvals/:requestId", async (request, reply) => {
    const params = request.params as { requestId: string };
    const parsedBody = approvalDecisionSchema.safeParse(request.body);
    if (!parsedBody.success) {
      sendInvalidRequest(reply, "/approvals/:requestId", parsedBody.error.issues.length);
      return;
    }

    const body = parsedBody.data;
    try {
      authorizeApprovalDecision(request.authContext);
    } catch {
      auditLog("contract.error", {
        route: "/approvals/:requestId",
        status: 403,
        reason: "missing_approval_authority",
      });
      reply.code(403).send({ error: "Forbidden" });
      return;
    }
    const approval = approvalStore.resolve(params.requestId, body.decision);
    if (!approval) {
      auditLog("contract.error", {
        route: "/approvals/:requestId",
        status: 404,
        reason: "approval_not_found",
      });
      reply.code(404).send({ error: "Approval request not found" });
      return;
    }

    reply.send({ request_id: params.requestId, decision: body.decision });
  });

  app.get("/conversations", async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = query.limit ? Number(query.limit) : 50;
    const offset = query.offset ? Number(query.offset) : 0;
    return conversations.list(limit, offset);
  });

  app.get("/conversations/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const detail = conversations.detail(params.id);
    if (!detail) {
      auditLog("contract.error", {
        route: "/conversations/:id",
        status: 404,
        reason: "conversation_not_found",
        conversation_id: params.id,
      });
      reply.code(404).send({ error: "Conversation not found" });
      return;
    }

    return detail;
  });

  app.get("/conversations/:id/skills", async (request, reply) => {
    authorize(request.authContext, "administration");
    const params = request.params as { id: string };
    const skillIds = conversations.getConversationSkills(params.id);
    if (!skillIds) {
      reply.code(404).send({ error: "Conversation not found" });
      return;
    }

    reply.send({
      conversation_id: params.id,
      skill_ids: skillIds,
    });
  });

  app.put("/conversations/:id/skills", async (request, reply) => {
    authorize(request.authContext, "administration");
    const params = request.params as { id: string };
    const parsed = skillBindingUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/conversations/:id/skills", parsed.error.issues.length);
      return;
    }

    const validated = await skills.validateSkillIds(parsed.data.skill_ids);
    if (validated.missing.length > 0) {
      sendInvalidRequest(reply, "/conversations/:id/skills", validated.missing.length);
      return;
    }

    const updated = conversations.setConversationSkills(params.id, validated.valid);
    if (!updated) {
      reply.code(404).send({ error: "Conversation not found" });
      return;
    }

    const source = parsed.data.source ?? "api";
    auditLog("skills.binding.update", {
      scope: "conversation",
      conversation_id: params.id,
      skill_ids: validated.valid,
      source,
    });

    reply.send({
      conversation_id: params.id,
      skill_ids: validated.valid,
      source,
    });
  });

  app.get("/config", async () => ({
    mode: "local",
    gateway_url: "/api",
    features: {
      approvals: true,
      projects: true,
      export: true,
    },
  }));

  app.get("/session", async (request) => ({
    mode: "local",
    user: {
      id: request.authContext.actorId,
      name: "Local Owner",
      initials: "LO",
      email: "owner@local.paa",
      role: request.authContext.actorType,
    },
  }));

  app.get("/settings", async (request, reply) => {
    authorize(request.authContext, "administration");
    const currentPreferences = await loadPreferences(runtimeConfig.memory_root);
    reply.header("cache-control", "no-store");
    return buildSettingsPayload(adapterConfig, currentPreferences);
  });

  app.get("/settings/onboarding-status", async (request, reply) => {
    authorize(request.authContext, "administration");
    const currentPreferences = await loadPreferences(runtimeConfig.memory_root);
    reply.header("cache-control", "no-store");
    return buildOnboardingStatusPayload(adapterConfig, currentPreferences);
  });

  app.get("/settings/models", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsedQuery = settingsModelsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      sendInvalidRequest(reply, "/settings/models", parsedQuery.error.issues.length);
      return;
    }

    const currentPreferences = await loadPreferences(runtimeConfig.memory_root);
    const selectedProfile = resolveSettingsModelProfile(
      adapterConfig,
      currentPreferences,
      parsedQuery.data.provider_profile
    );

    if (!isKnownProviderProfile(adapterConfig, selectedProfile)) {
      sendInvalidRequest(reply, "/settings/models", 1);
      return;
    }

    const scopedPreferences: Preferences = {
      ...currentPreferences,
      active_provider_profile: selectedProfile,
    };
    const selectedAdapterConfig = resolveAdapterConfigForPreferences(adapterConfig, scopedPreferences);
    const fallbackModels = toFallbackProviderModels(buildSettingsPayload(adapterConfig, scopedPreferences).available_models);
    let models: ProviderModel[] = fallbackModels;
    let source: "provider" | "fallback" = "fallback";
    let warning: string | undefined;
    let resolvedProviderCredential: Awaited<ReturnType<typeof resolveProviderCredentialForStartup>> | undefined;

    try {
      resolvedProviderCredential = await resolveProviderCredentialForStartup(
        runtimeConfig.provider_adapter,
        selectedAdapterConfig,
        scopedPreferences
      );
    } catch (error) {
      warning = "Provider credential is not configured yet.";
      auditLog("provider.models_credential_unavailable", {
        provider_profile: selectedProfile,
        provider_id: selectedAdapterConfig.provider_id ?? selectedProfile,
        message: error instanceof Error ? error.message : "Unknown credential resolution error",
      });
    }

    const modelAdapter = createModelAdapter(runtimeConfig.provider_adapter, selectedAdapterConfig, scopedPreferences, {
      apiKey: resolvedProviderCredential?.apiKey,
    });

    if (typeof modelAdapter.listModels === "function") {
      try {
        const listed = await modelAdapter.listModels();
        models = mergeProviderModels(listed, fallbackModels);
        source = "provider";
      } catch (error) {
        if (!warning) {
          warning = error instanceof Error ? error.message : "Provider model catalog unavailable";
        }
        auditLog("provider.models_error", {
          provider_profile: selectedProfile,
          provider_id: selectedAdapterConfig.provider_id ?? selectedProfile,
          message: error instanceof Error ? error.message : "Provider model catalog unavailable",
        });
      }
    }

    reply.header("cache-control", "no-store");
    reply.send({
      provider_profile: selectedProfile,
      provider_id: selectedAdapterConfig.provider_id ?? selectedProfile,
      source,
      models,
      ...(warning ? { warning } : {}),
    });
  });

  app.put("/settings", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsed = settingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/settings", parsed.error.issues.length);
      return;
    }

    const body = parsed.data;
    const currentPreferences = await loadPreferences(runtimeConfig.memory_root);
    const nextPreferences = { ...currentPreferences };

    if (body.default_model !== undefined) {
      nextPreferences.default_model = body.default_model;
    }

    if (body.active_provider_profile !== undefined) {
      if (body.active_provider_profile === null) {
        delete nextPreferences.active_provider_profile;
      } else if (!isKnownProviderProfile(adapterConfig, body.active_provider_profile)) {
        sendInvalidRequest(reply, "/settings", 1);
        return;
      } else {
        nextPreferences.active_provider_profile = body.active_provider_profile;
      }
    }

    await savePreferences(runtimeConfig.memory_root, nextPreferences);
    reply.send(buildSettingsPayload(adapterConfig, nextPreferences));
  });

  app.put("/settings/credentials", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsed = settingsCredentialsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/settings/credentials", parsed.error.issues.length);
      return;
    }

    const body = parsed.data;
    if (!isKnownProviderProfile(adapterConfig, body.provider_profile)) {
      sendInvalidRequest(reply, "/settings/credentials", 1);
      return;
    }

    const currentPreferences = await loadPreferences(runtimeConfig.memory_root);
    const nextPreferences: Preferences = {
      ...currentPreferences,
      provider_credentials: { ...(currentPreferences.provider_credentials ?? {}) },
      secret_resolution: currentPreferences.secret_resolution ?? { on_missing: "fail_closed" },
    };
    const selectedProfile = resolveAdapterProfile(adapterConfig, body.provider_profile);
    const providerId = selectedProfile.provider_id ?? body.provider_profile;
    const mode = body.mode ?? "secret_ref";

    let secretRef: string | undefined;
    if (mode === "plain") {
      nextPreferences.provider_credentials![providerId] = {
        mode: "plain",
        required: body.required ?? false,
      };
    } else {
      secretRef = body.secret_ref?.trim() || `provider/${providerId}/api_key`;
      const normalizedApiKey = body.api_key!.trim();
      const paths = resolveSecretsPaths();
      let masterKey;
      try {
        masterKey = await loadMasterKey(paths);
      } catch {
        await initializeMasterKey({ paths });
        masterKey = await loadMasterKey(paths);
      }
      await upsertVaultSecret(secretRef, normalizedApiKey, masterKey, paths);
      nextPreferences.provider_credentials![providerId] = {
        mode: "secret_ref",
        secret_ref: secretRef,
        required: body.required ?? true,
      };
    }

    if (body.set_active_provider) {
      nextPreferences.active_provider_profile = body.provider_profile;
    }

    await savePreferences(runtimeConfig.memory_root, nextPreferences);
    const onboardingStatus = await buildOnboardingStatusPayload(adapterConfig, nextPreferences);
    auditLog("settings.credentials_update", {
      provider_profile: body.provider_profile,
      provider_id: providerId,
      mode,
      required: mode === "plain" ? body.required ?? false : body.required ?? true,
      set_active_provider: Boolean(body.set_active_provider),
      secret_ref: secretRef,
    });

    reply.header("cache-control", "no-store");
    reply.send({
      settings: buildSettingsPayload(adapterConfig, nextPreferences),
      onboarding: onboardingStatus,
    });
  });

  app.get("/skills", async (request) => {
    authorize(request.authContext, "administration");
    return skills.listSkills();
  });

  app.get("/skills/:id", async (request, reply) => {
    authorize(request.authContext, "administration");
    const params = request.params as { id: string };
    const skill = await skills.getSkill(params.id);
    if (!skill) {
      reply.code(404).send({ error: "Skill not found" });
      return;
    }
    reply.send(skill);
  });

  app.post("/skills", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsed = skillCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/skills", parsed.error.issues.length);
      return;
    }

    try {
      const created = await skills.createSkill(parsed.data);
      auditLog("skills.mutation", {
        action: "create",
        skill_id: created.skill.manifest.id,
      });
      reply.code(201).send(created);
    } catch (error) {
      if (isInvalidSkillMutationError(error)) {
        sendInvalidRequest(reply, "/skills", 1);
        return;
      }
      throw error;
    }
  });

  app.put("/skills/:id", async (request, reply) => {
    authorize(request.authContext, "administration");
    const params = request.params as { id: string };
    const parsed = skillUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/skills/:id", parsed.error.issues.length);
      return;
    }

    try {
      const updated = await skills.updateSkill(params.id, parsed.data);
      if (!updated) {
        reply.code(404).send({ error: "Skill not found" });
        return;
      }
      auditLog("skills.mutation", {
        action: "update",
        skill_id: updated.skill.manifest.id,
      });
      reply.send(updated);
    } catch (error) {
      if (isInvalidSkillMutationError(error)) {
        sendInvalidRequest(reply, "/skills/:id", 1);
        return;
      }
      throw error;
    }
  });

  app.delete("/skills/:id", async (request, reply) => {
    authorize(request.authContext, "administration");
    const params = request.params as { id: string };
    const deleted = await skills.deleteSkill(params.id);
    if (!deleted) {
      reply.code(404).send({ error: "Skill not found" });
      return;
    }
    auditLog("skills.mutation", {
      action: "delete",
      skill_id: params.id,
    });
    reply.code(204).send();
  });

  app.get("/export", async (request, reply) => {
    authorize(request.authContext, "memory_access");
    const result = await exportMemory(runtimeConfig.memory_root);
    const fileName = path.basename(result.archive_path);
    reply.header("content-type", "application/gzip");
    reply.header("content-disposition", `attachment; filename="${fileName}"`);
    return reply.send(createReadStream(result.archive_path));
  });

  app.get("/projects", async () => projects.listProjects());

  app.get("/projects/:id/skills", async (request, reply) => {
    authorize(request.authContext, "administration");
    const params = request.params as { id: string };
    const skillIds = await projects.getProjectSkills(params.id);
    if (!skillIds) {
      reply.code(404).send({ error: "Project not found" });
      return;
    }

    reply.send({
      project_id: params.id,
      skill_ids: skillIds,
    });
  });

  app.put("/projects/:id/skills", async (request, reply) => {
    authorize(request.authContext, "administration");
    const params = request.params as { id: string };
    const parsed = skillBindingUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/projects/:id/skills", parsed.error.issues.length);
      return;
    }

    const validated = await skills.validateSkillIds(parsed.data.skill_ids);
    if (validated.missing.length > 0) {
      sendInvalidRequest(reply, "/projects/:id/skills", validated.missing.length);
      return;
    }

    const updated = await projects.setProjectSkills(params.id, validated.valid);
    if (!updated) {
      reply.code(404).send({ error: "Project not found" });
      return;
    }

    const source = parsed.data.source ?? "api";
    auditLog("skills.binding.update", {
      scope: "project",
      project_id: params.id,
      skill_ids: validated.valid,
      source,
    });
    reply.send({
      project_id: params.id,
      skill_ids: validated.valid,
      source,
    });
  });

  app.post("/projects", async (request, reply) => {
    const parsed = projectCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/projects", parsed.error.issues.length);
      return;
    }

    const created = await projects.createProject(parsed.data.name, parsed.data.icon);
    reply.code(201).send(created);
  });

  app.patch("/projects/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = projectRenameSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/projects/:id", parsed.error.issues.length);
      return;
    }

    const project = await projects.getProject(params.id);
    if (!project) {
      reply.code(404).send({ error: "Project not found" });
      return;
    }

    try {
      await projects.renameProject(params.id, parsed.data.name);
      reply.send({ ok: true });
    } catch (error) {
      if (error instanceof ProtectedProjectError) {
        reply.code(403).send({ error: "Project is protected" });
        return;
      }

      throw error;
    }
  });

  app.delete("/projects/:id", async (request, reply) => {
    const params = request.params as { id: string };
    try {
      const deleted = await projects.deleteProject(params.id);
      if (!deleted) {
        reply.code(404).send({ error: "Project not found" });
        return;
      }

      reply.code(204).send();
    } catch (error) {
      if (error instanceof ProtectedProjectError) {
        reply.code(403).send({ error: "Project is protected" });
        return;
      }

      throw error;
    }
  });

  app.get("/projects/:id/files", async (request, reply) => {
    const params = request.params as { id: string };
    const result = await projects.listProjectFiles(params.id);
    if (!result) {
      reply.code(404).send({ error: "Project not found" });
      return;
    }

    return result;
  });

  app.get("/projects/:id/file-content", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { path?: string };
    if (!query.path) {
      reply.code(400).send({ error: "Invalid path" });
      return;
    }

    try {
      const content = await projects.readProjectFile(params.id, query.path);
      if (content === null) {
        reply.code(404).send({ error: "Project not found" });
        return;
      }

      reply.send({ content });
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid path") {
        reply.code(400).send({ error: "Invalid path" });
        return;
      }

      if (isNotFoundError(error)) {
        reply.code(404).send({ error: "File not found" });
        return;
      }

      throw error;
    }
  });

  app.put("/projects/:id/file-content", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { path?: string };
    if (!query.path) {
      reply.code(400).send({ error: "Invalid path" });
      return;
    }

    const parsed = fileContentWriteSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/projects/:id/file-content", parsed.error.issues.length);
      return;
    }

    try {
      const written = await projects.writeProjectFile(params.id, query.path, parsed.data.content);
      if (!written) {
        reply.code(404).send({ error: "Project not found" });
        return;
      }

      reply.send({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid path") {
        reply.code(400).send({ error: "Invalid path" });
        return;
      }

      throw error;
    }
  });

  return {
    app,
    runtimeConfig,
    adapterConfig,
    rootDir,
  };
}

function createConversationRepository(runtimeConfig: RuntimeConfig): ConversationRepository {
  switch (runtimeConfig.conversation_store) {
    case "markdown":
      return new MarkdownConversationStore(runtimeConfig.memory_root);
    default:
      throw new Error(`Unsupported conversation store: ${(runtimeConfig as { conversation_store?: string }).conversation_store ?? "unknown"}`);
  }
}

function sendInvalidRequest(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => void } },
  route: string,
  issueCount: number
): void {
  auditLog("contract.error", {
    route,
    status: 400,
    reason: "invalid_request",
    issue_count: issueCount,
  });
  reply.code(400).send({ error: "Invalid request" });
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function isInvalidSkillMutationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Skill already exists") ||
    error.message.includes("Skill content is required") ||
    error.message.includes("Skill description is required") ||
    error.message.includes("Skill name is required") ||
    error.message.includes("Invalid skill id") ||
    error.message.includes("At least one skill field is required")
  );
}

function buildSettingsPayload(
  adapterConfig: AdapterConfig,
  preferences: Preferences
): {
  default_model: string;
  approval_mode: "ask-on-write";
  active_provider_profile: string | null;
  default_provider_profile: string | null;
  available_models: string[];
  provider_profiles: Array<{
    id: string;
    provider_id: string;
    base_url: string;
    model: string;
    credential_mode: "plain" | "secret_ref" | "unset";
    credential_ref: string | null;
  }>;
} {
  const profiles = listProviderProfiles(adapterConfig);
  const providerProfilePayload = profiles.map((profile) => {
    const credential = preferences.provider_credentials?.[profile.provider_id];
    const credentialMode: "plain" | "secret_ref" | "unset" =
      credential?.mode === "secret_ref"
        ? "secret_ref"
        : credential?.mode === "plain"
          ? "plain"
          : "unset";
    return {
      ...profile,
      credential_mode: credentialMode,
      credential_ref: credential?.mode === "secret_ref" ? credential.secret_ref : null,
    };
  });

  const availableModels = Array.from(
    new Set(
      [preferences.default_model, ...providerProfilePayload.map((profile) => profile.model)].filter(
        (value) => value.trim().length > 0
      )
    )
  );

  return {
    default_model: preferences.default_model,
    approval_mode: preferences.approval_mode,
    active_provider_profile: preferences.active_provider_profile ?? null,
    default_provider_profile: adapterConfig.default_provider_profile ?? null,
    available_models: availableModels,
    provider_profiles: providerProfilePayload,
  };
}

async function buildOnboardingStatusPayload(
  adapterConfig: AdapterConfig,
  preferences: Preferences
): Promise<{
  onboarding_required: boolean;
  active_provider_profile: string | null;
  default_provider_profile: string | null;
  providers: Array<{
    profile_id: string;
    provider_id: string;
    credential_mode: "plain" | "secret_ref" | "unset";
    credential_ref: string | null;
    requires_secret: boolean;
    credential_resolved: boolean;
    resolution_source: "env_ref" | "vault" | "none";
    resolution_error: string | null;
  }>;
}> {
  const profiles = listProviderProfiles(adapterConfig);
  const providerStatuses = await Promise.all(
    profiles.map(async (profile) => {
      const preference = preferences.provider_credentials?.[profile.provider_id];
      if (!preference) {
        return {
          profile_id: profile.id,
          provider_id: profile.provider_id,
          credential_mode: "unset" as const,
          credential_ref: null,
          requires_secret: false,
          credential_resolved: true,
          resolution_source: "none" as const,
          resolution_error: null,
        };
      }

      if (preference.mode === "plain") {
        return {
          profile_id: profile.id,
          provider_id: profile.provider_id,
          credential_mode: "plain" as const,
          credential_ref: null,
          requires_secret: false,
          credential_resolved: true,
          resolution_source: "none" as const,
          resolution_error: null,
        };
      }

      const envRef = preference.env_ref?.trim();
      if (envRef && process.env[envRef]?.trim()) {
        return {
          profile_id: profile.id,
          provider_id: profile.provider_id,
          credential_mode: "secret_ref" as const,
          credential_ref: preference.secret_ref,
          requires_secret: preference.required ?? true,
          credential_resolved: true,
          resolution_source: "env_ref" as const,
          resolution_error: null,
        };
      }

      try {
        const paths = resolveSecretsPaths();
        const masterKey = await loadMasterKey(paths);
        const value = await getVaultSecret(preference.secret_ref, masterKey, paths);
        return {
          profile_id: profile.id,
          provider_id: profile.provider_id,
          credential_mode: "secret_ref" as const,
          credential_ref: preference.secret_ref,
          requires_secret: preference.required ?? true,
          credential_resolved: Boolean(value && value.trim().length > 0),
          resolution_source: value ? ("vault" as const) : ("none" as const),
          resolution_error: value ? null : "Secret reference is not set in vault",
        };
      } catch (error) {
        return {
          profile_id: profile.id,
          provider_id: profile.provider_id,
          credential_mode: "secret_ref" as const,
          credential_ref: preference.secret_ref,
          requires_secret: preference.required ?? true,
          credential_resolved: false,
          resolution_source: "none" as const,
          resolution_error: sanitizeCredentialResolutionError(error),
        };
      }
    })
  );

  const selectedProfile = resolveSettingsModelProfile(adapterConfig, preferences);
  const selectedProvider = providerStatuses.find((provider) => provider.profile_id === selectedProfile) ?? null;
  const onboardingRequired = Boolean(
    selectedProvider &&
      selectedProvider.credential_mode === "secret_ref" &&
      selectedProvider.requires_secret &&
      !selectedProvider.credential_resolved
  );

  return {
    onboarding_required: onboardingRequired,
    active_provider_profile: preferences.active_provider_profile ?? null,
    default_provider_profile: adapterConfig.default_provider_profile ?? null,
    providers: providerStatuses,
  };
}

function listProviderProfiles(adapterConfig: AdapterConfig): Array<{
  id: string;
  provider_id: string;
  base_url: string;
  model: string;
}> {
  const providerProfiles = adapterConfig.provider_profiles;
  if (providerProfiles && Object.keys(providerProfiles).length > 0) {
    return Object.entries(providerProfiles).map(([id, profile]) => ({
      id,
      provider_id: profile.provider_id ?? id,
      base_url: profile.base_url,
      model: profile.model,
    }));
  }

  return [
    {
      id: adapterConfig.default_provider_profile ?? "default",
      provider_id: adapterConfig.provider_id ?? "default",
      base_url: "",
      model: adapterConfig.model,
    },
  ];
}

function resolveAdapterProfile(
  adapterConfig: AdapterConfig,
  profileId: string
): {
  base_url: string;
  model: string;
  api_key_env: string;
  provider_id?: string;
} {
  const profiles = adapterConfig.provider_profiles;
  if (profiles && profiles[profileId]) {
    return profiles[profileId];
  }

  return {
    base_url: adapterConfig.base_url,
    model: adapterConfig.model,
    api_key_env: adapterConfig.api_key_env,
    provider_id: adapterConfig.provider_id,
  };
}

function sanitizeCredentialResolutionError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("not initialized")) {
    return "Secret vault key is not initialized";
  }
  if (message.includes("integrity check")) {
    return "Stored secret could not be decrypted with current key";
  }
  return "Credential resolution failed";
}

function resolveSettingsModelProfile(
  adapterConfig: {
    default_provider_profile?: string;
    provider_profiles?: Record<string, unknown>;
  },
  preferences: Preferences,
  requestedProfile?: string
): string {
  const trimmedRequested = requestedProfile?.trim();
  if (trimmedRequested && trimmedRequested.length > 0) {
    return trimmedRequested;
  }

  const trimmedPreference = preferences.active_provider_profile?.trim();
  if (trimmedPreference && trimmedPreference.length > 0) {
    return trimmedPreference;
  }

  const trimmedDefault = adapterConfig.default_provider_profile?.trim();
  if (trimmedDefault && trimmedDefault.length > 0) {
    return trimmedDefault;
  }

  const configuredProfiles = adapterConfig.provider_profiles;
  if (configuredProfiles && Object.keys(configuredProfiles).length > 0) {
    return Object.keys(configuredProfiles)[0] ?? "default";
  }

  return "default";
}

function toFallbackProviderModels(models: string[]): ProviderModel[] {
  return models
    .filter((model) => model.trim().length > 0)
    .map((model) => ({ id: model, tags: ["configured"] }));
}

function mergeProviderModels(primary: ProviderModel[], fallback: ProviderModel[]): ProviderModel[] {
  const merged = new Map<string, ProviderModel>();

  for (const model of [...primary, ...fallback]) {
    const key = model.id.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, model);
      continue;
    }

    const tags = Array.from(new Set([...(existing.tags ?? []), ...(model.tags ?? [])]));
    merged.set(key, {
      ...existing,
      ...model,
      tags: tags.length > 0 ? tags : undefined,
    });
  }

  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function isKnownProviderProfile(
  adapterConfig: {
    default_provider_profile?: string;
    provider_profiles?: Record<string, unknown>;
  },
  profileId: string
): boolean {
  const configuredProfiles = adapterConfig.provider_profiles;
  if (configuredProfiles && Object.keys(configuredProfiles).length > 0) {
    return profileId in configuredProfiles;
  }

  return profileId === (adapterConfig.default_provider_profile ?? "default");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const rootDir = process.cwd();
  buildServer(rootDir)
    .then(async ({ app, runtimeConfig }) => {
      await app.listen({ host: runtimeConfig.bind_address, port: runtimeConfig.port ?? 8787 });
      auditLog("startup.listen", { host: runtimeConfig.bind_address, port: runtimeConfig.port ?? 8787 });
    })
    .catch((error) => {
      auditLog("startup.failure", {
        message: error instanceof Error ? error.message : "Unknown startup error",
      });
      process.exitCode = 1;
    });
}
