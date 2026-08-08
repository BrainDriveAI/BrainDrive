import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import { z } from "zod";

import { createAppLifecycle, type AppLifecycleRuntimeTarget } from "../app-platform/lifecycle/bootstrap.js";
import { registerAppLifecycleRoutes } from "../app-platform/lifecycle/routes.js";
import { AppMcpHost } from "../app-platform/mcp-host/app-host.js";
import { registerAppMcpHostRoutes } from "../app-platform/mcp-host/routes.js";
import { CareerPlacementAdapter } from "../resume-domain/career.js";
import { ResumeCapabilityRouter } from "../resume-domain/capabilities.js";
import { ResumeDomainService } from "../resume-domain/service.js";
import { ResumeDataStore } from "../resume-domain/store.js";
import { ResumeInferenceBroker } from "../resume-inference/broker.js";
import { createLiveProviderResolver, ModelCompatibilityRegistry, VERSIONED_MODEL_COMPATIBILITY_ENTRIES } from "../resume-inference/compatibility.js";
import { createResumeE2eFixtureProviderResolver } from "../resume-inference/e2e-fixture.js";
import { ImmutableInferenceSnapshotBuilder } from "../resume-inference/snapshot.js";
import { ResumeExportBroker } from "../resume-renderer/export-broker.js";

import { createGatewayAdapter } from "../adapters/gateway.js";
import {
  createModelAdapter,
  resolveAdapterConfigForPreferences,
  resolveEffectiveAdapterConfig,
} from "../adapters/index.js";
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
import type {
  AdapterConfig,
  ApprovalMode,
  ClientMessageRequest,
  ConversationDetail,
  ConversationMessage,
  GatewayEngineRequest,
  InstallLocation,
  Preferences,
  RuntimeConfig
} from "../contracts.js";
import { runAgentLoop, type ToolExecutionGuard } from "../engine/loop.js";
import { classifyProviderError } from "../engine/errors.js";
import { formatSseEvent } from "../engine/stream.js";
import { ToolExecutor } from "../engine/tool-executor.js";
import { commitMemoryChange, ensureGitReady } from "../git.js";
import { auditLog, configureAuditFileSink, disableAuditFileSink } from "../logger.js";
import { ensureAuthState, saveAuthState } from "../memory/auth-state.js";
import type { ConversationRepository } from "../memory/conversation-repository.js";
import { MarkdownConversationStore } from "../memory/conversation-store-markdown.js";
import { exportMemory } from "../memory/export.js";
import { createPromptAuditRecorder } from "../memory/prompt-audit-store.js";
import { restoreMemoryBackup } from "../memory/backup-restore.js";
import { importMigrationArchive } from "../memory/migration.js";
import {
  createSupportBundle,
  listSupportBundles,
  resolveSupportBundleDownloadPath,
} from "../memory/support-bundle.js";
import { discoverTools } from "../tools.js";
import { ApprovalStore } from "../engine/approval-store.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import { initializeMasterKey, loadMasterKey } from "../secrets/key-provider.js";
import { resolveSecretsPaths } from "../secrets/paths.js";
import { getVaultSecret, upsertVaultSecret } from "../secrets/vault.js";
import { GatewayConversationService } from "./conversations.js";
import {
  BRAINDRIVE_MODELS_PROVIDER_ID,
  BrainDriveModelsProvisioningError,
  ensureBrainDriveModelsClaimKey,
  ensureBrainDriveModelsCheckoutKey,
  resolveBrainDriveModelsSecretRef,
} from "./credits-provisioning.js";
import { createMemoryBackupScheduler } from "./memory-backup-scheduler.js";
import {
  decideClaimProviderActivation,
  decideExplicitProviderActivation,
  normalizeProviderActivationRevision,
} from "./provider-activation.js";
import { GatewayProjectService, isProjectMetadata, ProtectedProjectError, type GatewayProjectFile } from "./projects.js";
import { GatewaySkillService } from "./skills.js";
import { prepareContextWindow, type PreparedContextWindow } from "./context-window.js";

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

const rootAgentUpdateSchema = z
  .object({
    overlay_content: z.string(),
  })
  .strict();

const RETIRED_DOCUMENT_PROCESSING_MESSAGE =
  "Document processing has been retired in this build while BrainDrive redesigns file handling. No file was saved or processed.";

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

const memoryBackupFrequencySchema = z.enum(["manual", "after_changes", "hourly", "daily"]);

const settingsMemoryBackupUpdateSchema = z
  .object({
    repository_url: z.string().trim().url(),
    frequency: memoryBackupFrequencySchema,
    git_token: z.string().trim().min(1).optional(),
    token_secret_ref: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const repositoryUrlError = validateMemoryBackupRepositoryUrl(value.repository_url);
    if (repositoryUrlError) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: repositoryUrlError,
        path: ["repository_url"],
      });
    }
  });

const settingsMemoryBackupSaveSchema = z
  .object({
    on_remote_conflict: z.enum(["fail", "replace_remote"]).optional(),
  })
  .strict();

const settingsMemoryBackupRestoreSchema = z
  .object({
    target_commit: z.string().trim().min(1).optional(),
  })
  .strict();

const authCredentialsSchema = z
  .object({
    identifier: z.string().trim().min(1),
    password: z.string().min(8),
  })
  .strict();

const supportBundleCreateSchema = z
  .object({
    window_hours: z.number().int().min(1).max(24 * 30).optional(),
  })
  .strict();

const supportBundleDownloadParamsSchema = z
  .object({
    fileName: z.string().regex(/^support-bundle-\d{13}\.tar\.gz$/),
  })
  .strict();

const REFRESH_COOKIE_NAME = "paa_refresh_token";
const BASE_PUBLIC_ROUTES = new Set([
  "/health",
  "/config",
  "/auth/bootstrap-status",
  "/auth/signup",
  "/auth/login",
  "/auth/refresh",
]);

const MANAGED_PROXY_ROUTES = new Set([
  "/account",
  "/account/change-password",
  "/account/change-email",
  "/account/portal-session",
  "/account/topup",
]);

const DEFAULT_MEMORY_BACKUP_TOKEN_SECRET_REF = "backup/git/token";
const SYNTHETIC_LOCAL_EMAIL_SUFFIXES = ["@local.paa", "@local.braindrive"];

function isSyntheticLocalEmail(email: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  return SYNTHETIC_LOCAL_EMAIL_SUFFIXES.some((suffix) => normalizedEmail.endsWith(suffix));
}

export async function buildServer(rootDir = process.cwd()) {
  const isManaged = process.env.BD_DEPLOYMENT_MODE === "managed";
  const installLocation: InstallLocation = isManaged ? "managed" : "local";
  const managedApiBase = process.env.BD_MANAGED_API_BASE?.replace(/\/+$/, "") || "";
  const clientGatewayUrl = process.env.BRAINDRIVE_CLIENT_GATEWAY_URL?.trim() || "/api";
  const desktopApiToken = process.env.BRAINDRIVE_DESKTOP_API_TOKEN?.trim() || "";
  const internalTransportToken = process.env.BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN?.trim() || "";
  const desktopCorsOrigin = process.env.BRAINDRIVE_DESKTOP_CORS_ORIGIN?.trim() || "";
  const managedPublicAccountProxyRoutesEnv = process.env.PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES;
  const managedPublicAccountProxyRoutesConfigured =
    typeof managedPublicAccountProxyRoutesEnv === "string" &&
    managedPublicAccountProxyRoutesEnv.trim().length > 0;
  const allowManagedPublicAccountProxyRoutes = readBooleanEnv(
    managedPublicAccountProxyRoutesEnv,
    true
  );
  const publicRoutes = new Set(BASE_PUBLIC_ROUTES);

  if (isManaged && allowManagedPublicAccountProxyRoutes) {
    for (const p of MANAGED_PROXY_ROUTES) {
      publicRoutes.add(p);
    }
    auditLog("startup.managed_public_account_proxy_routes", {
      enabled: true,
      route_count: MANAGED_PROXY_ROUTES.size,
      managed_api_base_configured: managedApiBase.length > 0,
      configured_via_env: managedPublicAccountProxyRoutesConfigured,
      warning:
        "Managed /account proxy routes are publicly accessible. Set PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES=false to require gateway auth.",
    });
  } else if (isManaged) {
    auditLog("startup.managed_public_account_proxy_routes", {
      enabled: false,
      route_count: MANAGED_PROXY_ROUTES.size,
      managed_api_base_configured: managedApiBase.length > 0,
      configured_via_env: managedPublicAccountProxyRoutesConfigured,
    });
  }

  auditLog("startup.phase", { phase: "runtime-config" });
  const runtimeConfig = await loadRuntimeConfig(rootDir);
  const auditFileSinkEnabled = readBooleanEnv(process.env.PAA_AUDIT_FILE_SINK_ENABLED, true);
  if (auditFileSinkEnabled) {
    configureAuditFileSink(runtimeConfig.memory_root, {
      maxFileBytes: readPositiveIntEnv(process.env.PAA_AUDIT_MAX_FILE_BYTES, 5 * 1024 * 1024),
      retentionDays: readPositiveIntEnv(process.env.PAA_AUDIT_RETENTION_DAYS, 14),
    });
  } else {
    disableAuditFileSink();
  }
  auditLog("startup.audit_sink", {
    enabled: auditFileSinkEnabled,
    memory_root: runtimeConfig.memory_root,
    max_file_bytes: readPositiveIntEnv(process.env.PAA_AUDIT_MAX_FILE_BYTES, 5 * 1024 * 1024),
    retention_days: readPositiveIntEnv(process.env.PAA_AUDIT_RETENTION_DAYS, 14),
  });
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
    runtimeConfig.install_mode,
    installLocation
  );
  auditLog("startup.install_mode", {
    install_mode: runtimeConfig.install_mode,
    install_location: installLocation,
    app_config_path: appConfigSync.path,
    app_config_updated: appConfigSync.updated,
    app_config_install_mode: appConfigSync.installMode,
    app_config_install_location: appConfigSync.installLocation,
  });

  auditLog("startup.phase", { phase: "preferences" });
  const preferences = await loadPreferences(runtimeConfig.memory_root);
  let livePreferencesCache = preferences;
  const loadLivePreferences = async (): Promise<Preferences> => {
    try {
      const latest = await loadPreferences(runtimeConfig.memory_root);
      livePreferencesCache = latest;
      return latest;
    } catch (error) {
      auditLog("preferences.load_failed_using_cached", {
        message: error instanceof Error ? error.message : "Unknown preferences load error",
      });
      return livePreferencesCache;
    }
  };
  const saveLivePreferences = async (nextPreferences: Preferences): Promise<void> => {
    await savePreferences(runtimeConfig.memory_root, nextPreferences);
    livePreferencesCache = nextPreferences;
  };
  let providerIntentMutationTail = Promise.resolve();
  const withProviderIntentMutation = async <T>(mutation: () => Promise<T>): Promise<T> => {
    const previousMutation = providerIntentMutationTail;
    let releaseMutation!: () => void;
    providerIntentMutationTail = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    await previousMutation;
    try {
      return await mutation();
    } finally {
      releaseMutation();
    }
  };
  let authState = await ensureAuthState(runtimeConfig.memory_root, { mode: runtimeConfig.auth_mode });
  auditLog("startup.phase", { phase: "secrets" });
  const startupAdapterConfig = resolveAdapterConfigForPreferences(adapterConfig, preferences);
  let startupResolvedProviderCredential: Awaited<ReturnType<typeof resolveProviderCredentialForStartup>> | undefined;
  try {
    startupResolvedProviderCredential = await resolveProviderCredentialForStartup(
      runtimeConfig.provider_adapter,
      startupAdapterConfig,
      preferences
    );
    if (startupResolvedProviderCredential) {
      auditLog("secret.resolve", {
        provider_id: startupResolvedProviderCredential.providerId,
        provider_profile: preferences.active_provider_profile ?? adapterConfig.default_provider_profile,
        source: startupResolvedProviderCredential.source,
        secret_ref: startupResolvedProviderCredential.secretRef,
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

  const app = Fastify({
    logger: false,
    trustProxy: readBooleanEnv(process.env.BRAINDRIVE_TRUST_PROXY, true),
    bodyLimit: readPositiveIntEnv(process.env.PAA_MIGRATION_IMPORT_BODY_LIMIT_BYTES, 1024 * 1024 * 1024),
  });
  app.addContentTypeParser(
    ["application/gzip", "application/x-gzip", "application/octet-stream"],
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    }
  );

  const appLifecycleService = readBooleanEnv(process.env.BRAINDRIVE_APP_PLATFORM_ENABLED, false)
    ? await createAppLifecycle({
        memoryRoot: runtimeConfig.memory_root,
        hostVersion: appVersion,
        stateRoot: process.env.BRAINDRIVE_APP_STATE_ROOT?.trim() || undefined,
        target: readAppLifecycleTarget(process.env.BRAINDRIVE_APP_PLATFORM_TARGET),
      })
    : null;
  let appMcpHost: AppMcpHost | null = null;
  if (appLifecycleService) {
    const resumeDataStore = new ResumeDataStore(runtimeConfig.memory_root, appLifecycleService.dependencies.ownerDataRoot);
    const descriptor = await appLifecycleService.ownerDescriptor();
    await resumeDataStore.initialize(descriptor.grant?.owner_id ?? "00000000-0000-4000-8000-000000000001");
    const resumeDomain = new ResumeDomainService(resumeDataStore);
    const exportBroker = new ResumeExportBroker(resumeDomain, auditLog);
    const capabilityRouter = new ResumeCapabilityRouter(resumeDomain, new CareerPlacementAdapter(runtimeConfig.memory_root), auditLog, exportBroker);
    // Real provider/model pairs remain fail-closed until a conformance run supplies
    // accepted registry entries. Tests inject synthetic accepted entries.
    const compatibility = new ModelCompatibilityRegistry(VERSIONED_MODEL_COMPATIBILITY_ENTRIES);
    const inferenceResolver = process.env.BRAINDRIVE_E2E_RESUME_INFERENCE_FIXTURE === "1"
      ? createResumeE2eFixtureProviderResolver()
      : createLiveProviderResolver({
          adapterName: runtimeConfig.provider_adapter,
          adapterConfig,
          loadPreferences: loadLivePreferences,
          compatibility,
        });
    const inferenceBroker = new ResumeInferenceBroker(inferenceResolver, auditLog);
    appMcpHost = new AppMcpHost(appLifecycleService, {
      audit: auditLog,
      capabilityRouter,
      inferenceBroker,
      snapshotBuilder: new ImmutableInferenceSnapshotBuilder(resumeDataStore),
      exportBroker,
    });
  }
  if (appLifecycleService) {
    auditLog("app_platform.lifecycle.enabled", {
      app_id: "ai.braindrive.resume-builder",
      fixture_source: "repository_fixture",
      supervisor: process.env.BRAINDRIVE_APP_PLATFORM_TARGET === "desktop_windows_x64" ? "desktop_packaged_node" : "docker_process",
    });
    app.addHook("onClose", async () => {
      appMcpHost?.closeAll();
      await appLifecycleService.dependencies.supervisor.close();
    });
  }

  app.addHook("onRequest", async (request, reply) => {
    applyDesktopCorsHeaders(request.headers.origin, reply, desktopCorsOrigin, Boolean(desktopApiToken));

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!desktopApiToken && !internalTransportToken) {
      return;
    }

    const requestPath = stripQueryString(request.url);
    if (requestPath === "/health" || requestPath === "/config") {
      return;
    }

    if (isDesktopTransportAuthorized(request.headers, desktopApiToken)) {
      return;
    }

    if (isInternalTransportAuthorized(request.headers, internalTransportToken)) {
      return;
    }

    {
      auditLog("gateway_transport.denied", {
        method: request.method,
        path: request.url,
        desktop_token_present: Boolean(request.headers["x-braindrive-desktop-token"]),
        internal_token_present: Boolean(request.headers["x-braindrive-internal-transport-token"]),
      });
      return reply.code(403).send({ error: "gateway_transport_token_required" });
    }
  });
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
  let migrationInProgress = false;
  const memoryBackupScheduler = createMemoryBackupScheduler({
    memoryRoot: runtimeConfig.memory_root,
    isMigrationInProgress: () => migrationInProgress,
  });
  await memoryBackupScheduler.initialize();
  app.addHook("onClose", async () => {
    memoryBackupScheduler.close();
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/auth/bootstrap-status", async () => toBootstrapStatus(authState));

  app.post("/auth/signup", async (request, reply) => {
    if (!localJwtAuthService) {
      reply.code(404).send({ error: "Not found" });
      return;
    }

    if (!signupRateLimiter.allow(rateLimitKeyForRequest(request, internalTransportToken))) {
      reply.code(429).send({ error: "too_many_requests" });
      return;
    }

    if (
      !authState.account_initialized &&
      (Boolean(signupBootstrapToken) || !allowFirstSignupFromAnyIp)
    ) {
      const signupAccess = evaluateSignupBootstrapAccess(
        {
          ip: clientIpForRequest(request, internalTransportToken),
          headers: request.headers as Record<string, unknown>,
          isBrowserAccess: isBrowserAccessRequest(request.headers, internalTransportToken),
        },
        signupBootstrapToken
      );
      if (!signupAccess.allowed) {
        auditLog("auth.signup.denied", {
          reason: signupAccess.reason,
          ip: clientIpForRequest(request, internalTransportToken),
        });
        reply.code(403).send({ error: signupAccess.reason });
        return;
      }
    } else if (!authState.account_initialized && allowFirstSignupFromAnyIp) {
      auditLog("auth.signup.bootstrap_override", {
        reason: "allow_first_signup_any_ip",
        ip: clientIpForRequest(request, internalTransportToken),
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

    if (!loginRateLimiter.allow(rateLimitKeyForRequest(request, internalTransportToken))) {
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

    if (!refreshRateLimiter.allow(rateLimitKeyForRequest(request, internalTransportToken))) {
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
    if (publicRoutes.has(requestPath)) {
      return;
    }

    await authMiddleware(request, reply, {
      mode: runtimeConfig.auth_mode,
      getAuthState: () => authState,
      authenticateLocalJwtAccessToken: localJwtAuthService
        ? async (accessToken: string) => localJwtAuthService.authenticateAccessToken(accessToken)
        : undefined,
      isDesktopRequestAuthorized: desktopApiToken
        ? (candidate) => candidate.headers["x-braindrive-desktop-token"] === desktopApiToken
        : undefined,
    });
  });

  app.addHook("preHandler", async (request, reply) => {
    const requestPath = stripQueryString(request.url);
    if (!migrationInProgress) {
      return;
    }

    if (requestPath === "/health" || requestPath === "/config") {
      return;
    }

    if (requestPath.startsWith("/migration")) {
      return;
    }

    reply.code(423).send({ error: "migration_in_progress" });
  });

  if (appLifecycleService) {
    registerAppLifecycleRoutes(app, appLifecycleService);
    registerAppMcpHostRoutes(app, appMcpHost!);
  }

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

    const { conversationId, message: currentUserMessage } = conversations.persistUserMessage(requestedConversationId, body);
    const projectId = isProjectMetadata(body.metadata) ? body.metadata.project.trim() : null;
    if (isProjectMetadata(body.metadata)) {
      await projects.attachConversation(body.metadata.project.trim(), conversationId);
    }
    const conversationSkillIds = conversations.getConversationSkills(conversationId) ?? [];
    const projectSkillIds = projectId ? (await projects.getProjectSkills(projectId)) ?? [] : [];
    const systemPrompt = await readBootstrapPrompt(runtimeConfig.memory_root);
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
    // files to read — it would read all projects and behave like the root agent.
    const projectFiles = projectId ? (await projects.listProjectFiles(projectId))?.files ?? [] : [];
    const projectContext = projectId
      ? buildProjectChatContext(projectId, projectFiles)
      : "";
    const finalPrompt = promptWithSkills.prompt + projectContext;

    const correlationId = crypto.randomUUID();
    const contextWindow = await prepareContextWindow({
      memoryRoot: runtimeConfig.memory_root,
      conversationId,
      correlationId,
      messages: conversations.buildConversationMessages(conversationId, finalPrompt),
      tools: toolExecutor.listTools(request.authContext),
    });

    auditLog("context.window", {
      conversation_id: conversationId,
      estimated_prompt_tokens_before: contextWindow.usage.estimatedPromptTokensBefore,
      estimated_prompt_tokens_after: contextWindow.usage.estimatedPromptTokensAfter,
      budget_tokens: contextWindow.usage.budgetTokens,
      ratio_before: Number(contextWindow.usage.ratioBefore.toFixed(3)),
      ratio_after: Number(contextWindow.usage.ratioAfter.toFixed(3)),
      warning_threshold: contextWindow.usage.threshold,
      dropped_units: contextWindow.usage.droppedUnits,
      dropped_messages: contextWindow.usage.droppedMessages,
      summary_applied: contextWindow.usage.summaryApplied,
      summary_artifact_path: contextWindow.usage.summaryArtifactPath,
      summary_artifact_write_error: contextWindow.usage.summaryArtifactWriteError,
    });

    const engineRequest = gatewayAdapter.buildEngineRequest({
      conversationId,
      correlationId,
      messages: contextWindow.messages,
      ...(body.metadata ? { clientMetadata: body.metadata } : {}),
    });

    const livePreferences = await loadLivePreferences();
    const promptAuditRecorder = createPromptAuditRecorder({
      memoryRoot: runtimeConfig.memory_root,
      preferences: livePreferences,
      traceId: crypto.randomUUID(),
      conversationId,
      correlationId,
    });
    await promptAuditRecorder?.append("prompt_audit.trace_started", {
      route: "/message",
      project_id: projectId,
      requested_conversation_id: requestedConversationId ?? null,
      enabled_detail: promptAuditRecorder.detail,
    });
    await promptAuditRecorder?.append("prompt_audit.assembly", await buildPromptAuditAssembly({
      memoryRoot: runtimeConfig.memory_root,
      conversationId,
      projectId,
      projectFiles,
      projectContext,
      currentUserMessage,
      conversation: conversations.detail(conversationId),
      requestedProjectSkillIds: projectSkillIds,
      requestedConversationSkillIds: conversationSkillIds,
      promptWithSkills,
      finalSystemPrompt: contextWindow.messages[0]?.role === "system" ? contextWindow.messages[0].content : finalPrompt,
      contextWindow,
      engineRequest,
      includeSourceSnapshots: promptAuditRecorder.preferences.include_source_snapshots,
    }));

    const streamHeaders: Record<string, string> = {
      ...buildDesktopCorsHeaders(request.headers.origin, desktopCorsOrigin, Boolean(desktopApiToken)),
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-conversation-id": conversationId,
    };
    if (contextWindow.warning) {
      streamHeaders["x-context-window-warning"] = "1";
      streamHeaders["x-context-window-estimated-tokens"] = String(contextWindow.warning.estimated_tokens);
      streamHeaders["x-context-window-budget-tokens"] = String(contextWindow.warning.budget_tokens);
      streamHeaders["x-context-window-ratio"] = String(contextWindow.warning.ratio);
      streamHeaders["x-context-window-threshold"] = String(contextWindow.warning.threshold);
      streamHeaders["x-context-window-managed"] = contextWindow.warning.managed ? "1" : "0";
      streamHeaders["x-context-window-message"] = contextWindow.warning.message;
    }

    reply.raw.writeHead(200, streamHeaders);

    let assistantBuffer = "";
    let currentAssistantMessageId = crypto.randomUUID();
    let lastPersistedAssistantMessageId: string | null = null;
    let traceStatus: "started" | "completed" | "error" = "started";
    const pendingToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>();

    try {
      const liveAdapterConfig = resolveEffectiveAdapterConfig(adapterConfig, livePreferences);
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
      const modelAdapter = createModelAdapter(runtimeConfig.provider_adapter, adapterConfig, livePreferences, {
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
          approvalMode: livePreferences.approval_mode,
          safetyIterationLimit: runtimeConfig.safety_iteration_limit,
          toolExecutionGuard: createBrainDriveMemorySafetyGuard(projectId, conversations.detail(conversationId)),
          ...(promptAuditRecorder
            ? {
                promptAudit: {
                  recorder: promptAuditRecorder,
                  adapterName: runtimeConfig.provider_adapter,
                  providerProfile: livePreferences.active_provider_profile ?? adapterConfig.default_provider_profile,
                  model: liveAdapterConfig.model,
                },
              }
            : {}),
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

        if (event.type === "error") {
          traceStatus = "error";
        }

        if (event.type === "done") {
          traceStatus = "completed";
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
      traceStatus = "error";
      await promptAuditRecorder?.append("prompt_audit.error", {
        stage: "gateway_message_stream",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      auditLog("gateway.error", {
        conversation_id: conversationId,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      reply.raw.write(formatSseEvent(classifyProviderError(error)));
    } finally {
      await promptAuditRecorder?.append("prompt_audit.trace_completed", {
        status: traceStatus,
      });
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
    mode: isManaged ? "managed" : "local",
    install_mode: runtimeConfig.install_mode,
    install_location: installLocation,
    app_version: appVersion,
    gateway_url: clientGatewayUrl,
    features: {
      approvals: true,
      projects: true,
      export: true,
      import: true,
      migration: true,
    },
  }));

  app.get("/session", async (request) => ({
    mode: isManaged ? "managed" : "local",
    user: {
      id: request.authContext.actorId,
      name: authState.account_username ?? "Local Owner",
      initials: toInitials(authState.account_username ?? "Local Owner"),
      email: `${(authState.account_username ?? "owner").toLowerCase()}@local.paa`,
      role: request.authContext.actorType,
    },
  }));

  // Credits API base: use managed gateway when available, otherwise production credits server
  const creditsApiBase = managedApiBase || "https://my.braindrive.ai";
  const loadGatewayVaultSecret = async (secretRef: string): Promise<string | undefined> => {
    const paths = resolveSecretsPaths();
    try {
      const masterKey = await loadMasterKey(paths);
      return await getVaultSecret(secretRef, masterKey, paths);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Master key is not initialized")) {
        return undefined;
      }
      throw error;
    }
  };
  const saveGatewayVaultSecret = async (secretRef: string, plaintext: string): Promise<void> => {
    const paths = resolveSecretsPaths();
    let masterKey;
    try {
      masterKey = await loadMasterKey(paths);
    } catch {
      await initializeMasterKey({ paths });
      masterKey = await loadMasterKey(paths);
    }
    await upsertVaultSecret(secretRef, plaintext, masterKey, paths);
  };
  const saveBrainDriveModelsProvisioningPreferences = async (
    candidatePreferences: Preferences
  ): Promise<void> => {
    await withProviderIntentMutation(async () => {
      const latestPreferences = await loadLivePreferences();
      const candidateCredential =
        candidatePreferences.provider_credentials?.[BRAINDRIVE_MODELS_PROVIDER_ID];
      const nextPreferences: Preferences = {
        ...latestPreferences,
        ...(candidateCredential
          ? {
              provider_credentials: {
                ...(latestPreferences.provider_credentials ?? {}),
                [BRAINDRIVE_MODELS_PROVIDER_ID]: candidateCredential,
              },
            }
          : {}),
        ...(candidatePreferences.braindrive_models_key
          ? { braindrive_models_key: candidatePreferences.braindrive_models_key }
          : {}),
      };
      await saveLivePreferences(nextPreferences);
    });
  };

  const resolveProviderActivationReadiness = async (
    preferences: Preferences,
    profileId: string
  ): Promise<{ ready: true; source: "keyless" | "plain" | "environment" | "vault" | "optional" } | {
    ready: false;
    source: "missing_required_credential";
  }> => {
    const profile = resolveAdapterProfile(adapterConfig, profileId);
    const providerId = (profile.provider_id ?? profileId).trim();
    if (providerId.toLowerCase() === "ollama") {
      return { ready: true, source: "keyless" };
    }

    const configuredEnvironmentValue = process.env[profile.api_key_env]?.trim();
    if (configuredEnvironmentValue) {
      return { ready: true, source: "environment" };
    }

    const credential = preferences.provider_credentials?.[providerId];
    if (credential?.mode === "plain") {
      return { ready: true, source: "plain" };
    }
    if (credential?.mode === "secret_ref") {
      const referencedEnvironmentValue = credential.env_ref
        ? process.env[credential.env_ref]?.trim()
        : undefined;
      if (referencedEnvironmentValue) {
        return { ready: true, source: "environment" };
      }
      let vaultValue: string | undefined;
      try {
        vaultValue = await loadGatewayVaultSecret(credential.secret_ref);
      } catch {
        return { ready: false, source: "missing_required_credential" };
      }
      if (vaultValue?.trim()) {
        return { ready: true, source: "vault" };
      }
      if (credential.required === false) {
        return { ready: true, source: "optional" };
      }
    }

    return { ready: false, source: "missing_required_credential" };
  };

  app.get("/credits/status", async () => {
    try {
      const currentPreferences = await loadLivePreferences();
      const currentAdapterConfig = resolveAdapterConfigForPreferences(adapterConfig, currentPreferences);
      const credential = await resolveProviderCredentialForStartup(
        runtimeConfig.provider_adapter, currentAdapterConfig, currentPreferences
      );
      if (!credential?.apiKey) {
        return { remaining_usd: 0, total_purchased_usd: 0, total_spent_usd: 0, purchase_status: "repair_required" };
      }
      const resp = await fetch(`${creditsApiBase}/credits/status`, {
        headers: { Authorization: `Bearer ${credential.apiKey}` },
      });
      if (!resp.ok) {
        const isAuthError = resp.status === 401 || resp.status === 403;
        if (isAuthError) {
          const nextPreferences = {
            ...currentPreferences,
            braindrive_models_key: {
              ...(currentPreferences.braindrive_models_key ?? {}),
              status: "repair_required" as const,
              checkout_pending: false,
              last_attempt_at: new Date().toISOString(),
              last_error: "invalid_existing_key",
            },
          };
          await saveBrainDriveModelsProvisioningPreferences(nextPreferences);
        }
        return {
          remaining_usd: 0, total_purchased_usd: 0, total_spent_usd: 0,
          ...(isAuthError && { key_valid: false }),
          purchase_status: isAuthError ? "repair_required" : "unavailable",
        };
      }
      const data = (await resp.json()) as Record<string, unknown>;
      const remainingUsd = numberFromUnknown(data.remaining_usd);
      const totalPurchasedUsd = numberFromUnknown(data.total_purchased_usd);
      const hasFundedBalance = remainingUsd > 0 || totalPurchasedUsd > 0;
      const metadata = currentPreferences.braindrive_models_key;
      const purchaseStatus = metadata?.checkout_pending && !hasFundedBalance
        ? "activating"
        : hasFundedBalance
          ? "ready"
          : "zero_balance";
      const persistedStatus = purchaseStatus === "activating" ? "checkout_pending" : purchaseStatus;
      if (metadata?.checkout_pending || metadata?.status !== persistedStatus) {
        await saveBrainDriveModelsProvisioningPreferences({
          ...currentPreferences,
          braindrive_models_key: {
            ...(metadata ?? {}),
            status: persistedStatus,
            checkout_pending: purchaseStatus === "activating",
            last_attempt_at: new Date().toISOString(),
            last_error: null,
          },
        });
      }
      return { ...data, key_valid: true, purchase_status: purchaseStatus };
    } catch {
      return { remaining_usd: 0, total_purchased_usd: 0, total_spent_usd: 0, purchase_status: "unavailable" };
    }
  });

  type EntitlementOperation = {
    operationId: string;
    status: "pending" | "completed";
    appliedCents?: number;
  };

  const parseEntitlementOperation = (value: unknown): EntitlementOperation | null => {
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as Record<string, unknown>;
    const operationId = typeof record.operation_id === "string" ? record.operation_id.trim() : "";
    const status = record.status === "pending" || record.status === "completed" ? record.status : null;
    const appliedCents =
      typeof record.applied_cents === "number" &&
      Number.isSafeInteger(record.applied_cents) &&
      record.applied_cents >= 0
        ? record.applied_cents
        : undefined;
    if (!operationId || operationId.length > 128 || !status || (status === "completed" && appliedCents === undefined)) {
      return null;
    }
    return { operationId, status, ...(appliedCents !== undefined ? { appliedCents } : {}) };
  };

  const saveEntitlementOperation = async (
    operation: EntitlementOperation,
    status: "pending" | "completed" | "partial_success",
    lastError: string | null = null,
    providerActivationRevisionAtStart?: number
  ): Promise<Preferences> => {
    return withProviderIntentMutation(async () => {
      const preferences = await loadLivePreferences();
      const capturedRevision =
        providerActivationRevisionAtStart ??
        preferences.braindrive_models_entitlement?.provider_activation_revision_at_start;
      const nextPreferences: Preferences = {
        ...preferences,
        braindrive_models_entitlement: {
          operation_id: operation.operationId,
          status,
          ...(operation.appliedCents !== undefined ? { applied_cents: operation.appliedCents } : {}),
          ...(capturedRevision !== undefined
            ? { provider_activation_revision_at_start: capturedRevision }
            : {}),
          last_attempt_at: new Date().toISOString(),
          last_error: lastError,
        },
      };
      await saveLivePreferences(nextPreferences);
      return nextPreferences;
    });
  };

  const applyEntitlementProviderActivation = async (
    operationId: string,
    claimState: "completed" | "partial_success"
  ): Promise<Preferences> =>
    withProviderIntentMutation(async () => {
      const currentPreferences = await loadLivePreferences();
      const previousProfile = currentPreferences.active_provider_profile;
      const currentRevision = normalizeProviderActivationRevision(
        currentPreferences.provider_activation_revision
      );
      const capturedRevision =
        currentPreferences.braindrive_models_entitlement
          ?.provider_activation_revision_at_start;
      const activation = decideClaimProviderActivation({
        currentProviderProfile: previousProfile,
        currentRevision,
        revisionAtClaimStart: capturedRevision,
        targetProviderProfile: BRAINDRIVE_MODELS_PROVIDER_ID,
      });

      let resultingPreferences = currentPreferences;
      if (activation.shouldPersist) {
        resultingPreferences = {
          ...currentPreferences,
          active_provider_profile: BRAINDRIVE_MODELS_PROVIDER_ID,
          provider_activation_revision: activation.providerActivationRevision,
        };
        const effectiveModel =
          resultingPreferences.provider_default_models?.[BRAINDRIVE_MODELS_PROVIDER_ID] ??
          adapterConfig.provider_profiles?.[BRAINDRIVE_MODELS_PROVIDER_ID]?.model;
        if (effectiveModel) {
          resultingPreferences.default_model = effectiveModel;
        }
        try {
          await saveLivePreferences(resultingPreferences);
        } catch {
          auditLog("credits.entitlement_provider_activation", {
            source: "email_credit_claim",
            operation_id: operationId,
            claim_state: claimState,
            previous_profile: previousProfile ?? null,
            target_profile: BRAINDRIVE_MODELS_PROVIDER_ID,
            resulting_profile: previousProfile ?? null,
            captured_revision: capturedRevision ?? null,
            current_revision: currentRevision,
            resulting_revision: currentRevision,
            decision: "failed",
            error_code: "provider_activation_failed",
          });
          throw new Error("provider_activation_failed");
        }
      }

      auditLog("credits.entitlement_provider_activation", {
        source: "email_credit_claim",
        operation_id: operationId,
        claim_state: claimState,
        previous_profile: previousProfile ?? null,
        target_profile: BRAINDRIVE_MODELS_PROVIDER_ID,
        resulting_profile: resultingPreferences.active_provider_profile ?? null,
        captured_revision: capturedRevision ?? null,
        current_revision: currentRevision,
        resulting_revision: normalizeProviderActivationRevision(
          resultingPreferences.provider_activation_revision
        ),
        decision: activation.decision,
        error_code: null,
      });
      return resultingPreferences;
    });

  const loadEntitlementBalance = async (apiKey: string): Promise<Record<string, unknown> | null> => {
    const response = await fetch(`${creditsApiBase}/credits/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Record<string, unknown>;
    const remainingUsd = numberFromUnknown(data.remaining_usd);
    const totalPurchasedUsd = numberFromUnknown(data.total_purchased_usd);
    const totalSpentUsd = numberFromUnknown(data.total_spent_usd);
    return {
      remaining_usd: remainingUsd,
      total_purchased_usd: totalPurchasedUsd,
      total_spent_usd: totalSpentUsd,
      key_valid: true,
      purchase_status: remainingUsd > 0 || totalPurchasedUsd > 0 ? "ready" : "zero_balance",
    };
  };

  const entitlementError = (
    reply: FastifyReply,
    status: number,
    code: string,
    message: string
  ) => {
    reply.code(status).send({ error: message, code });
  };

  const refreshEntitlementOperation = async (
    preferences: Preferences
  ): Promise<
    | { ok: true; statusCode: 200 | 202; payload: Record<string, unknown> }
    | { ok: false; statusCode: number; code: string; message: string }
  > => {
    const saved = preferences.braindrive_models_entitlement;
    const operationId = saved?.operation_id?.trim();
    if (!operationId || operationId.length > 128) {
      return { ok: false, statusCode: 404, code: "no_claim_operation", message: "No email credit claim is in progress" };
    }

    if (
      saved &&
      (saved.status === "completed" || saved.status === "partial_success") &&
      saved.applied_cents !== undefined
    ) {
      const existingKey = await loadGatewayVaultSecret(resolveBrainDriveModelsSecretRef(preferences));
      if (!existingKey?.trim()) {
        return { ok: false, statusCode: 409, code: "key_repair_required", message: "BrainDrive Models key needs repair" };
      }
      const operation: EntitlementOperation = {
        operationId,
        status: "completed",
        appliedCents: saved.applied_cents,
      };
      const balance = await loadEntitlementBalance(existingKey.trim());
      if (!balance) {
        await saveEntitlementOperation(
          operation,
          "partial_success",
          "balance_refresh_unavailable",
          saved.provider_activation_revision_at_start
        );
        let finalPreferences;
        try {
          finalPreferences = await applyEntitlementProviderActivation(
            operationId,
            "partial_success"
          );
        } catch {
          return {
            ok: false,
            statusCode: 500,
            code: "provider_activation_failed",
            message: "Unable to activate BrainDrive Models",
          };
        }
        return {
          ok: true,
          statusCode: 200,
          payload: {
            state: "partial_success",
            operation_id: operationId,
            applied_cents: saved.applied_cents,
            error_code: "balance_refresh_unavailable",
            settings: buildSettingsPayload(adapterConfig, finalPreferences),
          },
        };
      }
      await saveEntitlementOperation(
        operation,
        "completed",
        null,
        saved.provider_activation_revision_at_start
      );
      let finalPreferences;
      try {
        finalPreferences = await applyEntitlementProviderActivation(operationId, "completed");
      } catch {
        return {
          ok: false,
          statusCode: 500,
          code: "provider_activation_failed",
          message: "Unable to activate BrainDrive Models",
        };
      }
      return {
        ok: true,
        statusCode: 200,
        payload: {
          state: "completed",
          operation_id: operationId,
          applied_cents: saved.applied_cents,
          balance,
          settings: buildSettingsPayload(adapterConfig, finalPreferences),
        },
      };
    }

    let readiness;
    try {
      readiness = await ensureBrainDriveModelsClaimKey({
        creditsApiBase,
        preferences,
        loadVaultSecret: loadGatewayVaultSecret,
        saveVaultSecret: saveGatewayVaultSecret,
        savePreferences: saveBrainDriveModelsProvisioningPreferences,
      });
    } catch (error) {
      if (error instanceof BrainDriveModelsProvisioningError && error.code === "repair_required") {
        return { ok: false, statusCode: 409, code: "key_repair_required", message: "BrainDrive Models key needs repair" };
      }
      return { ok: false, statusCode: 502, code: "key_preparation_failed", message: "Unable to prepare BrainDrive Models" };
    }

    const requestId = randomUUID();
    const response = await fetch(
      `${creditsApiBase}/credits/entitlements/operations/${encodeURIComponent(operationId)}`,
      {
        headers: {
          Authorization: `Bearer ${readiness.apiKey}`,
          "X-Request-ID": requestId,
          "X-Correlation-ID": requestId,
        },
      }
    );
    if (response.status === 401 || response.status === 403) {
      await saveBrainDriveModelsProvisioningPreferences({
        ...readiness.preferences,
        braindrive_models_key: {
          ...(readiness.preferences.braindrive_models_key ?? {}),
          status: "repair_required",
          checkout_pending: false,
          last_attempt_at: new Date().toISOString(),
          last_error: "invalid_existing_key",
        },
      });
      return { ok: false, statusCode: 409, code: "key_repair_required", message: "BrainDrive Models key needs repair" };
    }
    if (!response.ok) {
      const code = response.status === 429 ? "throttled" : "campaign_unavailable";
      return {
        ok: false,
        statusCode: response.status === 429 ? 429 : 503,
        code,
        message: response.status === 429 ? "Please wait before refreshing" : "Email credit service is unavailable",
      };
    }

    const operation = parseEntitlementOperation(await response.json());
    if (!operation || operation.operationId !== operationId) {
      return { ok: false, statusCode: 503, code: "campaign_unavailable", message: "Email credit service is unavailable" };
    }
    if (operation.status === "pending") {
      await saveEntitlementOperation(
        operation,
        "pending",
        null,
        saved?.provider_activation_revision_at_start
      );
      return {
        ok: true,
        statusCode: 202,
        payload: {
          state: "pending",
          operation_id: operation.operationId,
          ...(operation.appliedCents !== undefined ? { applied_cents: operation.appliedCents } : {}),
          error_code: "pending_reconciliation",
        },
      };
    }

    await saveEntitlementOperation(
      operation,
      "completed",
      null,
      saved?.provider_activation_revision_at_start
    );
    const balance = await loadEntitlementBalance(readiness.apiKey);
    if (!balance) {
      await saveEntitlementOperation(
        operation,
        "partial_success",
        "balance_refresh_unavailable",
        saved?.provider_activation_revision_at_start
      );
      let finalPreferences;
      try {
        finalPreferences = await applyEntitlementProviderActivation(
          operation.operationId,
          "partial_success"
        );
      } catch {
        return {
          ok: false,
          statusCode: 500,
          code: "provider_activation_failed",
          message: "Unable to activate BrainDrive Models",
        };
      }
      return {
        ok: true,
        statusCode: 200,
        payload: {
          state: "partial_success",
          operation_id: operation.operationId,
          applied_cents: operation.appliedCents,
          error_code: "balance_refresh_unavailable",
          settings: buildSettingsPayload(adapterConfig, finalPreferences),
        },
      };
    }
    let finalPreferences;
    try {
      finalPreferences = await applyEntitlementProviderActivation(
        operation.operationId,
        "completed"
      );
    } catch {
      return {
        ok: false,
        statusCode: 500,
        code: "provider_activation_failed",
        message: "Unable to activate BrainDrive Models",
      };
    }
    return {
      ok: true,
      statusCode: 200,
      payload: {
        state: "completed",
        operation_id: operation.operationId,
        applied_cents: operation.appliedCents,
        balance,
        settings: buildSettingsPayload(adapterConfig, finalPreferences),
      },
    };
  };

  app.get("/credits/entitlements/capability", async (_request, reply) => {
    if (isManaged) {
      return { available: false, version: null };
    }
    try {
      const response = await fetch(`${creditsApiBase}/credits/entitlements/capability`);
      if (!response.ok) {
        return { available: false, version: null };
      }
      const data = (await response.json()) as Record<string, unknown>;
      if (data.available !== true) {
        return { available: false, version: null };
      }
      return { available: true, version: typeof data.version === "string" ? data.version : null };
    } catch {
      reply.code(200);
      return { available: false, version: null };
    }
  });

  app.post("/credits/entitlements/claim", async (request, reply) => {
    const bodySchema = z.object({ email: z.string().trim().email().max(320) }).strict();
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success || isSyntheticLocalEmail(parsed.success ? parsed.data.email : "")) {
      entitlementError(reply, 400, "invalid_email", "Enter a valid email address");
      return;
    }
    if (isManaged) {
      entitlementError(reply, 404, "campaign_unavailable", "Email credit is unavailable");
      return;
    }

    const initialPreferences = await loadLivePreferences();
    const claimStartRevision = normalizeProviderActivationRevision(
      initialPreferences.provider_activation_revision
    );
    const savedOperation = initialPreferences.braindrive_models_entitlement;
    const hasUnfinishedOperation = Boolean(
      savedOperation?.operation_id
      && savedOperation.status !== "completed"
      && savedOperation.status !== "partial_success"
    );
    if (hasUnfinishedOperation) {
      const refreshed = await refreshEntitlementOperation(initialPreferences);
      if (!refreshed.ok) {
        entitlementError(reply, refreshed.statusCode, refreshed.code, refreshed.message);
        return;
      }
      reply.code(refreshed.statusCode).send(refreshed.payload);
      return;
    }

    let readiness;
    try {
      readiness = await ensureBrainDriveModelsClaimKey({
        creditsApiBase,
        preferences: initialPreferences,
        loadVaultSecret: loadGatewayVaultSecret,
        saveVaultSecret: saveGatewayVaultSecret,
        savePreferences: saveBrainDriveModelsProvisioningPreferences,
      });
    } catch (error) {
      if (error instanceof BrainDriveModelsProvisioningError) {
        auditLog("credits.entitlement_key_unavailable", { code: error.code, status: error.status ?? null });
        if (error.code === "repair_required") {
          entitlementError(reply, 409, "key_repair_required", "BrainDrive Models key needs repair");
          return;
        }
      }
      entitlementError(reply, 502, "key_preparation_failed", "Unable to prepare BrainDrive Models");
      return;
    }

    const requestId = randomUUID();
    let response: Response;
    try {
      response = await fetch(`${creditsApiBase}/credits/entitlements/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${readiness.apiKey}`,
          "X-Request-ID": requestId,
          "X-Correlation-ID": requestId,
        },
        body: JSON.stringify({
          email: parsed.data.email,
          install_public_id: readiness.installPublicId,
        }),
      });
    } catch {
      entitlementError(reply, 503, "campaign_unavailable", "Email credit service is unavailable");
      return;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await saveBrainDriveModelsProvisioningPreferences({
          ...readiness.preferences,
          braindrive_models_key: {
            ...(readiness.preferences.braindrive_models_key ?? {}),
            status: "repair_required",
            checkout_pending: false,
            last_attempt_at: new Date().toISOString(),
            last_error: "invalid_existing_key",
          },
        });
        entitlementError(reply, 409, "key_repair_required", "BrainDrive Models key needs repair");
      } else if (response.status === 422) {
        entitlementError(reply, 400, "invalid_email", "Enter a valid email address");
      } else if (response.status === 404) {
        entitlementError(reply, 404, "no_available_credit", "No available email credit was found");
      } else if (response.status === 429) {
        entitlementError(reply, 429, "throttled", "Please wait before trying again");
      } else {
        entitlementError(reply, 503, "campaign_unavailable", "Email credit service is unavailable");
      }
      return;
    }

    const operation = parseEntitlementOperation(await response.json());
    if (!operation) {
      entitlementError(reply, 503, "campaign_unavailable", "Email credit service is unavailable");
      return;
    }
    if (operation.status === "pending") {
      await saveEntitlementOperation(operation, "pending", null, claimStartRevision);
      reply.code(202).send({
        state: "pending",
        operation_id: operation.operationId,
        ...(operation.appliedCents !== undefined ? { applied_cents: operation.appliedCents } : {}),
        error_code: "pending_reconciliation",
      });
      return;
    }

    await saveEntitlementOperation(operation, "completed", null, claimStartRevision);
    const balance = await loadEntitlementBalance(readiness.apiKey);
    if (!balance) {
      await saveEntitlementOperation(
        operation,
        "partial_success",
        "balance_refresh_unavailable",
        claimStartRevision
      );
      let finalPreferences;
      try {
        finalPreferences = await applyEntitlementProviderActivation(
          operation.operationId,
          "partial_success"
        );
      } catch {
        entitlementError(
          reply,
          500,
          "provider_activation_failed",
          "Unable to activate BrainDrive Models"
        );
        return;
      }
      reply.send({
        state: "partial_success",
        operation_id: operation.operationId,
        applied_cents: operation.appliedCents,
        error_code: "balance_refresh_unavailable",
        settings: buildSettingsPayload(adapterConfig, finalPreferences),
      });
      return;
    }
    let finalPreferences;
    try {
      finalPreferences = await applyEntitlementProviderActivation(
        operation.operationId,
        "completed"
      );
    } catch {
      entitlementError(
        reply,
        500,
        "provider_activation_failed",
        "Unable to activate BrainDrive Models"
      );
      return;
    }
    reply.send({
      state: "completed",
      operation_id: operation.operationId,
      applied_cents: operation.appliedCents,
      balance,
      settings: buildSettingsPayload(adapterConfig, finalPreferences),
    });
  });

  app.get("/credits/entitlements/status", async (_request, reply) => {
    if (isManaged) {
      entitlementError(reply, 404, "campaign_unavailable", "Email credit is unavailable");
      return;
    }
    const refreshed = await refreshEntitlementOperation(await loadLivePreferences());
    if (!refreshed.ok) {
      entitlementError(reply, refreshed.statusCode, refreshed.code, refreshed.message);
      return;
    }
    reply.code(refreshed.statusCode).send(refreshed.payload);
  });

  app.post("/credits/checkout", async (request, reply) => {
    const bodySchema = z.object({
      amount: z.number().min(1),
      email: z.string().email(),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "Invalid request: amount must be >= 1 and a valid email is required" });
      return;
    }
    if (isSyntheticLocalEmail(parsed.data.email)) {
      reply.code(400).send({ error: "Invalid request: a deliverable checkout email is required" });
      return;
    }
    try {
      const checkoutKey = await ensureBrainDriveModelsCheckoutKey({
        creditsApiBase,
        preferences: await loadLivePreferences(),
        loadVaultSecret: loadGatewayVaultSecret,
        saveVaultSecret: saveGatewayVaultSecret,
        savePreferences: saveBrainDriveModelsProvisioningPreferences,
      });
      const resp = await fetch(`${creditsApiBase}/credits/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${checkoutKey.apiKey}`,
        },
        body: JSON.stringify({ amount: parsed.data.amount, email: parsed.data.email }),
      });
      if (!resp.ok) {
        reply.code(resp.status).send({ error: "Checkout service unavailable" });
        return;
      }
      const data = (await resp.json()) as Record<string, unknown>;
      return { ...data, purchase_status: "activating" };
    } catch (error) {
      if (error instanceof BrainDriveModelsProvisioningError) {
        auditLog("credits.checkout_key_unavailable", {
          code: error.code,
          status: error.status ?? null,
        });
        if (error.code === "repair_required") {
          reply.code(409).send({
            error: "BrainDrive Models key needs repair before checkout can continue",
            code: "braindrive_models_key_repair_required",
          });
          return;
        }
        reply.code(502).send({
          error: "Checkout service unreachable",
          code: "braindrive_models_key_provision_failed",
        });
        return;
      }
      reply.code(502).send({ error: "Checkout service unreachable" });
    }
  });

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

  app.get("/agent", async (request, reply) => {
    authorize(request.authContext, "memory_access");
    const managedPath = path.join(runtimeConfig.memory_root, "AGENT.md");
    const overlayPath = path.join(runtimeConfig.memory_root, "AGENT-user.md");
    if (!existsSync(managedPath)) {
      reply.code(404).send({ error: "Agent not found" });
      return;
    }

    const managedContent = await readFile(managedPath, "utf8");
    const overlayContent = existsSync(overlayPath) ? await readFile(overlayPath, "utf8") : null;
    return {
      managed_content: managedContent,
      overlay_content: overlayContent,
    };
  });

  app.put("/agent", async (request, reply) => {
    authorize(request.authContext, "memory_access");
    const parsed = rootAgentUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/agent", parsed.error.issues.length);
      return;
    }

    const overlayPath = path.join(runtimeConfig.memory_root, "AGENT-user.md");
    await writeFile(overlayPath, parsed.data.overlay_content, "utf8");
    await commitMemoryChange(runtimeConfig.memory_root, "Update global agent overlay via UI").catch(() => {});
    return { ok: true };
  });

  app.get("/settings", async (request) => {
    authorize(request.authContext, "administration");
    const currentPreferences = await loadLivePreferences();
    return buildSettingsPayload(adapterConfig, currentPreferences);
  });

  app.get("/settings/onboarding-status", async (request) => {
    authorize(request.authContext, "administration");
    const currentPreferences = await loadLivePreferences();
    return buildOnboardingStatusPayload(adapterConfig, currentPreferences);
  });

  app.get("/settings/models", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsedQuery = settingsModelsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      sendInvalidRequest(reply, "/settings/models", parsedQuery.error.issues.length);
      return;
    }

    const currentPreferences = await loadLivePreferences();
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

    const currentPreferences = await loadLivePreferences();
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

    const currentPreferences = await loadLivePreferences();
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
    if (body.active_provider_profile !== undefined) {
      if (
        body.active_provider_profile !== null &&
        !isKnownProviderProfile(adapterConfig, body.active_provider_profile)
      ) {
        sendInvalidRequest(reply, "/settings", 1);
        return;
      }
    }

    if (
      body.provider_base_url !== undefined &&
      !isKnownProviderProfile(adapterConfig, body.provider_base_url.provider_profile)
    ) {
      sendInvalidRequest(reply, "/settings", 1);
      return;
    }

    const applySettingsUpdate = (currentPreferences: Preferences): Preferences => {
      const nextPreferences: Preferences = { ...currentPreferences };
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
        } else {
          nextPreferences.active_provider_profile = body.active_provider_profile;
          if (body.default_model === undefined) {
            const newProviderModel =
              nextPreferences.provider_default_models?.[body.active_provider_profile];
            const profileConfig =
              adapterConfig.provider_profiles?.[body.active_provider_profile];
            const effectiveModel = newProviderModel ?? profileConfig?.model;
            if (effectiveModel) {
              nextPreferences.default_model = effectiveModel;
            }
          }
        }
      }

      if (body.provider_base_url !== undefined) {
        const { provider_profile, base_url } = body.provider_base_url;
        const profileConfig = resolveAdapterProfile(adapterConfig, provider_profile);
        const urls = { ...nextPreferences.provider_base_urls };
        urls[provider_profile] =
          profileConfig.provider_id?.toLowerCase() === "ollama"
            ? normalizeOllamaOpenAIBaseUrl(base_url)
            : base_url;
        nextPreferences.provider_base_urls = urls;
      }
      return nextPreferences;
    };

    if (body.active_provider_profile === undefined) {
      const nextPreferences = applySettingsUpdate(await loadLivePreferences());
      await saveLivePreferences(nextPreferences);
      reply.send(buildSettingsPayload(adapterConfig, nextPreferences));
      return;
    }

    const targetProfile = body.active_provider_profile ?? undefined;
    const activationResult = await withProviderIntentMutation(async () => {
      const currentPreferences = await loadLivePreferences();
      if (targetProfile) {
        const readiness = await resolveProviderActivationReadiness(
          currentPreferences,
          targetProfile
        );
        const targetProviderId = (
          resolveAdapterProfile(adapterConfig, targetProfile).provider_id ?? targetProfile
        ).trim().toLowerCase();
        const allowsUnconfiguredSelection = targetProviderId === "openrouter";
        if (!readiness.ready && !allowsUnconfiguredSelection) {
          auditLog("settings.provider_activation_rejected", {
            actor_id: request.authContext.actorId,
            source: "explicit",
            target_profile: targetProfile,
            current_profile: currentPreferences.active_provider_profile ?? null,
            current_revision: normalizeProviderActivationRevision(
              currentPreferences.provider_activation_revision
            ),
            decision: "rejected",
            readiness: readiness.source,
            error_code: "provider_not_ready",
          });
          return { kind: "not_ready" as const };
        }
      }

      const activation = decideExplicitProviderActivation({
        currentProviderProfile: currentPreferences.active_provider_profile,
        currentRevision: currentPreferences.provider_activation_revision,
        targetProviderProfile: targetProfile,
      });
      const nextPreferences = applySettingsUpdate(currentPreferences);
      nextPreferences.provider_activation_revision =
        activation.providerActivationRevision;
      try {
        await saveLivePreferences(nextPreferences);
      } catch {
        auditLog("settings.provider_activation_rejected", {
          actor_id: request.authContext.actorId,
          source: "explicit",
          target_profile: targetProfile ?? null,
          current_profile: currentPreferences.active_provider_profile ?? null,
          current_revision: activation.previousProviderActivationRevision,
          decision: "rejected",
          readiness: targetProfile ? "ready" : "not_applicable",
          error_code: "provider_activation_failed",
        });
        return { kind: "save_failed" as const };
      }
      auditLog("settings.provider_activation_completed", {
        actor_id: request.authContext.actorId,
        source: "explicit",
        previous_profile: activation.previousProviderProfile ?? null,
        target_profile: targetProfile ?? null,
        resulting_profile: nextPreferences.active_provider_profile ?? null,
        previous_revision: activation.previousProviderActivationRevision,
        resulting_revision: activation.providerActivationRevision,
        decision: activation.decision,
      });
      return { kind: "completed" as const, preferences: nextPreferences };
    });

    if (activationResult.kind === "not_ready") {
      reply.code(409).send({
        error: "Configure this provider before activating it",
        code: "provider_not_ready",
      });
      return;
    }
    if (activationResult.kind === "save_failed") {
      reply.code(500).send({
        error: "Unable to activate provider",
        code: "provider_activation_failed",
      });
      return;
    }
    reply.send(buildSettingsPayload(adapterConfig, activationResult.preferences));
  });

  app.put("/settings/memory-backup", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsed = settingsMemoryBackupUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidRequest(reply, "/settings/memory-backup", parsed.error.issues.length);
      return;
    }

    const body = parsed.data;
    const currentPreferences = await loadLivePreferences();
    const currentBackup = currentPreferences.memory_backup;
    const hasExistingTokenReference = Boolean(
      currentBackup?.token_secret_ref && currentBackup.token_secret_ref.trim().length > 0
    );
    if (!body.git_token && !hasExistingTokenReference) {
      sendInvalidRequest(reply, "/settings/memory-backup", 1);
      return;
    }

    const tokenSecretRef = body.git_token
      ? body.token_secret_ref?.trim() ||
        currentBackup?.token_secret_ref?.trim() ||
        DEFAULT_MEMORY_BACKUP_TOKEN_SECRET_REF
      : currentBackup?.token_secret_ref?.trim() || DEFAULT_MEMORY_BACKUP_TOKEN_SECRET_REF;

    if (body.git_token) {
      const normalizedToken = body.git_token.trim();
      const paths = resolveSecretsPaths();
      let masterKey;
      try {
        masterKey = await loadMasterKey(paths);
      } catch {
        await initializeMasterKey({ paths });
        masterKey = await loadMasterKey(paths);
      }
      await upsertVaultSecret(tokenSecretRef, normalizedToken, masterKey, paths);
    }

    const nextPreferences: Preferences = {
      ...currentPreferences,
      memory_backup: {
        repository_url: body.repository_url,
        frequency: body.frequency,
        token_secret_ref: tokenSecretRef,
        ...(currentBackup?.last_save_at ? { last_save_at: currentBackup.last_save_at } : {}),
        ...(currentBackup?.last_attempt_at ? { last_attempt_at: currentBackup.last_attempt_at } : {}),
        ...(currentBackup?.last_result ? { last_result: currentBackup.last_result } : {}),
        ...(currentBackup?.last_error !== undefined ? { last_error: currentBackup.last_error } : {}),
      },
    };

    await saveLivePreferences(nextPreferences);
    await memoryBackupScheduler.reconfigure();
    auditLog("settings.memory_backup_update", {
      actor_id: request.authContext.actorId,
      repository_host: tryParseUrl(body.repository_url)?.host ?? "unknown",
      frequency: body.frequency,
      token_secret_ref: tokenSecretRef,
      token_rotated: Boolean(body.git_token),
    });
    reply.send(buildSettingsPayload(adapterConfig, nextPreferences));
  });

  app.post("/settings/memory-backup/save", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsed = settingsMemoryBackupSaveSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendInvalidRequest(reply, "/settings/memory-backup/save", parsed.error.issues.length);
      return;
    }

    const currentPreferences = await loadLivePreferences();
    if (!currentPreferences.memory_backup) {
      sendInvalidRequest(reply, "/settings/memory-backup/save", 1);
      return;
    }

    const { result, preferences: nextPreferences } = await memoryBackupScheduler.triggerManualBackup({
      onRemoteConflict: parsed.data.on_remote_conflict,
    });
    auditLog("settings.memory_backup_save", {
      actor_id: request.authContext.actorId,
      result: result.result,
      attempted_at: result.attempted_at,
      saved_at: result.saved_at,
      message: result.message,
    });

    reply.send({
      result,
      settings: buildSettingsPayload(adapterConfig, nextPreferences),
    });
  });

  app.post("/settings/memory-backup/restore", async (request, reply) => {
    authorize(request.authContext, "administration");
    const parsed = settingsMemoryBackupRestoreSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendInvalidRequest(reply, "/settings/memory-backup/restore", parsed.error.issues.length);
      return;
    }
    const currentPreferences = await loadLivePreferences();
    if (!currentPreferences.memory_backup) {
      sendInvalidRequest(reply, "/settings/memory-backup/restore", 1);
      return;
    }
    if (migrationInProgress) {
      reply.code(409).send({ error: "migration_in_progress" });
      return;
    }

    migrationInProgress = true;
    try {
      const result = await restoreMemoryBackup(runtimeConfig.memory_root, currentPreferences, {
        targetCommit: parsed.data.target_commit,
      });
      const refreshedPreferences = await loadLivePreferences();
      auditLog("settings.memory_backup_restore", {
        actor_id: request.authContext.actorId,
        commit: result.commit,
        source_branch: result.source_branch,
        warnings_count: result.warnings.length,
        target_commit_requested: parsed.data.target_commit ?? null,
      });
      let logoutRequired = false;
      if (localJwtAuthService) {
        await localJwtAuthService.logout();
        reply.header("set-cookie", serializeRefreshCookieClear(isSecureRequest(request)));
        logoutRequired = true;
      }
      reply.send({
        result,
        settings: buildSettingsPayload(adapterConfig, refreshedPreferences),
        logout_required: logoutRequired,
      });
    } catch (error) {
      const safeMessage = error instanceof Error ? error.message : "Memory restore failed";
      auditLog("settings.memory_backup_restore_failed", {
        actor_id: request.authContext.actorId,
        message: safeMessage,
      });
      reply.code(400).send({
        error: safeMessage,
      });
    } finally {
      migrationInProgress = false;
    }
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

    const currentPreferences = await loadLivePreferences();
    const nextPreferences: Preferences = {
      ...currentPreferences,
      provider_credentials: { ...(currentPreferences.provider_credentials ?? {}) },
      secret_resolution: currentPreferences.secret_resolution ?? { on_missing: "fail_closed" },
    };
    const selectedProfile = resolveAdapterProfile(adapterConfig, body.provider_profile);
    const providerId = selectedProfile.provider_id ?? body.provider_profile;
    const mode = body.mode ?? "secret_ref";
    auditLog("settings.credentials_update_start", {
      provider_profile: body.provider_profile,
      provider_id: providerId,
      mode,
      set_active_provider: body.set_active_provider ?? null,
    });

    // Validate BrainDrive Models API keys before persisting
    if (mode === "secret_ref" && body.api_key && providerId === "braindrive-models") {
      const trimmedKey = body.api_key.trim();
      if (!/^sk-[A-Za-z0-9_-]{8,}$/.test(trimmedKey)) {
        reply.code(400).send({
          error: "That doesn't look like a BrainDrive API key. Please copy the full key from your purchase confirmation email and paste it here.",
        });
        return;
      }
      try {
        const verifyResp = await fetch(`${creditsApiBase}/credits/status`, {
          headers: { Authorization: `Bearer ${trimmedKey}` },
        });
        if (verifyResp.status === 401 || verifyResp.status === 403) {
          auditLog("settings.credentials_validation_failed", {
            provider_profile: body.provider_profile,
            provider_id: providerId,
            status: verifyResp.status,
          });
          reply.code(400).send({
            error: "This API key wasn't recognized. Please check that you copied the full key from your purchase confirmation email.",
          });
          return;
        }
        auditLog("settings.credentials_validation_completed", {
          provider_profile: body.provider_profile,
          provider_id: providerId,
          status: verifyResp.status,
        });
      } catch (error) {
        auditLog("settings.credentials_validation_unavailable", {
          provider_profile: body.provider_profile,
          provider_id: providerId,
          message: error instanceof Error ? error.message : String(error),
        });
        // Upstream unreachable — proceed with save
      }
    }

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

    let shouldSetActiveProvider = body.set_active_provider ?? false;
    if (body.set_active_provider === undefined) {
      try {
        const activeAdapterConfig = resolveAdapterConfigForPreferences(adapterConfig, currentPreferences);
        const activeCredential = await resolveProviderCredentialForStartup(
          runtimeConfig.provider_adapter,
          activeAdapterConfig,
          currentPreferences
        );
        const activeProfileId = resolveSettingsModelProfile(adapterConfig, currentPreferences);
        const activeProviderId = activeAdapterConfig.provider_id ?? activeProfileId;
        const activePreference = currentPreferences.provider_credentials?.[activeProviderId];
        const activeCredentialFromEnv = process.env[activeAdapterConfig.api_key_env]?.trim() ?? "";
        const activeRequiresSecret = activeProviderId !== "ollama" && activePreference?.mode !== "plain";
        const activeIsUsable = activeCredentialFromEnv.length > 0 || Boolean(activeCredential) || !activeRequiresSecret;
        if (!activeIsUsable) {
          shouldSetActiveProvider = true;
        }
      } catch {
        // Current active provider is not usable yet (missing or unresolved credential),
        // so make the newly configured provider active immediately.
        shouldSetActiveProvider = true;
      }
    }

    const credentialPreference = nextPreferences.provider_credentials![providerId];
    let savedPreferences: Preferences;
    if (shouldSetActiveProvider) {
      try {
        savedPreferences = await withProviderIntentMutation(async () => {
          const latestPreferences = await loadLivePreferences();
          const activation = decideExplicitProviderActivation({
            currentProviderProfile: latestPreferences.active_provider_profile,
            currentRevision: latestPreferences.provider_activation_revision,
            targetProviderProfile: body.provider_profile,
          });
          const activatedPreferences: Preferences = {
            ...latestPreferences,
            provider_credentials: {
              ...(latestPreferences.provider_credentials ?? {}),
              [providerId]: credentialPreference,
            },
            secret_resolution:
              latestPreferences.secret_resolution ?? { on_missing: "fail_closed" },
            active_provider_profile: body.provider_profile,
            provider_activation_revision: activation.providerActivationRevision,
          };
          const effectiveModel =
            activatedPreferences.provider_default_models?.[body.provider_profile] ??
            adapterConfig.provider_profiles?.[body.provider_profile]?.model;
          if (effectiveModel) {
            activatedPreferences.default_model = effectiveModel;
          }
          await saveLivePreferences(activatedPreferences);
          auditLog("settings.provider_activation_completed", {
            actor_id: request.authContext.actorId,
            source: "credential_save",
            previous_profile: activation.previousProviderProfile ?? null,
            target_profile: body.provider_profile,
            resulting_profile: activatedPreferences.active_provider_profile,
            previous_revision: activation.previousProviderActivationRevision,
            resulting_revision: activation.providerActivationRevision,
            decision: activation.decision,
          });
          return activatedPreferences;
        });
      } catch {
        auditLog("settings.provider_activation_rejected", {
          actor_id: request.authContext.actorId,
          source: "credential_save",
          target_profile: body.provider_profile,
          current_profile: currentPreferences.active_provider_profile ?? null,
          current_revision: normalizeProviderActivationRevision(
            currentPreferences.provider_activation_revision
          ),
          decision: "rejected",
          readiness: "credential_persisted",
          error_code: "provider_activation_failed",
        });
        reply.code(500).send({
          error: "Unable to activate provider",
          code: "provider_activation_failed",
        });
        return;
      }
    } else {
      const latestPreferences = await loadLivePreferences();
      savedPreferences = {
        ...latestPreferences,
        provider_credentials: {
          ...(latestPreferences.provider_credentials ?? {}),
          [providerId]: credentialPreference,
        },
        secret_resolution:
          latestPreferences.secret_resolution ?? { on_missing: "fail_closed" },
      };
      await saveLivePreferences(savedPreferences);
    }

    const onboardingStatus = await buildOnboardingStatusPayload(
      adapterConfig,
      savedPreferences
    );
    auditLog("settings.credentials_update", {
      provider_profile: body.provider_profile,
      provider_id: providerId,
      mode,
      required: mode === "plain" ? body.required ?? false : body.required ?? true,
      set_active_provider: shouldSetActiveProvider,
      set_active_provider_explicit: body.set_active_provider ?? null,
      secret_ref: secretRef,
    });

    reply.send({
      settings: buildSettingsPayload(adapterConfig, savedPreferences),
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
    authorize(request.authContext, "administration");
    const result = await exportMemory(runtimeConfig.memory_root);
    const fileName = path.basename(result.archive_path);
    reply.header("content-type", "application/gzip");
    reply.header("content-disposition", `attachment; filename="${fileName}"`);
    return reply.send(createReadStream(result.archive_path));
  });

  app.post("/migration/import", async (request, reply) => {
    authorize(request.authContext, "memory_access");
    authorize(request.authContext, "administration");

    if (migrationInProgress) {
      reply.code(409).send({ error: "migration_in_progress" });
      return;
    }

    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    const acceptsImport =
      contentType.includes("application/gzip") ||
      contentType.includes("application/x-gzip") ||
      contentType.includes("application/octet-stream");

    if (!acceptsImport) {
      sendInvalidRequest(reply, "/migration/import", 1);
      return;
    }

    const tempDir = await mkdtemp(path.join(tmpdir(), "paa-migration-upload-"));
    const tempArchivePath = path.join(tempDir, `upload-${Date.now()}.tar.gz`);
    migrationInProgress = true;

    try {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        sendInvalidRequest(reply, "/migration/import", 1);
        return;
      }

      await writeFile(tempArchivePath, request.body);
      const importResult = await importMigrationArchive(tempArchivePath, {
        memoryRoot: runtimeConfig.memory_root,
        secretsPaths: resolveSecretsPaths(),
      });
      await ensureMemoryLayout(rootDir, runtimeConfig.memory_root);
      await ensureGitReady(runtimeConfig.memory_root);
      authState = await ensureAuthState(runtimeConfig.memory_root, { mode: runtimeConfig.auth_mode });
      localJwtAuthService?.resetCache();
      const refreshedPreferences = await loadLivePreferences();

      auditLog("migration.import.completed", {
        actor_id: request.authContext.actorId,
        source_format: importResult.source_format,
        restored_memory: importResult.restored.memory,
        restored_secrets: importResult.restored.secrets,
        warnings_count: importResult.warnings.length,
      });
      let logoutRequired = false;
      if (localJwtAuthService) {
        await localJwtAuthService.logout();
        reply.header("set-cookie", serializeRefreshCookieClear(isSecureRequest(request)));
        logoutRequired = true;
      }

      reply.code(201).send({
        ...importResult,
        settings: buildSettingsPayload(adapterConfig, refreshedPreferences),
        logout_required: logoutRequired,
      });
    } catch (error) {
      auditLog("migration.import.failed", {
        actor_id: request.authContext.actorId,
        message: error instanceof Error ? error.message : "Unknown migration import error",
      });
      reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to import migration archive",
      });
    } finally {
      migrationInProgress = false;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  app.get("/support/bundles", async (request, reply) => {
    authorize(request.authContext, "administration");
    authorize(request.authContext, "memory_access");
    if (!supportBundleEndpointsEnabled(runtimeConfig)) {
      reply.code(403).send({ error: "support_bundle_requires_local_jwt_auth" });
      return;
    }

    const bundles = await listSupportBundles(runtimeConfig.memory_root);
    reply.send({
      scope: "memory-only",
      bundles,
    });
  });

  app.post("/support/bundles", async (request, reply) => {
    authorize(request.authContext, "administration");
    authorize(request.authContext, "memory_access");
    if (!supportBundleEndpointsEnabled(runtimeConfig)) {
      reply.code(403).send({ error: "support_bundle_requires_local_jwt_auth" });
      return;
    }

    const parsed = supportBundleCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendInvalidRequest(reply, "/support/bundles", parsed.error.issues.length);
      return;
    }

    const windowHours = parsed.data.window_hours ?? 24;
    const result = await createSupportBundle(runtimeConfig.memory_root, {
      windowHours,
      appVersion,
      installMode: runtimeConfig.install_mode,
      installLocation,
      authMode: runtimeConfig.auth_mode,
      actorId: request.authContext.actorId,
    });
    auditLog("support.bundle.create", {
      actor_id: request.authContext.actorId,
      file_name: result.file_name,
      archive_path: result.archive_path,
      window_hours: windowHours,
      included_audit_files: result.included_audit_files,
      scope: "memory-only",
    });

    reply.code(201).send({
      scope: "memory-only",
      file_name: result.file_name,
      window_hours: windowHours,
      included_audit_files: result.included_audit_files,
      download_path: `/support/bundles/${encodeURIComponent(result.file_name)}`,
    });
  });

  app.get("/support/bundles/:fileName", async (request, reply) => {
    authorize(request.authContext, "administration");
    authorize(request.authContext, "memory_access");
    if (!supportBundleEndpointsEnabled(runtimeConfig)) {
      reply.code(403).send({ error: "support_bundle_requires_local_jwt_auth" });
      return;
    }

    const params = supportBundleDownloadParamsSchema.safeParse(request.params);
    if (!params.success) {
      sendInvalidRequest(reply, "/support/bundles/:fileName", params.error.issues.length);
      return;
    }

    const absolutePath = resolveSupportBundleDownloadPath(runtimeConfig.memory_root, params.data.fileName);
    if (!absolutePath) {
      reply.code(404).send({ error: "Support bundle not found" });
      return;
    }

    try {
      const details = await stat(absolutePath);
      if (!details.isFile()) {
        reply.code(404).send({ error: "Support bundle not found" });
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reply.code(404).send({ error: "Support bundle not found" });
        return;
      }
      throw error;
    }

    auditLog("support.bundle.download", {
      actor_id: request.authContext.actorId,
      file_name: params.data.fileName,
      scope: "memory-only",
    });
    reply.header("content-type", "application/gzip");
    reply.header("content-disposition", `attachment; filename="${params.data.fileName}"`);
    return reply.send(createReadStream(absolutePath));
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

  app.delete("/projects/:id/conversation", async (request, reply) => {
    const params = request.params as { id: string };
    const detached = await projects.detachConversation(params.id);
    if (!detached) {
      reply.code(404).send({ error: "Project not found" });
      return;
    }

    reply.send({ ok: true });
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

  app.post("/projects/:id/uploads", async (request, reply) => {
    void request;
    reply.code(410).send({
      error: RETIRED_DOCUMENT_PROCESSING_MESSAGE,
      code: "document_processing_retired",
    });
  });

  // --- Managed mode proxy endpoints ---
  if (isManaged && managedApiBase) {
    app.get("/account", async (request, reply) => proxyToGateway(request, reply, "GET", "/api/gateway/auth/account"));
    app.post("/account/change-password", async (request, reply) => proxyToGateway(request, reply, "POST", "/api/gateway/auth/change-password", request.body));
    app.post("/account/change-email", async (request, reply) => proxyToGateway(request, reply, "POST", "/api/gateway/auth/account/change-email", request.body));
    app.delete("/account", async (request, reply) => proxyToGateway(request, reply, "DELETE", "/api/gateway/auth/account", request.body));
    app.post("/account/portal-session", async (request, reply) => proxyToGateway(request, reply, "POST", "/api/gateway/billing/create-portal-session", request.body));
    app.post("/account/topup", async (request, reply) => proxyToGateway(request, reply, "POST", "/api/gateway/billing/topup", request.body));
  }

  return {
    app,
    runtimeConfig,
    adapterConfig,
    rootDir,
  };
}

async function proxyToGateway(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  method: string,
  path: string,
  body?: unknown,
) {
  const managedApiBase = process.env.BD_MANAGED_API_BASE?.replace(/\/+$/, "") || "";
  if (!managedApiBase) {
    reply.code(404).send({ error: "Not available" });
    return;
  }
  const hasBody = body !== undefined && body !== null;
  const resp = await fetch(`${managedApiBase}${path}`, {
    method,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(request.headers.cookie ? { Cookie: request.headers.cookie } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });
  // Forward Set-Cookie headers from upstream
  const setCookie = resp.headers.getSetCookie?.();
  if (setCookie && setCookie.length > 0) {
    for (const cookie of setCookie) {
      reply.header("set-cookie", cookie);
    }
  }
  reply.code(resp.status);
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    return resp.json();
  }
  return resp.text();
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

function readAppLifecycleTarget(value: string | undefined): AppLifecycleRuntimeTarget {
  const target = value?.trim() || "docker_linux_x64";
  if (target === "docker_linux_x64" || target === "desktop_windows_x64") return target;
  throw new Error("BRAINDRIVE_APP_PLATFORM_TARGET must name an accepted Resume Builder runtime target");
}

function applyDesktopCorsHeaders(
  origin: string | undefined,
  reply: import("fastify").FastifyReply,
  configuredOrigin: string,
  desktopTokenEnabled: boolean
): void {
  const headers = buildDesktopCorsHeaders(origin, configuredOrigin, desktopTokenEnabled);
  for (const [name, value] of Object.entries(headers)) {
    reply.header(name, value);
  }
}

function buildDesktopCorsHeaders(
  origin: string | undefined,
  configuredOrigin: string,
  desktopTokenEnabled: boolean
): Record<string, string> {
  if (!desktopTokenEnabled || !origin) {
    return {};
  }

  if (configuredOrigin && origin !== configuredOrigin) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    vary: "origin",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,x-actor-id,x-actor-type,x-auth-mode,x-actor-permissions,x-braindrive-desktop-token,x-conversation-id",
    "access-control-expose-headers":
      "x-conversation-id,x-context-window-warning,x-context-window-estimated-tokens,x-context-window-budget-tokens,x-context-window-ratio,x-context-window-threshold,x-context-window-managed,x-context-window-message",
    "access-control-allow-credentials": "true",
  };
}

function isDesktopTransportAuthorized(headers: Record<string, unknown>, desktopApiToken: string): boolean {
  return desktopApiToken.length > 0 && firstHeaderValue(headers["x-braindrive-desktop-token"]) === desktopApiToken;
}

function isInternalTransportAuthorized(headers: Record<string, unknown>, internalTransportToken: string): boolean {
  return (
    internalTransportToken.length > 0 &&
    firstHeaderValue(headers["x-braindrive-internal-transport-token"]) === internalTransportToken
  );
}

function isBrowserAccessRequest(headers: Record<string, unknown>, internalTransportToken: string): boolean {
  return (
    isInternalTransportAuthorized(headers, internalTransportToken) &&
    firstHeaderValue(headers["x-braindrive-browser-access"]) === "1"
  );
}

function clientIpForRequest(
  request: { ip: string; headers: Record<string, unknown> },
  internalTransportToken: string
): string {
  if (isBrowserAccessRequest(request.headers, internalTransportToken)) {
    const browserClientIp = firstHeaderValue(request.headers["x-braindrive-browser-client-ip"]);
    if (browserClientIp && browserClientIp.length <= 128) {
      return browserClientIp;
    }
  }

  return request.ip;
}

function rateLimitKeyForRequest(
  request: { ip: string; headers: Record<string, unknown> },
  internalTransportToken: string
): string {
  const browserClientId = browserClientIdForRequest(request.headers, internalTransportToken);
  if (browserClientId) {
    return browserClientId;
  }

  return clientIpForRequest(request, internalTransportToken);
}

function browserClientIdForRequest(
  headers: Record<string, unknown>,
  internalTransportToken: string
): string | undefined {
  // This identifier partitions auth rate limits only; it is never an account or authorization identity.
  if (!isBrowserAccessRequest(headers, internalTransportToken)) {
    return undefined;
  }

  const value = headers["x-braindrive-browser-client-id"];
  if (typeof value !== "string" || !/^tailnet:[0-9a-f]{64}$/.test(value)) {
    return undefined;
  }

  return value;
}

function firstHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function readPositiveIntEnv(value: string | undefined, defaultValue: number): number {
  const normalized = value?.trim();
  if (!normalized) {
    return defaultValue;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

function supportBundleEndpointsEnabled(runtimeConfig: RuntimeConfig): boolean {
  return runtimeConfig.auth_mode === "local";
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

function validateMemoryBackupRepositoryUrl(repositoryUrl: string): string | null {
  if (looksLikeSshRepositoryUrl(repositoryUrl)) {
    return "Only https:// repository URLs are supported";
  }

  const parsed = tryParseUrl(repositoryUrl);
  if (!parsed) {
    return "Repository URL must be a valid URL";
  }

  if (parsed.protocol !== "https:") {
    return "Only https:// repository URLs are supported";
  }

  if (parsed.username || parsed.password) {
    return "Repository URL cannot include embedded credentials";
  }

  return null;
}

function looksLikeSshRepositoryUrl(repositoryUrl: string): boolean {
  const normalized = repositoryUrl.trim().toLowerCase();
  return normalized.startsWith("ssh://") || normalized.startsWith("git@");
}

function tryParseUrl(repositoryUrl: string): URL | null {
  try {
    return new URL(repositoryUrl);
  } catch {
    return null;
  }
}

function buildSettingsPayload(
  adapterConfig: AdapterConfig,
  preferences: Preferences
): {
  default_model: string;
  approval_mode: ApprovalMode;
  active_provider_profile: string | null;
  provider_activation_revision: number;
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
  braindrive_models_key: {
    status:
      | "provisioned"
      | "ready"
      | "checkout_pending"
      | "zero_balance"
      | "repair_required"
      | "provision_failed"
      | "vault_write_failed";
    checkout_pending: boolean;
    masked_key?: string;
    expires_unfunded_at?: string;
    last_attempt_at?: string;
    last_error?: string | null;
  } | null;
  memory_backup: {
    repository_url: string;
    frequency: "manual" | "after_changes" | "hourly" | "daily";
    token_configured: boolean;
    last_save_at?: string;
    last_attempt_at?: string;
    last_result: "never" | "success" | "failed";
    last_error: string | null;
  } | null;
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
  const effectiveDefaultModel = activeProfileId
    ? (preferences.provider_default_models?.[activeProfileId] ?? activeProfileEntry?.model ?? "")
    : preferences.default_model;

  const availableModels = Array.from(
    new Set(
      [effectiveDefaultModel].filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    )
  );
  const memoryBackup = preferences.memory_backup;
  const brainDriveModelsKey = preferences.braindrive_models_key;

  return {
    default_model: effectiveDefaultModel,
    approval_mode: preferences.approval_mode,
    active_provider_profile: preferences.active_provider_profile ?? null,
    provider_activation_revision: normalizeProviderActivationRevision(
      preferences.provider_activation_revision
    ),
    default_provider_profile: adapterConfig.default_provider_profile ?? null,
    available_models: availableModels,
    provider_profiles: providerProfilePayload,
    braindrive_models_key: brainDriveModelsKey
      ? {
          status: brainDriveModelsKey.status ?? "provisioned",
          checkout_pending: brainDriveModelsKey.checkout_pending ?? false,
          ...(brainDriveModelsKey.masked_key ? { masked_key: brainDriveModelsKey.masked_key } : {}),
          ...(brainDriveModelsKey.expires_unfunded_at
            ? { expires_unfunded_at: brainDriveModelsKey.expires_unfunded_at }
            : {}),
          ...(brainDriveModelsKey.last_attempt_at ? { last_attempt_at: brainDriveModelsKey.last_attempt_at } : {}),
          ...(brainDriveModelsKey.last_error !== undefined ? { last_error: brainDriveModelsKey.last_error } : {}),
        }
      : null,
    memory_backup: memoryBackup
      ? {
          repository_url: memoryBackup.repository_url,
          frequency: memoryBackup.frequency,
          token_configured: memoryBackup.token_secret_ref.trim().length > 0,
          ...(memoryBackup.last_save_at ? { last_save_at: memoryBackup.last_save_at } : {}),
          ...(memoryBackup.last_attempt_at ? { last_attempt_at: memoryBackup.last_attempt_at } : {}),
          last_result: memoryBackup.last_result ?? "never",
          last_error: memoryBackup.last_error ?? null,
        }
      : null,
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
      const requiresSecretByDefault = providerRequiresSecretByDefault(profile.provider_id);
      const preference = preferences.provider_credentials?.[profile.provider_id];
      if (!preference) {
        return {
          profile_id: profile.id,
          provider_id: profile.provider_id,
          credential_mode: "unset" as const,
          credential_ref: null,
          requires_secret: requiresSecretByDefault,
          credential_resolved: !requiresSecretByDefault,
          resolution_source: "none" as const,
          resolution_error: requiresSecretByDefault ? "Provider credential is not configured" : null,
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
          requires_secret: preference.required ?? requiresSecretByDefault,
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
          requires_secret: preference.required ?? requiresSecretByDefault,
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
          requires_secret: preference.required ?? requiresSecretByDefault,
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

function providerRequiresSecretByDefault(providerId: string): boolean {
  return providerId.trim().toLowerCase() !== "ollama";
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

function normalizeOllamaOpenAIBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");

  if (normalizedPath === "" || normalizedPath === "/api") {
    parsed.pathname = "/v1";
  } else if (normalizedPath.endsWith("/api/chat") || normalizedPath.endsWith("/api/generate")) {
    parsed.pathname = normalizedPath.replace(/\/api\/(?:chat|generate)$/, "/v1");
  } else if (normalizedPath.endsWith("/chat/completions") || normalizedPath.endsWith("/models")) {
    parsed.pathname = normalizedPath.replace(/\/(?:chat\/completions|models)$/, "");
  } else {
    parsed.pathname = normalizedPath;
  }

  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function buildProjectChatContext(
  projectId: string,
  files: GatewayProjectFile[]
): string {
  const sortedFiles = files
    .filter((file) => !isRetiredBudgetArchiveContextFile(projectId, file))
    .sort((left, right) => left.name.localeCompare(right.name));
  const visibleFiles = sortedFiles.slice(0, 80);
  const omittedCount = Math.max(0, sortedFiles.length - visibleFiles.length);
  const hasIndex = sortedFiles.some((file) => file.name === "index.md" || file.path === `documents/${projectId}/index.md`);
  const fileList = visibleFiles.length > 0
    ? visibleFiles.map((file) => `- ${file.path}`).join("\n")
    : "- No files currently exist in this project folder.";
  const omittedLine = omittedCount > 0
    ? `\n- ... ${omittedCount} additional files omitted from this context. Use memory_list to inspect the full folder.`
    : "";

  return [
    "",
    "",
    "## Active Project",
    "",
    `You are currently in the **${projectId}** project.`,
    "Read AGENT.md first if present, then AGENT-user.md if present.",
    "Use this project's other instruction files according to its AGENT.md.",
    hasIndex
      ? `Read documents/${projectId}/index.md before deciding which supporting documents to open. It is this folder's document map.`
      : `If documents/${projectId}/index.md appears later in the file list, read it before deciding which supporting documents to open.`,
    "Stay focused on this domain; do not read or reference other projects unless the conversation specifically calls for cross-domain connections.",
    "",
    "### Current Project Files",
    "",
    "This is the current file list at the start of this user turn:",
    `${fileList}${omittedLine}`,
    "",
    "When the user asks to read, edit, delete, or confirm the existence of a project file, use this current list as the starting point.",
    "Do not rely on earlier conversation claims that a file was already deleted or missing if the current list shows a matching file.",
    `For delete requests in this project, prefer exact paths under documents/${projectId}/ and call memory_delete when a matching file exists.`,
    "If the current list is ambiguous or incomplete, call memory_list before claiming the file cannot be found.",
  ].join("\n");
}

function isRetiredBudgetArchiveContextFile(projectId: string, file: GatewayProjectFile): boolean {
  return projectId === "finance" && /^documents\/finance\/archive\/retired-budget(?:\/|$)/i.test(file.path);
}

async function buildPromptAuditAssembly(input: {
  memoryRoot: string;
  conversationId: string;
  projectId: string | null;
  projectFiles: GatewayProjectFile[];
  projectContext: string;
  currentUserMessage: ConversationMessage;
  conversation: ConversationDetail | null;
  requestedProjectSkillIds: string[];
  requestedConversationSkillIds: string[];
  promptWithSkills: {
    prompt: string;
    applied: string[];
    missing: string[];
    truncated: boolean;
  };
  finalSystemPrompt: string;
  contextWindow: PreparedContextWindow;
  engineRequest: GatewayEngineRequest;
  includeSourceSnapshots: boolean;
}): Promise<Record<string, unknown>> {
  const bootstrapSources = await Promise.all([
    buildFileSnapshot(input.memoryRoot, "AGENT.md", input.includeSourceSnapshots),
    buildFileSnapshot(input.memoryRoot, "AGENT-user.md", input.includeSourceSnapshots),
  ]);
  const skillSources = await Promise.all(
    input.promptWithSkills.applied.map((skillId) =>
      buildFileSnapshot(input.memoryRoot, `skills/${skillId}/SKILL.md`, input.includeSourceSnapshots).then((snapshot) => ({
        skill_id: skillId,
        ...snapshot,
      }))
    )
  );
  const conversationMessages = input.conversation?.messages ?? [];

  return {
    bootstrap_prompt: {
      sources: bootstrapSources,
      final_content_hash: hashText(input.promptWithSkills.prompt),
      final_byte_length: Buffer.byteLength(input.promptWithSkills.prompt, "utf8"),
      ...(input.includeSourceSnapshots ? { assembled_content: input.promptWithSkills.prompt } : {}),
    },
    skills: {
      requested_project_skill_ids: input.requestedProjectSkillIds,
      requested_conversation_skill_ids: input.requestedConversationSkillIds,
      applied_skill_ids: input.promptWithSkills.applied,
      missing_skill_ids: input.promptWithSkills.missing,
      truncated: input.promptWithSkills.truncated,
      sources: skillSources,
    },
    project_context: {
      project_id: input.projectId,
      files: input.projectFiles.map((file) => ({
        name: file.name,
        path: file.path,
      })),
      generated_context_hash: hashText(input.projectContext),
      generated_context_byte_length: Buffer.byteLength(input.projectContext, "utf8"),
      ...(input.includeSourceSnapshots ? { generated_context: input.projectContext } : {}),
    },
    conversation_history: {
      conversation_id: input.conversationId,
      replayed_messages: conversationMessages.map((message) => ({
        id: message.id,
        role: message.role,
      })),
      message_count: conversationMessages.length,
      estimated_tokens_before_context_window: input.contextWindow.usage.estimatedPromptTokensBefore,
    },
    context_window: {
      estimated_tokens_before: input.contextWindow.usage.estimatedPromptTokensBefore,
      estimated_tokens_after: input.contextWindow.usage.estimatedPromptTokensAfter,
      budget_tokens: input.contextWindow.usage.budgetTokens,
      dropped_units: input.contextWindow.usage.droppedUnits,
      dropped_message_count: input.contextWindow.usage.droppedMessages,
      summary_applied: input.contextWindow.usage.summaryApplied,
      summary_artifact_path: input.contextWindow.usage.summaryArtifactPath,
      summary_artifact_write_error: input.contextWindow.usage.summaryArtifactWriteError,
      warning: input.contextWindow.warning,
    },
    current_user_message: {
      message_id: input.currentUserMessage.id,
      content_hash: hashText(input.currentUserMessage.content),
      byte_length: Buffer.byteLength(input.currentUserMessage.content, "utf8"),
      ...(input.includeSourceSnapshots ? { content: input.currentUserMessage.content } : {}),
    },
    final_system_prompt: {
      content_hash: hashText(input.finalSystemPrompt),
      byte_length: Buffer.byteLength(input.finalSystemPrompt, "utf8"),
      content: input.finalSystemPrompt,
    },
    engine_request: input.engineRequest,
  };
}

async function buildFileSnapshot(
  memoryRoot: string,
  relativePath: string,
  includeContent: boolean
): Promise<Record<string, unknown>> {
  const absolutePath = path.join(memoryRoot, relativePath);
  try {
    const [content, info] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)]);
    return {
      path: relativePath,
      exists: true,
      content_hash: hashText(content),
      byte_length: Buffer.byteLength(content, "utf8"),
      modified_time: info.mtime.toISOString(),
      ...(includeContent ? { content } : {}),
    };
  } catch {
    return {
      path: relativePath,
      exists: false,
    };
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function createBrainDriveMemorySafetyGuard(
  projectId: string | null,
  conversation: ConversationDetail | null
): ToolExecutionGuard {
  void projectId;
  void conversation;
  return () => null;
}

if (isDirectEntrypoint(process.argv[1], import.meta.url)) {
  const rootDir = process.cwd();
  buildServer(rootDir)
    .then(async ({ app, runtimeConfig }) => {
      await app.listen({ host: runtimeConfig.bind_address, port: runtimeConfig.port ?? 8787 });
      auditLog("startup.listen", { host: runtimeConfig.bind_address, port: runtimeConfig.port ?? 8787 });
      let closing = false;
      const close = () => {
        if (closing) return;
        closing = true;
        void app.close().catch((error) => {
          auditLog("shutdown.failure", { message: error instanceof Error ? error.message : "Unknown shutdown error" });
          process.exitCode = 1;
        });
      };
      process.once("SIGTERM", close);
      process.once("SIGINT", close);
    })
    .catch((error) => {
      auditLog("startup.failure", {
        message: error instanceof Error ? error.message : "Unknown startup error",
      });
      process.exitCode = 1;
    });
}

function isDirectEntrypoint(argvPath: string | undefined, moduleUrl: string): boolean {
  if (!argvPath) {
    return false;
  }

  return normalizeEntrypointPath(argvPath) === normalizeEntrypointPath(fileURLToPath(moduleUrl));
}

function normalizeEntrypointPath(value: string): string {
  const normalized = path.normalize(path.resolve(value)).replace(/^\\\\\?\\/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
