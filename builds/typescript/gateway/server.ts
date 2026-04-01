import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { z } from "zod";

import { createGatewayAdapter } from "../adapters/gateway.js";
import { createModelAdapter, resolveAdapterConfigForPreferences } from "../adapters/index.js";
import type { ProviderModel } from "../adapters/base.js";
import { authorize, authorizeApprovalDecision } from "../auth/authorize.js";
import { authMiddleware } from "../auth/middleware.js";
import {
  AccountAlreadyInitializedError,
  AccountInitializationLockedError,
  toBootstrapStatus,
  withSignupLock,
} from "../auth/account-store.js";
import {
  createLocalJwtAuthService,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RefreshReplayDetectedError,
} from "../auth/local-jwt-auth.js";
import { evaluateSignupBootstrapAccess } from "../auth/signup-bootstrap.js";
import {
  ensureSystemAppConfig,
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
import { commitMemoryChange, ensureGitReady } from "../git.js";
import { auditLog } from "../logger.js";
import { ensureAuthState, saveAuthState } from "../memory/auth-state.js";
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
    provider_base_url: z
      .object({
        provider_profile: z.string().trim().min(1),
        base_url: z.string().trim().url(),
      })
      .optional(),
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

const authCredentialsSchema = z
  .object({
    identifier: z.string().trim().min(1),
    password: z.string().min(8),
  })
  .strict();

const REFRESH_COOKIE_NAME = "paa_refresh_token";
const PUBLIC_ROUTES = new Set([
  "/health",
  "/config",
  "/auth/bootstrap-status",
  "/auth/signup",
  "/auth/login",
  "/auth/refresh",
]);

export async function buildServer(rootDir = process.cwd()) {
  auditLog("startup.phase", { phase: "runtime-config" });
  const runtimeConfig = await loadRuntimeConfig(rootDir);
  const appVersion = await resolveAppVersion(rootDir, runtimeConfig.memory_root);

  auditLog("startup.phase", { phase: "adapter-config" });
  const adapterConfig = await loadAdapterConfig(rootDir, runtimeConfig.provider_adapter);

  auditLog("startup.phase", { phase: "tools" });
  const tools = await discoverTools(rootDir, runtimeConfig.memory_root, runtimeConfig.tool_sources);

  auditLog("startup.phase", { phase: "memory" });
  await ensureMemoryLayout(rootDir, runtimeConfig.memory_root);
  await ensureGitReady(runtimeConfig.memory_root);
  const appConfigSync = await ensureSystemAppConfig(
    runtimeConfig.memory_root,
    runtimeConfig.install_mode
  );
  auditLog("startup.install_mode", {
    install_mode: runtimeConfig.install_mode,
    app_config_path: appConfigSync.path,
    app_config_updated: appConfigSync.updated,
  });

  auditLog("startup.phase", { phase: "preferences" });
  const preferences = await loadPreferences(runtimeConfig.memory_root);
  let authState = await ensureAuthState(runtimeConfig.memory_root, { mode: runtimeConfig.auth_mode });
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

  const app = Fastify({ logger: false, trustProxy: true });
  const approvalStore = new ApprovalStore();
  const toolExecutor = new ToolExecutor(tools);
  const conversations = new GatewayConversationService(createConversationRepository(runtimeConfig));
  const projects = new GatewayProjectService(runtimeConfig.memory_root, { rootDir });
  const skills = new GatewaySkillService(runtimeConfig.memory_root);
  const signupRateLimiter = new FixedWindowRateLimiter(5, 5 * 60 * 1000);
  const loginRateLimiter = new FixedWindowRateLimiter(10, 5 * 60 * 1000);
  const refreshRateLimiter = new FixedWindowRateLimiter(30, 5 * 60 * 1000);
  const signupBootstrapToken = process.env.PAA_AUTH_BOOTSTRAP_TOKEN?.trim();
  const allowFirstSignupFromAnyIp = readBooleanEnv(process.env.PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP, false);
  const persistAuthState = async (nextState: typeof authState): Promise<void> => {
    authState = await saveAuthState(runtimeConfig.memory_root, nextState);
  };
  const localJwtAuthService =
    runtimeConfig.auth_mode === "local"
      ? createLocalJwtAuthService({
          memoryRoot: runtimeConfig.memory_root,
          getAuthState: () => authState,
          persistAuthState,
        })
      : null;

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/auth/bootstrap-status", async () => toBootstrapStatus(authState));

  app.post("/auth/signup", async (request, reply) => {
    if (!localJwtAuthService) {
      reply.code(404).send({ error: "Not found" });
      return;
    }

    if (!signupRateLimiter.allow(request.ip)) {
      reply.code(429).send({ error: "too_many_requests" });
      return;
    }

    if (!authState.account_initialized && !allowFirstSignupFromAnyIp) {
      const signupAccess = evaluateSignupBootstrapAccess(
        {
          ip: request.ip,
          headers: request.headers as Record<string, unknown>,
        },
        signupBootstrapToken
      );
      if (!signupAccess.allowed) {
        auditLog("auth.signup.denied", {
          reason: signupAccess.reason,
          ip: request.ip,
        });
        reply.code(403).send({ error: signupAccess.reason });
        return;
      }
    } else if (!authState.account_initialized && allowFirstSignupFromAnyIp) {
      auditLog("auth.signup.bootstrap_override", {
        reason: "allow_first_signup_any_ip",
        ip: request.ip,
      });
    }

    const parsed = authCredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/auth/signup", parsed.error.issues.length);
      return;
    }

    try {
      const tokens = await withSignupLock(runtimeConfig.memory_root, async () =>
        localJwtAuthService.signup(parsed.data)
      );
      reply.header(
        "set-cookie",
        serializeRefreshCookie(tokens.refreshToken, tokens.refreshMaxAgeSeconds, isSecureRequest(request))
      );
      reply.code(201).send({
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_at: tokens.accessTokenExpiresAt,
      });
    } catch (error) {
      if (error instanceof AccountAlreadyInitializedError || error instanceof AccountInitializationLockedError) {
        auditLog("auth.signup.denied", { reason: "account_already_initialized" });
        reply.code(409).send({ error: "account_already_initialized" });
        return;
      }

      if (error instanceof InvalidCredentialsError) {
        auditLog("auth.signup.denied", { reason: "invalid_credentials" });
        reply.code(400).send({ error: "invalid_credentials" });
        return;
      }

      throw error;
    }
  });

  app.post("/auth/login", async (request, reply) => {
    if (!localJwtAuthService) {
      reply.code(404).send({ error: "Not found" });
      return;
    }

    if (!loginRateLimiter.allow(request.ip)) {
      reply.code(429).send({ error: "too_many_requests" });
      return;
    }

    const parsed = authCredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/auth/login", parsed.error.issues.length);
      return;
    }

    try {
      const tokens = await localJwtAuthService.login(parsed.data);
      reply.header(
        "set-cookie",
        serializeRefreshCookie(tokens.refreshToken, tokens.refreshMaxAgeSeconds, isSecureRequest(request))
      );
      reply.send({
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_at: tokens.accessTokenExpiresAt,
      });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        reply.code(401).send({ error: "invalid_credentials" });
        return;
      }

      throw error;
    }
  });

  app.post("/auth/refresh", async (request, reply) => {
    if (!localJwtAuthService) {
      reply.code(404).send({ error: "Not found" });
      return;
    }

    if (!refreshRateLimiter.allow(request.ip)) {
      reply.code(429).send({ error: "too_many_requests" });
      return;
    }

    const refreshToken = readRefreshTokenFromRequest(request.headers.cookie);
    if (!refreshToken) {
      reply.code(401).send({ error: "invalid_refresh_token" });
      return;
    }

    try {
      const tokens = await localJwtAuthService.refresh(refreshToken);
      reply.header(
        "set-cookie",
        serializeRefreshCookie(tokens.refreshToken, tokens.refreshMaxAgeSeconds, isSecureRequest(request))
      );
      reply.send({
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_at: tokens.accessTokenExpiresAt,
      });
    } catch (error) {
      if (error instanceof RefreshReplayDetectedError) {
        reply.header("set-cookie", serializeRefreshCookieClear(isSecureRequest(request)));
        reply.code(401).send({ error: "refresh_replay_detected" });
        return;
      }

      if (error instanceof InvalidRefreshTokenError) {
        reply.code(401).send({ error: "invalid_refresh_token" });
        return;
      }

      throw error;
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    if (localJwtAuthService) {
      await localJwtAuthService.logout();
      reply.header("set-cookie", serializeRefreshCookieClear(isSecureRequest(request)));
    }

    reply.send({ ok: true });
  });

  app.addHook("preHandler", async (request, reply) => {
    const requestPath = stripQueryString(request.url);
    if (isPublicRoute(requestPath)) {
      return;
    }

    await authMiddleware(request, reply, {
      mode: runtimeConfig.auth_mode,
      getAuthState: () => authState,
      authenticateLocalJwtAccessToken: localJwtAuthService
        ? async (accessToken: string) => localJwtAuthService.authenticateAccessToken(accessToken)
        : undefined,
    });
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

    // Inject project context so the AI knows which project it's operating in.
    // Without this, the AI sees the base prompt but doesn't know which project
    // files to read — it would read all projects and behave like BD+1.
    const projectContext = projectId
      ? `\n\n## Active Project\n\nYou are currently in the **${projectId}** project. Read this project's AGENT.md, spec.md, and plan.md from the documents/${projectId}/ folder. Stay focused on this domain — do not read or reference other projects unless the conversation specifically calls for cross-domain connections.`
      : "";
    const finalPrompt = promptWithSkills.prompt + projectContext;

    const engineRequest = gatewayAdapter.buildEngineRequest({
      conversationId,
      correlationId: crypto.randomUUID(),
      messages: conversations.buildConversationMessages(conversationId, finalPrompt),
      ...(body.metadata ? { clientMetadata: body.metadata } : {}),
    });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
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
    mode: runtimeConfig.auth_mode === "managed" ? "managed" : "local",
    install_mode: runtimeConfig.install_mode,
    app_version: appVersion,
    gateway_url: "/api",
    features: {
      approvals: true,
      projects: true,
      export: true,
    },
  }));

  app.get("/session", async (request) => ({
    mode: runtimeConfig.auth_mode === "managed" ? "managed" : "local",
    user: {
      id: request.authContext.actorId,
      name: authState.account_username ?? "Local Owner",
      initials: toInitials(authState.account_username ?? "Local Owner"),
      email: `${(authState.account_username ?? "owner").toLowerCase()}@local.paa`,
      role: request.authContext.actorType,
    },
  }));

  app.get("/profile", async (request, reply) => {
    authorize(request.authContext, "memory_access");
    const profilePath = path.join(runtimeConfig.memory_root, "me", "profile.md");
    if (!existsSync(profilePath)) {
      reply.code(404);
      return { content: null };
    }
    const content = await readFile(profilePath, "utf8");
    return { content };
  });

  app.put("/profile", async (request) => {
    authorize(request.authContext, "memory_access");
    const body = request.body as { content?: string };
    if (typeof body?.content !== "string") {
      throw new Error("Invalid request body");
    }
    const profileDir = path.join(runtimeConfig.memory_root, "me");
    const profilePath = path.join(profileDir, "profile.md");
    const { mkdir, writeFile: writeFileAsync } = await import("node:fs/promises");
    await mkdir(profileDir, { recursive: true });
    await writeFileAsync(profilePath, body.content, "utf8");
    await commitMemoryChange(runtimeConfig.memory_root, "Update owner profile via UI").catch(() => {});
    return { ok: true };
  });

  app.get("/settings", async (request) => {
    authorize(request.authContext, "administration");
    const currentPreferences = await loadPreferences(runtimeConfig.memory_root);
    return buildSettingsPayload(adapterConfig, currentPreferences);
  });

  app.get("/settings/onboarding-status", async (request) => {
    authorize(request.authContext, "administration");
    const currentPreferences = await loadPreferences(runtimeConfig.memory_root);
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
        models = listed.length > 0 ? listed : fallbackModels;
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

    reply.send({
      provider_profile: selectedProfile,
      provider_id: selectedAdapterConfig.provider_id ?? selectedProfile,
      source,
      models,
      ...(warning ? { warning } : {}),
    });
  });

  const modelPullSchema = z
    .object({
      model: z.string().trim().min(1),
      provider_profile: z.string().trim().min(1).optional(),
    })
    .strict();

  app.post("/settings/models/pull", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsed = modelPullSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/settings/models/pull", parsed.error.issues.length);
      return;
    }

    const currentPreferences = await loadPreferences(runtimeConfig.memory_root);
    const profileId = parsed.data.provider_profile ??
      currentPreferences.active_provider_profile ??
      adapterConfig.default_provider_profile ??
      "";

    if (!isKnownProviderProfile(adapterConfig, profileId)) {
      sendInvalidRequest(reply, "/settings/models/pull", 1);
      return;
    }

    const scopedPreferences: Preferences = {
      ...currentPreferences,
      active_provider_profile: profileId,
    };
    const selectedAdapterConfig = resolveAdapterConfigForPreferences(adapterConfig, scopedPreferences);
    const providerBaseUrl = selectedAdapterConfig.base_url;

    let ollamaOrigin: string;
    try {
      ollamaOrigin = new URL(providerBaseUrl).origin;
    } catch {
      reply.code(400).send({ error: "Invalid provider base URL" });
      return;
    }

    try {
      const pullResponse = await fetch(`${ollamaOrigin}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: parsed.data.model, stream: true }),
      });

      if (!pullResponse.ok) {
        const errorText = await pullResponse.text().catch(() => "Unknown error");
        auditLog("provider.model_pull_error", {
          provider_profile: profileId,
          model: parsed.data.model,
          status: pullResponse.status,
          message: errorText,
        });
        reply.code(502).send({ error: `Ollama pull failed: ${errorText}` });
        return;
      }

      if (!pullResponse.body) {
        reply.code(502).send({ error: "No response body from Ollama" });
        return;
      }

      reply.raw.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const reader = pullResponse.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) {
          reply.raw.write(decoder.decode(chunk.value, { stream: true }));
        }
      }

      reply.raw.end();

      auditLog("provider.model_pull_success", {
        provider_profile: profileId,
        model: parsed.data.model,
      });
    } catch (error) {
      auditLog("provider.model_pull_error", {
        provider_profile: profileId,
        model: parsed.data.model,
        message: error instanceof Error ? error.message : "fetch failed",
      });
      if (!reply.raw.headersSent) {
        reply.code(502).send({
          error: error instanceof Error ? error.message : "Failed to reach Ollama",
        });
      } else {
        reply.raw.end();
      }
    }
  });

  const modelDeleteSchema = z
    .object({
      model: z.string().trim().min(1),
      provider_profile: z.string().trim().min(1).optional(),
    })
    .strict();

  app.post("/settings/models/delete", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsed = modelDeleteSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/settings/models/delete", parsed.error.issues.length);
      return;
    }

    const currentPreferences = await loadPreferences(runtimeConfig.memory_root);
    const profileId = parsed.data.provider_profile ??
      currentPreferences.active_provider_profile ??
      adapterConfig.default_provider_profile ??
      "";

    if (!isKnownProviderProfile(adapterConfig, profileId)) {
      sendInvalidRequest(reply, "/settings/models/delete", 1);
      return;
    }

    const scopedPreferences: Preferences = {
      ...currentPreferences,
      active_provider_profile: profileId,
    };
    const selectedAdapterConfig = resolveAdapterConfigForPreferences(adapterConfig, scopedPreferences);

    let ollamaOrigin: string;
    try {
      ollamaOrigin = new URL(selectedAdapterConfig.base_url).origin;
    } catch {
      reply.code(400).send({ error: "Invalid provider base URL" });
      return;
    }

    try {
      const deleteResponse = await fetch(`${ollamaOrigin}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: parsed.data.model }),
      });

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text().catch(() => "Unknown error");
        auditLog("provider.model_delete_error", {
          provider_profile: profileId,
          model: parsed.data.model,
          status: deleteResponse.status,
          message: errorText,
        });
        reply.code(502).send({ error: `Ollama delete failed: ${errorText}` });
        return;
      }

      auditLog("provider.model_delete_success", {
        provider_profile: profileId,
        model: parsed.data.model,
      });
      reply.send({ status: "success", model: parsed.data.model });
    } catch (error) {
      auditLog("provider.model_delete_error", {
        provider_profile: profileId,
        model: parsed.data.model,
        message: error instanceof Error ? error.message : "fetch failed",
      });
      reply.code(502).send({
        error: error instanceof Error ? error.message : "Failed to reach Ollama",
      });
    }
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
      const activeProfile =
        (body.active_provider_profile ?? nextPreferences.active_provider_profile) ||
        adapterConfig.default_provider_profile ||
        listProviderProfiles(adapterConfig)[0]?.id;
      if (activeProfile) {
        const models = { ...nextPreferences.provider_default_models };
        models[activeProfile] = body.default_model;
        nextPreferences.provider_default_models = models;
      }
    }

    if (body.active_provider_profile !== undefined) {
      if (body.active_provider_profile === null) {
        delete nextPreferences.active_provider_profile;
      } else if (!isKnownProviderProfile(adapterConfig, body.active_provider_profile)) {
        sendInvalidRequest(reply, "/settings", 1);
        return;
      } else {
        nextPreferences.active_provider_profile = body.active_provider_profile;
        // When switching providers, sync default_model to the new provider's
        // per-provider default so display stays consistent. Model IDs are
        // provider-specific — the global default_model should reflect the
        // active provider's selection.
        if (body.default_model === undefined) {
          const newProviderModel = nextPreferences.provider_default_models?.[body.active_provider_profile];
          const profileConfig = adapterConfig.provider_profiles?.[body.active_provider_profile];
          const effectiveModel = newProviderModel ?? profileConfig?.model;
          if (effectiveModel) {
            nextPreferences.default_model = effectiveModel;
          }
        }
      }
    }

    if (body.provider_base_url !== undefined) {
      const { provider_profile, base_url } = body.provider_base_url;
      if (!isKnownProviderProfile(adapterConfig, provider_profile)) {
        sendInvalidRequest(reply, "/settings", 1);
        return;
      }
      const urls = { ...nextPreferences.provider_base_urls };
      urls[provider_profile] = base_url;
      nextPreferences.provider_base_urls = urls;
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

function isPublicRoute(urlPath: string): boolean {
  return PUBLIC_ROUTES.has(urlPath);
}

function stripQueryString(url: string): string {
  const index = url.indexOf("?");
  return index >= 0 ? url.slice(0, index) : url;
}

function readRefreshTokenFromRequest(cookieHeader: unknown): string | undefined {
  if (typeof cookieHeader !== "string" || cookieHeader.trim().length === 0) {
    return undefined;
  }

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.split("=");
    if (!rawName || rawValue.length === 0) {
      continue;
    }

    if (rawName.trim() !== REFRESH_COOKIE_NAME) {
      continue;
    }

    const serializedValue = rawValue.join("=").trim();
    if (serializedValue.length === 0) {
      continue;
    }

    return decodeURIComponent(serializedValue);
  }

  return undefined;
}

function serializeRefreshCookie(refreshToken: string, maxAgeSeconds: number, secure: boolean): string {
  const expires = new Date(Date.now() + maxAgeSeconds * 1000).toUTCString();
  return [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${expires}`,
    secure ? "Secure" : "",
  ]
    .filter((segment) => segment.length > 0)
    .join("; ");
}

function serializeRefreshCookieClear(secure: boolean): string {
  return [
    `${REFRESH_COOKIE_NAME}=`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    secure ? "Secure" : "",
  ]
    .filter((segment) => segment.length > 0)
    .join("; ");
}

function readBooleanEnv(value: string | undefined, defaultValue = false): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isSecureRequest(request: { headers: Record<string, unknown> }): boolean {
  const forwardedProto = request.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.toLowerCase().includes("https")) {
    return true;
  }

  return process.env.NODE_ENV === "production";
}

function toInitials(value: string): string {
  const parts = value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return "LO";
  }

  const first = parts[0]?.[0] ?? "L";
  const second = parts[1]?.[0] ?? (parts[0]?.[1] ?? "O");
  return `${first}${second}`.toUpperCase();
}

async function resolveAppVersion(rootDir: string, memoryRoot: string): Promise<string> {
  const envVersion = process.env.BRAINDRIVE_APP_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }

  const appliedReleaseVersion = await resolveAppliedReleaseVersion(memoryRoot);
  if (appliedReleaseVersion) {
    return appliedReleaseVersion;
  }

  try {
    const packagePath = path.join(rootDir, "package.json");
    const raw = await readFile(packagePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // Fall through to unknown for compatibility.
  }

  return "unknown";
}

async function resolveAppliedReleaseVersion(memoryRoot: string): Promise<string | null> {
  try {
    const statePath = path.join(memoryRoot, "system", "updates", "state.json");
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as { last_applied_version?: unknown };
    if (
      typeof parsed.last_applied_version === "string" &&
      parsed.last_applied_version.trim().length > 0
    ) {
      return parsed.last_applied_version.trim();
    }
  } catch {
    // Fall through to package/env fallback.
  }

  return null;
}

class FixedWindowRateLimiter {
  private readonly records = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string | undefined): boolean {
    const normalizedKey = key?.trim() || "unknown";
    const now = Date.now();
    const current = this.records.get(normalizedKey);
    if (!current || current.resetAt <= now) {
      this.records.set(normalizedKey, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return true;
    }

    if (current.count >= this.limit) {
      return false;
    }

    current.count += 1;
    this.records.set(normalizedKey, current);
    return true;
  }
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
    const baseUrlOverride = preferences.provider_base_urls?.[profile.id];
    return {
      ...profile,
      ...(baseUrlOverride ? { base_url: baseUrlOverride } : {}),
      credential_mode: credentialMode,
      credential_ref: credential?.mode === "secret_ref" ? credential.secret_ref : null,
    };
  });

  const activeProfileId =
    preferences.active_provider_profile ??
    adapterConfig.default_provider_profile ??
    profiles[0]?.id ??
    null;
  const activeProfileEntry = activeProfileId
    ? providerProfilePayload.find((p) => p.id === activeProfileId)
    : null;
  const effectiveDefaultModel =
    (activeProfileId ? preferences.provider_default_models?.[activeProfileId] : undefined) ??
    activeProfileEntry?.model ??
    preferences.default_model;

  const availableModels = Array.from(
    new Set(
      [effectiveDefaultModel].filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    )
  );

  return {
    default_model: effectiveDefaultModel,
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
