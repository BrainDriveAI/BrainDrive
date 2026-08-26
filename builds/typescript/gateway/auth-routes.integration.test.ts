import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import type { AdapterConfig, Preferences, RuntimeConfig } from "../contracts.js";
import type { MemoryBackupRunResult } from "../memory/backup.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockRuntimeConfig: RuntimeConfig;
let mockPreferences: Preferences;
let mockSavePreferencesError: Error | null = null;
let mockSavePreferencesErrorWhen: ((nextPreferences: Preferences) => boolean) | null = null;
const { runMemoryBackupMock, restoreMemoryBackupMock, createMemoryBackupSchedulerMock, commitMemoryChangeMock } = vi.hoisted(() => ({
  runMemoryBackupMock: vi.fn<
    (
      memoryRoot: string,
      preferences: Preferences,
      options?: { onRemoteConflict?: "fail" | "replace_remote" }
    ) => Promise<MemoryBackupRunResult>
  >(
    async (_memoryRoot: string, _preferences: Preferences) => ({
      attempted_at: "2026-04-07T12:00:00.000Z",
      saved_at: "2026-04-07T12:00:01.000Z",
      result: "success" as const,
    })
  ),
  restoreMemoryBackupMock: vi.fn(
    async (
      _memoryRoot: string,
      _preferences: Preferences,
      _options?: { targetCommit?: string }
    ) => ({
      attempted_at: "2026-04-07T12:10:00.000Z",
      restored_at: "2026-04-07T12:10:03.000Z",
      commit: "abc123def456",
      source_branch: "braindrive-memory-backup",
      warnings: [] as string[],
    })
  ),
  createMemoryBackupSchedulerMock: vi.fn((options: { memoryRoot: string }) => ({
    initialize: vi.fn(async () => {}),
    reconfigure: vi.fn(async () => {}),
    close: vi.fn(() => {}),
    triggerManualBackup: vi.fn(async (runOptions: { onRemoteConflict?: "fail" | "replace_remote" } = {}) => {
      const result = await runMemoryBackupMock(options.memoryRoot, mockPreferences, {
        onRemoteConflict: runOptions.onRemoteConflict,
      });
      const failureMessage =
        "message" in result && typeof result.message === "string" ? result.message : undefined;
      const existingBackup = mockPreferences.memory_backup;
      if (existingBackup) {
        mockPreferences = {
          ...mockPreferences,
          memory_backup: {
            ...existingBackup,
            last_attempt_at: result.attempted_at,
            ...(result.saved_at ? { last_save_at: result.saved_at } : {}),
            last_result: result.result === "success" || result.result === "noop" ? "success" : "failed",
            last_error: result.result === "success" || result.result === "noop" ? null : failureMessage ?? "Backup failed",
          },
        };
      }

      return {
        result,
        preferences: mockPreferences,
      };
    }),
  })),
  commitMemoryChangeMock: vi.fn(async () => {}),
}));

let mockAdapterConfig: AdapterConfig = {
  base_url: "https://openrouter.ai/api/v1",
  model: "openai/gpt-4o-mini",
  api_key_env: "OPENROUTER_API_KEY",
  provider_id: "openrouter",
};

vi.mock("../config.js", () => ({
  loadRuntimeConfig: vi.fn(async () => mockRuntimeConfig),
  loadAdapterConfig: vi.fn(async () => mockAdapterConfig),
  loadPreferences: vi.fn(async () => mockPreferences),
  ensureMemoryLayout: vi.fn(async () => {}),
  ensureSystemAppConfig: vi.fn(async () => ({
    path: "/tmp/app-config.json",
    backupPath: "/tmp/app-config.bak.json",
    installMode: "local",
    installLocation: "local",
    updated: false,
  })),
  readBootstrapPrompt: vi.fn(async () => "You are a test bootstrap prompt."),
  savePreferences: vi.fn(async (_memoryRoot: string, nextPreferences: Preferences) => {
    if (
      mockSavePreferencesError &&
      (!mockSavePreferencesErrorWhen || mockSavePreferencesErrorWhen(nextPreferences))
    ) {
      throw mockSavePreferencesError;
    }
    mockPreferences = nextPreferences;
  }),
}));

vi.mock("../tools.js", () => ({
  discoverTools: vi.fn(async () => []),
}));

vi.mock("../git.js", () => ({
  ensureGitReady: vi.fn(async () => {}),
  commitMemoryChange: commitMemoryChangeMock,
  exportMemoryArchive: vi.fn(async (_memoryRoot: string, destinationPath: string) => {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, "backup", "utf8");
  }),
}));

vi.mock("../secrets/resolver.js", () => ({
  resolveProviderCredentialForStartup: vi.fn(async () => null),
}));

vi.mock("../memory/backup.js", () => ({
  runMemoryBackup: runMemoryBackupMock,
}));

vi.mock("../memory/backup-restore.js", () => ({
  restoreMemoryBackup: restoreMemoryBackupMock,
}));

vi.mock("./memory-backup-scheduler.js", () => ({
  createMemoryBackupScheduler: createMemoryBackupSchedulerMock,
}));

import { buildServer } from "./server.js";
import {
  loadPreferences as loadPreferencesConfigMock,
  readBootstrapPrompt as readBootstrapPromptConfigMock,
} from "../config.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import { initializeMasterKey, loadMasterKey } from "../secrets/key-provider.js";
import { resolveSecretsPaths } from "../secrets/paths.js";
import { getVaultSecret, upsertVaultSecret } from "../secrets/vault.js";

type TestServerContext = {
  app: Awaited<ReturnType<typeof buildServer>>["app"];
  tempRoot: string;
  restoreEnv: () => void;
};

async function createTestServer(
  options: {
    bootstrapToken?: string;
    allowFirstSignupAnyIp?: boolean;
    authMode?: RuntimeConfig["auth_mode"];
    deploymentMode?: "managed" | "local";
    managedApiBase?: string;
    allowManagedPublicAccountProxyRoutes?: boolean;
    memoryAutoUpdateEnabled?: string;
    seedLegacyMemoryUpdateState?: boolean;
    desktopApiToken?: string;
    internalTransportToken?: string;
    adapterConfig?: AdapterConfig;
  } = {}
): Promise<TestServerContext> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-auth-int-"));
  const memoryRoot = path.join(tempRoot, "memory");
  const preferencesRoot = path.join(memoryRoot, "preferences");
  const secretsRoot = path.join(tempRoot, "secrets");

  await mkdir(preferencesRoot, { recursive: true });
  await mkdir(secretsRoot, { recursive: true });
  if (options.seedLegacyMemoryUpdateState) {
    await mkdir(path.join(memoryRoot, "system", "updates"), { recursive: true });
    await writeFile(path.join(memoryRoot, "AGENT.md"), "# Custom Agent\n\nKeep this.\n", "utf8");
    await writeFile(
      path.join(memoryRoot, "system", "updates", "memory-state.json"),
      JSON.stringify(
        {
          schema_version: 1,
          memory_pack_version: "unknown",
          last_checked_app_version: "26.4.19",
          last_completed_migration_id: null,
          pending_migration_id: "starter-pack-26.4.20",
          last_reported_at: null,
          updated_at: "2026-04-19T00:00:00.000Z",
        },
        null,
        2
      ),
      "utf8"
    );
  }

  mockRuntimeConfig = {
    memory_root: memoryRoot,
    provider_adapter: "openai-compatible",
    conversation_store: "markdown",
    auth_mode: options.authMode ?? "local",
    install_mode: "local",
    tool_sources: [],
    bind_address: "127.0.0.1",
    port: 8787,
  };

  mockPreferences = {
    default_model: "openai/gpt-4o-mini",
    approval_mode: "ask-on-write",
    secret_resolution: {
      on_missing: "fail_closed",
    },
  };
  mockSavePreferencesError = null;
  mockSavePreferencesErrorWhen = null;
  mockAdapterConfig = options.adapterConfig ?? {
    base_url: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    api_key_env: "OPENROUTER_API_KEY",
    provider_id: "openrouter",
  };

  const previousSecretsHome = process.env.PAA_SECRETS_HOME;
  const previousBootstrapToken = process.env.PAA_AUTH_BOOTSTRAP_TOKEN;
  const previousAllowFirstSignupAnyIp = process.env.PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP;
  const previousDeploymentMode = process.env.BD_DEPLOYMENT_MODE;
  const previousManagedApiBase = process.env.BD_MANAGED_API_BASE;
  const previousManagedPublicAccountProxyRoutes = process.env.PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES;
  const previousMemoryAutoUpdateEnabled = process.env.PAA_MEMORY_AUTO_UPDATE_ENABLED;
  const previousAppVersion = process.env.BRAINDRIVE_APP_VERSION;
  const previousDesktopApiToken = process.env.BRAINDRIVE_DESKTOP_API_TOKEN;
  const previousInternalTransportToken = process.env.BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN;

  process.env.PAA_SECRETS_HOME = secretsRoot;
  if (typeof options.memoryAutoUpdateEnabled === "string") {
    process.env.PAA_MEMORY_AUTO_UPDATE_ENABLED = options.memoryAutoUpdateEnabled;
  } else {
    delete process.env.PAA_MEMORY_AUTO_UPDATE_ENABLED;
  }
  process.env.BRAINDRIVE_APP_VERSION = "26.4.20";
  if (typeof options.bootstrapToken === "string") {
    process.env.PAA_AUTH_BOOTSTRAP_TOKEN = options.bootstrapToken;
  } else {
    delete process.env.PAA_AUTH_BOOTSTRAP_TOKEN;
  }
  if (typeof options.allowFirstSignupAnyIp === "boolean") {
    process.env.PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP = options.allowFirstSignupAnyIp ? "true" : "false";
  } else {
    delete process.env.PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP;
  }
  if (options.deploymentMode) {
    process.env.BD_DEPLOYMENT_MODE = options.deploymentMode;
  } else {
    delete process.env.BD_DEPLOYMENT_MODE;
  }
  if (typeof options.managedApiBase === "string") {
    process.env.BD_MANAGED_API_BASE = options.managedApiBase;
  } else {
    delete process.env.BD_MANAGED_API_BASE;
  }
  if (typeof options.allowManagedPublicAccountProxyRoutes === "boolean") {
    process.env.PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES = options.allowManagedPublicAccountProxyRoutes
      ? "true"
      : "false";
  } else {
    delete process.env.PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES;
  }
  if (typeof options.desktopApiToken === "string") {
    process.env.BRAINDRIVE_DESKTOP_API_TOKEN = options.desktopApiToken;
  } else {
    delete process.env.BRAINDRIVE_DESKTOP_API_TOKEN;
  }
  if (typeof options.internalTransportToken === "string") {
    process.env.BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN = options.internalTransportToken;
  } else {
    delete process.env.BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN;
  }

  const { app } = await buildServer(tempRoot);

  return {
    app,
    tempRoot,
    restoreEnv: () => {
      if (typeof previousSecretsHome === "string") {
        process.env.PAA_SECRETS_HOME = previousSecretsHome;
      } else {
        delete process.env.PAA_SECRETS_HOME;
      }

      if (typeof previousBootstrapToken === "string") {
        process.env.PAA_AUTH_BOOTSTRAP_TOKEN = previousBootstrapToken;
      } else {
        delete process.env.PAA_AUTH_BOOTSTRAP_TOKEN;
      }
      if (typeof previousAllowFirstSignupAnyIp === "string") {
        process.env.PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP = previousAllowFirstSignupAnyIp;
      } else {
        delete process.env.PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP;
      }
      if (typeof previousDeploymentMode === "string") {
        process.env.BD_DEPLOYMENT_MODE = previousDeploymentMode;
      } else {
        delete process.env.BD_DEPLOYMENT_MODE;
      }
      if (typeof previousManagedApiBase === "string") {
        process.env.BD_MANAGED_API_BASE = previousManagedApiBase;
      } else {
        delete process.env.BD_MANAGED_API_BASE;
      }
      if (typeof previousManagedPublicAccountProxyRoutes === "string") {
        process.env.PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES = previousManagedPublicAccountProxyRoutes;
      } else {
        delete process.env.PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES;
      }
      if (typeof previousMemoryAutoUpdateEnabled === "string") {
        process.env.PAA_MEMORY_AUTO_UPDATE_ENABLED = previousMemoryAutoUpdateEnabled;
      } else {
        delete process.env.PAA_MEMORY_AUTO_UPDATE_ENABLED;
      }
      if (typeof previousAppVersion === "string") {
        process.env.BRAINDRIVE_APP_VERSION = previousAppVersion;
      } else {
        delete process.env.BRAINDRIVE_APP_VERSION;
      }
      if (typeof previousDesktopApiToken === "string") {
        process.env.BRAINDRIVE_DESKTOP_API_TOKEN = previousDesktopApiToken;
      } else {
        delete process.env.BRAINDRIVE_DESKTOP_API_TOKEN;
      }
      if (typeof previousInternalTransportToken === "string") {
        process.env.BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN = previousInternalTransportToken;
      } else {
        delete process.env.BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN;
      }
    },
  };
}

async function destroyTestServer(context: TestServerContext | null): Promise<void> {
  if (!context) {
    return;
  }

  await context.app.close();
  context.restoreEnv();
  await rm(context.tempRoot, { recursive: true, force: true });
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

async function restartTestServer(context: TestServerContext): Promise<void> {
  await context.app.close();
  context.app = (await buildServer(context.tempRoot)).app;
}

function localOwnerAdminHeaders(): Record<string, string> {
  return {
    "x-actor-id": "owner",
    "x-actor-type": "owner",
    "x-auth-mode": "local-owner",
    "x-actor-permissions": JSON.stringify({
      memory_access: true,
      tool_access: true,
      system_actions: true,
      delegation: true,
      approval_authority: true,
      administration: true,
    }),
  };
}

function brainDriveModelsAdapterConfig(): AdapterConfig {
  return {
    base_url: "https://my.braindrive.ai/credits/v1",
    model: "braindrive-models-default",
    api_key_env: "AI_GATEWAY_API_KEY",
    provider_id: "braindrive-models",
    default_provider_profile: "braindrive-models",
    provider_profiles: {
      "braindrive-models": {
        base_url: "https://my.braindrive.ai/credits/v1",
        model: "braindrive-models-default",
        api_key_env: "AI_GATEWAY_API_KEY",
        provider_id: "braindrive-models",
      },
      openrouter: {
        base_url: "https://openrouter.ai/api/v1",
        model: "z-ai/glm-5.2",
        api_key_env: "OPENROUTER_API_KEY",
        provider_id: "openrouter",
      },
      ollama: {
        base_url: "http://host.docker.internal:11434/v1",
        model: "",
        api_key_env: "OLLAMA_API_KEY",
        provider_id: "ollama",
      },
    },
  };
}

function providerActivationAdapterConfig(): AdapterConfig {
  const config = brainDriveModelsAdapterConfig();
  return {
    ...config,
    provider_profiles: {
      ...config.provider_profiles,
      openrouter: {
        ...config.provider_profiles!.openrouter!,
        api_key_env: "OPENROUTER_ACTIVATION_TEST_KEY",
      },
    },
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function readAuditEvents(
  context: TestServerContext,
  eventName: string
): Promise<Array<{ event: string; details: Record<string, unknown> }>> {
  const auditDir = path.join(context.tempRoot, "memory", "diagnostics", "audit");
  const fileNames = await readdir(auditDir);
  const events: Array<{ event: string; details: Record<string, unknown> }> = [];
  for (const fileName of fileNames.sort()) {
    const contents = await readFile(path.join(auditDir, fileName), "utf8");
    for (const line of contents.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const event = parseJson<{ event: string; details: Record<string, unknown> }>(line);
      if (event.event === eventName) {
        events.push(event);
      }
    }
  }
  return events;
}

function streamingProviderResponse(content = "Done."): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
        );
        controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

async function readVaultSecret(secretRef: string): Promise<string | undefined> {
  const paths = resolveSecretsPaths();
  const masterKey = await loadMasterKey(paths);
  return getVaultSecret(secretRef, masterKey, paths);
}

async function writeVaultSecret(secretRef: string, value: string): Promise<void> {
  const paths = resolveSecretsPaths();
  await initializeMasterKey({ paths });
  const masterKey = await loadMasterKey(paths);
  await upsertVaultSecret(secretRef, value, masterKey, paths);
}

describe.sequential("gateway auth route integration", () => {
  let context: TestServerContext | null = null;

  afterEach(async () => {
    await destroyTestServer(context);
    context = null;
    runMemoryBackupMock.mockClear();
    restoreMemoryBackupMock.mockClear();
    createMemoryBackupSchedulerMock.mockClear();
    commitMemoryChangeMock.mockClear();
    mockSavePreferencesError = null;
    mockSavePreferencesErrorWhen = null;
    vi.mocked(resolveProviderCredentialForStartup).mockReset();
    vi.mocked(resolveProviderCredentialForStartup).mockResolvedValue(undefined);
    vi.unstubAllGlobals();
  });

  it("rejects unauthenticated logout requests", async () => {
    context = await createTestServer();

    const response = await context.app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Unauthorized");
  });

  it("allows authenticated logout after successful signup", async () => {
    context = await createTestServer();

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);

    const tokenPayload = parseJson<{ access_token: string }>(signupResponse.body);
    expect(tokenPayload.access_token.length).toBeGreaterThan(0);

    const logoutResponse = await context.app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
      },
      payload: {},
    });

    expect(logoutResponse.statusCode).toBe(200);
    expect(parseJson<{ ok: boolean }>(logoutResponse.body)).toEqual({ ok: true });

    const setCookieHeader = logoutResponse.headers["set-cookie"];
    expect(typeof setCookieHeader === "string" ? setCookieHeader : "").toContain("Max-Age=0");
  });

  it("rejects retired project document uploads without memory writes", async () => {
    context = await createTestServer();

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);
    const tokenPayload = parseJson<{ access_token: string }>(signupResponse.body);
    const memoryRoot = path.join(context.tempRoot, "memory");
    await mkdir(path.join(memoryRoot, "documents", "finance"), { recursive: true });
    await writeFile(
      path.join(memoryRoot, "documents", "projects.json"),
      JSON.stringify([{ id: "finance", name: "Finance", icon: "dollar-sign" }]),
      "utf8"
    );

    commitMemoryChangeMock.mockClear();
    const response = await context.app.inject({
      method: "POST",
      url: "/projects/finance/uploads",
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
      },
      payload: {
        file_name: "statement.csv",
        mime_type: "text/csv",
        content_base64: Buffer.from("Date,Amount\n2026-05-01,-12.34\n", "utf8").toString("base64"),
        size: 30,
      },
    });

    expect(response.statusCode).toBe(410);
    expect(parseJson<{ code: string; error: string }>(response.body)).toEqual({
      code: "document_processing_retired",
      error: "Document processing has been retired in this build while BrainDrive redesigns file handling. No file was saved or processed.",
    });
    await expect(readFile(path.join(memoryRoot, "documents", "finance", "statement.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "statements", "README.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(commitMemoryChangeMock).not.toHaveBeenCalled();
  });

  it("allows desktop-token requests in local mode after account initialization", async () => {
    context = await createTestServer({ desktopApiToken: "desktop-test-token" });

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: {
        "x-braindrive-desktop-token": "desktop-test-token",
      },
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);

    const response = await context.app.inject({
      method: "GET",
      url: "/settings",
      headers: {
        "x-braindrive-desktop-token": "desktop-test-token",
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it("does not treat internal transport token as local owner auth", async () => {
    context = await createTestServer({ internalTransportToken: "bridge-transport-token" });

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: {
        "x-braindrive-internal-transport-token": "bridge-transport-token",
      },
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);

    const response = await context.app.inject({
      method: "GET",
      url: "/settings",
      headers: {
        "x-braindrive-internal-transport-token": "bridge-transport-token",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("keeps tailnet identity transport-only and issues secure refresh cookies for trusted HTTPS", async () => {
    context = await createTestServer({ internalTransportToken: "bridge-transport-token" });
    const transportHeaders = {
      "x-braindrive-internal-transport-token": "bridge-transport-token",
    };
    const tailnetHeaders = {
      ...transportHeaders,
      "x-braindrive-browser-access": "1",
      "x-braindrive-browser-client-id": `tailnet:${"a".repeat(64)}`,
      "x-forwarded-proto": "https",
    };

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: transportHeaders,
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);

    const protectedResponse = await context.app.inject({
      method: "GET",
      url: "/settings",
      headers: tailnetHeaders,
    });
    expect(protectedResponse.statusCode).toBe(401);

    const loginResponse = await context.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: tailnetHeaders,
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(loginResponse.statusCode).toBe(200);
    const loginCookie = String(loginResponse.headers["set-cookie"] ?? "");
    expect(loginCookie).toContain("Secure");
    expect(loginCookie).toContain("HttpOnly");
    expect(loginCookie).toContain("SameSite=Strict");

    const refreshResponse = await context.app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        ...tailnetHeaders,
        cookie: loginCookie.split(";", 1)[0],
      },
      payload: {},
    });
    expect(refreshResponse.statusCode).toBe(200);
    expect(String(refreshResponse.headers["set-cookie"] ?? "")).toContain("Secure");

    const lanLoginResponse = await context.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        ...transportHeaders,
        "x-braindrive-browser-access": "1",
        "x-braindrive-browser-client-ip": "192.168.1.50",
        "x-forwarded-proto": "http",
      },
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(lanLoginResponse.statusCode).toBe(200);
    const lanCookie = String(lanLoginResponse.headers["set-cookie"] ?? "");
    expect(lanCookie).toContain("HttpOnly");
    expect(lanCookie).toContain("SameSite=Strict");
    expect(lanCookie).not.toContain("Secure");
  });

  it("trusts a strict browser client ID only with the internal token and browser marker", async () => {
    context = await createTestServer({ internalTransportToken: "bridge-transport-token" });
    const internalHeaders = {
      "x-braindrive-internal-transport-token": "bridge-transport-token",
    };
    const aliceClientId = `tailnet:${"a".repeat(64)}`;
    const bobClientId = `tailnet:${"b".repeat(64)}`;

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: internalHeaders,
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);

    const attemptLogin = (headers: Record<string, string | string[]>) =>
      context!.app.inject({
        method: "POST",
        url: "/auth/login",
        headers,
        payload: {
          identifier: "owner",
          password: "incorrect-password",
        },
      });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await attemptLogin({ ...internalHeaders, "x-braindrive-browser-client-id": aliceClientId })).statusCode)
        .toBe(401);
      expect((await attemptLogin({ ...internalHeaders, "x-braindrive-browser-client-id": bobClientId })).statusCode)
        .toBe(401);
    }
    expect(
      (await attemptLogin({ ...internalHeaders, "x-braindrive-browser-client-id": aliceClientId })).statusCode
    ).toBe(429);

    const trustedHeaders = {
      ...internalHeaders,
      "x-braindrive-browser-access": "1",
    };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await attemptLogin({ ...trustedHeaders, "x-braindrive-browser-client-id": aliceClientId })).statusCode)
        .toBe(401);
      expect((await attemptLogin({ ...trustedHeaders, "x-braindrive-browser-client-id": bobClientId })).statusCode)
        .toBe(401);
    }
    expect(
      (await attemptLogin({ ...trustedHeaders, "x-braindrive-browser-client-id": aliceClientId })).statusCode
    ).toBe(429);

    expect(
      (
        await attemptLogin({
          ...trustedHeaders,
          "x-braindrive-browser-client-id": `tailnet:${"A".repeat(64)}`,
        })
      ).statusCode
    ).toBe(429);
    expect(
      (
        await attemptLogin({
          ...trustedHeaders,
          "x-braindrive-browser-client-id": [bobClientId],
        })
      ).statusCode
    ).toBe(429);
  });

  it("does not trust a directly spoofed browser client ID without an internal token", async () => {
    context = await createTestServer();

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await context.app.inject({
        method: "POST",
        url: "/auth/login",
        headers: {
          "x-braindrive-browser-access": "1",
          "x-braindrive-browser-client-id": `tailnet:${(attempt % 2 === 0 ? "a" : "b").repeat(64)}`,
        },
        payload: {
          identifier: "owner",
          password: "incorrect-password",
        },
      });
      expect(response.statusCode).toBe(401);
    }

    const rateLimitedResponse = await context.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        "x-braindrive-browser-access": "1",
        "x-braindrive-browser-client-id": `tailnet:${"c".repeat(64)}`,
      },
      payload: {
        identifier: "owner",
        password: "incorrect-password",
      },
    });
    expect(rateLimitedResponse.statusCode).toBe(429);
  });

  it("blocks first signup through browser access transport without a pairing or bootstrap token", async () => {
    context = await createTestServer({ internalTransportToken: "bridge-transport-token" });

    const response = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: {
        "x-braindrive-internal-transport-token": "bridge-transport-token",
        "x-braindrive-browser-access": "1",
        "x-braindrive-browser-client-ip": "192.168.1.50",
        "x-braindrive-browser-client-id": `tailnet:${"a".repeat(64)}`,
        "x-forwarded-proto": "https",
      },
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(parseJson<{ error: string }>(response.body).error).toBe("signup_local_only");
  });

  it("requires bootstrap token for first signup when configured", async () => {
    context = await createTestServer({ bootstrapToken: "test-bootstrap-token" });

    const response = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(parseJson<{ error: string }>(response.body).error).toBe("signup_bootstrap_token_required");
  });

  it("accepts first signup when matching bootstrap token header is provided", async () => {
    context = await createTestServer({ bootstrapToken: "test-bootstrap-token" });

    const response = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: {
        "x-paa-bootstrap-token": "test-bootstrap-token",
      },
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = parseJson<{ access_token: string; token_type: string }>(response.body);
    expect(body.token_type).toBe("Bearer");
    expect(body.access_token.length).toBeGreaterThan(0);
  });

  it("requires a configured bootstrap token even when allow-first-signup-any-ip is true", async () => {
    context = await createTestServer({
      bootstrapToken: "test-bootstrap-token",
      allowFirstSignupAnyIp: true,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(parseJson<{ error: string }>(response.body).error).toBe("signup_bootstrap_token_required");

    const acceptedResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: {
        "x-paa-bootstrap-token": "test-bootstrap-token",
      },
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });

    expect(acceptedResponse.statusCode).toBe(201);
  });

  it("rate-limits signup attempts", async () => {
    context = await createTestServer();
    const statusCodes: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await context.app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          identifier: "owner",
          password: "short",
        },
      });
      statusCodes.push(response.statusCode);
    }

    expect(statusCodes.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statusCodes[5]).toBe(429);
  });

  it("rejects unauthenticated support bundle requests", async () => {
    context = await createTestServer();

    const response = await context.app.inject({
      method: "POST",
      url: "/support/bundles",
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Unauthorized");
  });

  it("allows unauthenticated managed account proxy routes by default", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      deploymentMode: "managed",
      managedApiBase: "https://managed.example",
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ checkout_url: "https://checkout.stripe.com/c/pay_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/account/topup",
      payload: { amount_cents: 1000 },
    });

    expect(response.statusCode).toBe(200);
    expect(parseJson<{ checkout_url: string }>(response.body).checkout_url).toBe(
      "https://checkout.stripe.com/c/pay_123"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires authentication for managed account proxy routes when explicitly disabled", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      deploymentMode: "managed",
      managedApiBase: "https://managed.example",
      allowManagedPublicAccountProxyRoutes: false,
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ checkout_url: "https://checkout.stripe.com/c/pay_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/account/topup",
      payload: { amount_cents: 1000 },
    });

    expect(response.statusCode).toBe(401);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Unauthorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates, lists, and downloads support bundles for authenticated local JWT sessions", async () => {
    context = await createTestServer();

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);
    const tokenPayload = parseJson<{ access_token: string }>(signupResponse.body);

    const createResponse = await context.app.inject({
      method: "POST",
      url: "/support/bundles",
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
      },
      payload: {
        window_hours: 24,
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = parseJson<{
      scope: string;
      file_name: string;
      included_audit_files: number;
      download_path: string;
    }>(createResponse.body);
    expect(created.scope).toBe("memory-only");
    expect(created.file_name).toMatch(/^support-bundle-\d{13}\.tar\.gz$/);
    expect(created.download_path).toBe(`/support/bundles/${encodeURIComponent(created.file_name)}`);

    const listResponse = await context.app.inject({
      method: "GET",
      url: "/support/bundles",
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
      },
    });
    expect(listResponse.statusCode).toBe(200);
    const listed = parseJson<{
      scope: string;
      bundles: Array<{ file_name: string; size_bytes: number; updated_at: string }>;
    }>(listResponse.body);
    expect(listed.scope).toBe("memory-only");
    expect(listed.bundles.some((entry) => entry.file_name === created.file_name)).toBe(true);

    const downloadResponse = await context.app.inject({
      method: "GET",
      url: `/support/bundles/${created.file_name}`,
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
      },
    });
    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.headers["content-type"]).toContain("application/gzip");
    expect(downloadResponse.body.length).toBeGreaterThan(0);
  });

  it("denies support bundle endpoints in local-owner mode", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const response = await context.app.inject({
      method: "GET",
      url: "/support/bundles",
      headers: localOwnerAdminHeaders(),
    });

    expect(response.statusCode).toBe(403);
    expect(parseJson<{ error: string }>(response.body).error).toBe("support_bundle_requires_local_jwt_auth");
  });

  it("does not run legacy memory updates during startup", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      memoryAutoUpdateEnabled: "true",
      seedLegacyMemoryUpdateState: true,
    });
    const memoryRoot = path.join(context.tempRoot, "memory");

    await expect(readFile(path.join(memoryRoot, "AGENT.md"), "utf8")).resolves.toBe("# Custom Agent\n\nKeep this.\n");
    await expect(readFile(path.join(memoryRoot, "me", "todo.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(memoryRoot, "system", "updates", "memory-state.json"), "utf8")).resolves.toContain(
      "starter-pack-26.4.20"
    );
  });

  it("does not expose legacy memory update endpoints", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    for (const request of [
      { method: "GET", url: "/updates/memory/status" },
      { method: "POST", url: "/updates/memory/plan" },
      { method: "POST", url: "/updates/memory/apply" },
      { method: "GET", url: "/updates/memory/reports/starter-pack-26.4.20" },
    ] as const) {
      const response = await context.app.inject({
        ...request,
        headers: localOwnerAdminHeaders(),
        payload: request.method === "POST" ? {} : undefined,
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it("rejects unauthenticated memory backup settings updates", async () => {
    context = await createTestServer();

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings/memory-backup",
      payload: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
        git_token: "ghp_test",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Unauthorized");
  });

  it("reads and updates the root agent owner overlay", async () => {
    context = await createTestServer({ authMode: "local-owner" });
    const memoryRoot = path.join(context.tempRoot, "memory");
    await writeFile(path.join(memoryRoot, "AGENT.md"), "# BrainDrive Agent\n\nManaged default.\n", "utf8");

    const readResponse = await context.app.inject({
      method: "GET",
      url: "/agent",
      headers: localOwnerAdminHeaders(),
    });

    expect(readResponse.statusCode).toBe(200);
    expect(parseJson<{ managed_content: string; overlay_content: string | null }>(readResponse.body)).toEqual({
      managed_content: "# BrainDrive Agent\n\nManaged default.\n",
      overlay_content: null,
    });

    vi.mocked(readBootstrapPromptConfigMock).mockClear();
    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/agent",
      headers: localOwnerAdminHeaders(),
      payload: {
        overlay_content: "Use concise answers.\n",
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    await expect(readFile(path.join(memoryRoot, "AGENT-user.md"), "utf8")).resolves.toBe("Use concise answers.\n");
    expect(readBootstrapPromptConfigMock).not.toHaveBeenCalled();
  });

  it("uses the request-time bootstrap prompt for message model requests", async () => {
    vi.mocked(readBootstrapPromptConfigMock).mockResolvedValueOnce("Today's date is 2026-06-30.\n");
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: {
        base_url: "https://provider.example/v1",
        model: "test-model",
        api_key_env: "TEST_API_KEY",
        provider_id: "test-provider",
      },
    });

    vi.mocked(readBootstrapPromptConfigMock).mockReset();
    vi.mocked(readBootstrapPromptConfigMock).mockResolvedValue("Today's date is 2026-07-03.\n");

    type ProviderRequestBody = { messages?: Array<{ role: string; content?: string }> };
    let providerRequestBody: ProviderRequestBody | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        providerRequestBody = JSON.parse(String(init?.body)) as ProviderRequestBody;
        return new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Done."}}]}\n\n'));
              controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n'));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        );
      })
    );

    const response = await context.app.inject({
      method: "POST",
      url: "/message",
      headers: localOwnerAdminHeaders(),
      payload: {
        content: "What is today's date?",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(readBootstrapPromptConfigMock).toHaveBeenCalledWith(path.join(context.tempRoot, "memory"));
    expect(providerRequestBody).not.toBeNull();
    const capturedProviderRequestBody = providerRequestBody as unknown as ProviderRequestBody;
    expect(capturedProviderRequestBody.messages?.[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Today's date is 2026-07-03."),
    });
    expect(capturedProviderRequestBody.messages?.[0]?.content).not.toContain("2026-06-30");
  });

  it("requires onboarding when active provider credential is unset", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const response = await context.app.inject({
      method: "GET",
      url: "/settings/onboarding-status",
      headers: localOwnerAdminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = parseJson<{
      onboarding_required: boolean;
      providers: Array<{
        provider_id: string;
        credential_mode: "plain" | "secret_ref" | "unset";
        requires_secret: boolean;
        credential_resolved: boolean;
      }>;
    }>(response.body);
    expect(body.onboarding_required).toBe(true);
    expect(body.providers[0]).toMatchObject({
      provider_id: "openrouter",
      credential_mode: "unset",
      requires_secret: true,
      credential_resolved: false,
    });
  });

  it("activates OpenRouter without credentials while keeping onboarding unresolved", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: providerActivationAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      default_model: "braindrive-models-default",
      active_provider_profile: "braindrive-models",
      provider_activation_revision: 2,
    };

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
      payload: { active_provider_profile: "openrouter" },
    });

    expect(response.statusCode).toBe(200);
    expect(parseJson<{
      active_provider_profile: string | null;
      provider_activation_revision: number;
    }>(response.body)).toMatchObject({
      active_provider_profile: "openrouter",
      provider_activation_revision: 3,
    });
    expect(mockPreferences.active_provider_profile).toBe("openrouter");
    expect(mockPreferences.provider_activation_revision).toBe(3);
    expect(mockPreferences.provider_credentials).toBeUndefined();

    const onboardingResponse = await context.app.inject({
      method: "GET",
      url: "/settings/onboarding-status",
      headers: localOwnerAdminHeaders(),
    });
    expect(onboardingResponse.statusCode).toBe(200);
    expect(parseJson<{ onboarding_required: boolean }>(onboardingResponse.body).onboarding_required).toBe(true);
  });

  it("rejects unconfigured BrainDrive Models without changing provider intent", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: providerActivationAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      default_model: "",
      active_provider_profile: "ollama",
      provider_activation_revision: 2,
    };

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
      payload: { active_provider_profile: "braindrive-models" },
    });

    expect(response.statusCode).toBe(409);
    expect(parseJson<{ code: string; error: string }>(response.body)).toEqual({
      code: "provider_not_ready",
      error: "Configure this provider before activating it",
    });
    expect(mockPreferences.active_provider_profile).toBe("ollama");
    expect(mockPreferences.provider_activation_revision).toBe(2);
  });

  it("activates plain, vault-backed, environment-backed, and keyless providers with monotonic revisions", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: providerActivationAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      default_model: "braindrive-models-default",
      active_provider_profile: "braindrive-models",
      provider_activation_revision: 2,
      provider_credentials: {
        openrouter: {
          mode: "plain",
          required: false,
        },
      },
    };

    const activate = async (profile: string): Promise<number> => {
      const response = await context!.app.inject({
        method: "PUT",
        url: "/settings",
        headers: localOwnerAdminHeaders(),
        payload: { active_provider_profile: profile },
      });
      expect(response.statusCode).toBe(200);
      return parseJson<{ provider_activation_revision: number }>(response.body)
        .provider_activation_revision;
    };

    await expect(activate("openrouter")).resolves.toBe(3);

    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        openrouter: {
          mode: "secret_ref",
          secret_ref: "provider/openrouter/activation-test",
          required: true,
        },
      },
    };
    await writeVaultSecret("provider/openrouter/activation-test", "sk-openrouter-vault-test");
    await expect(activate("openrouter")).resolves.toBe(4);

    mockPreferences = {
      ...mockPreferences,
      provider_credentials: undefined,
    };
    process.env.OPENROUTER_ACTIVATION_TEST_KEY = "sk-openrouter-environment-test";
    try {
      await expect(activate("openrouter")).resolves.toBe(5);
    } finally {
      delete process.env.OPENROUTER_ACTIVATION_TEST_KEY;
    }

    await expect(activate("ollama")).resolves.toBe(6);
    expect(mockPreferences.active_provider_profile).toBe("ollama");

    const events = await readAuditEvents(context, "settings.provider_activation_completed");
    expect(events).toHaveLength(4);
    expect(events.map((event) => event.details.source)).toEqual([
      "explicit",
      "explicit",
      "explicit",
      "explicit",
    ]);
    expect(events.at(-1)?.details).toMatchObject({
      previous_profile: "openrouter",
      target_profile: "ollama",
      resulting_profile: "ollama",
      previous_revision: 5,
      resulting_revision: 6,
      decision: "activated",
    });
  });

  it("keeps unknown profiles rejected without advancing provider intent", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: providerActivationAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      active_provider_profile: "braindrive-models",
      provider_activation_revision: 4,
    };

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
      payload: { active_provider_profile: "unknown-provider" },
    });

    expect(response.statusCode).toBe(400);
    expect(mockPreferences.active_provider_profile).toBe("braindrive-models");
    expect(mockPreferences.provider_activation_revision).toBe(4);
  });

  it("returns a safe activation failure without falsely changing persisted state", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: providerActivationAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      active_provider_profile: "braindrive-models",
      provider_activation_revision: 9,
    };
    mockSavePreferencesError = new Error("sensitive persistence backend detail");

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
      payload: { active_provider_profile: "ollama" },
    });

    expect(response.statusCode).toBe(500);
    expect(parseJson<{ code: string; error: string }>(response.body)).toEqual({
      code: "provider_activation_failed",
      error: "Unable to activate provider",
    });
    expect(response.body).not.toContain("sensitive persistence backend detail");
    expect(mockPreferences.active_provider_profile).toBe("braindrive-models");
    expect(mockPreferences.provider_activation_revision).toBe(9);
  });

  it("applies credential updates immediately without requiring restart", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const saveCredentialResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/credentials",
      headers: localOwnerAdminHeaders(),
      payload: {
        provider_profile: "default",
        mode: "secret_ref",
        api_key: "sk-test-openrouter-key",
      },
    });

    expect(saveCredentialResponse.statusCode).toBe(200);
    const saveBody = parseJson<{
      settings: {
        active_provider_profile: string | null;
        provider_activation_revision: number;
        provider_profiles: Array<{ id: string; credential_mode: "plain" | "secret_ref" | "unset" }>;
      };
    }>(saveCredentialResponse.body);
    expect(saveBody.settings.active_provider_profile).toBe("default");
    expect(saveBody.settings.provider_activation_revision).toBe(1);
    expect(mockPreferences.provider_activation_revision).toBe(1);
    expect(saveBody.settings.provider_profiles.find((profile) => profile.id === "default")?.credential_mode).toBe(
      "secret_ref"
    );
    const activationEvents = await readAuditEvents(context, "settings.provider_activation_completed");
    expect(activationEvents.at(-1)?.details).toMatchObject({
      source: "credential_save",
      target_profile: "default",
      resulting_profile: "default",
      previous_revision: 0,
      resulting_revision: 1,
    });

    vi.mocked(loadPreferencesConfigMock).mockImplementationOnce(async () => {
      throw new Error("simulated transient read failure");
    });

    const settingsResponse = await context.app.inject({
      method: "GET",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
    });

    expect(settingsResponse.statusCode).toBe(200);
    const settingsBody = parseJson<{
      active_provider_profile: string | null;
      provider_profiles: Array<{ id: string; credential_mode: "plain" | "secret_ref" | "unset" }>;
    }>(settingsResponse.body);
    expect(settingsBody.active_provider_profile).toBe("default");
    expect(settingsBody.provider_profiles.find((profile) => profile.id === "default")?.credential_mode).toBe(
      "secret_ref"
    );
  });

  it("does not activate a credential-save provider when preference persistence fails", async () => {
    context = await createTestServer({ authMode: "local-owner" });
    mockPreferences = {
      ...mockPreferences,
      active_provider_profile: "braindrive-models",
      provider_activation_revision: 4,
    };
    mockSavePreferencesError = new Error("sensitive credential persistence detail");

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings/credentials",
      headers: localOwnerAdminHeaders(),
      payload: {
        provider_profile: "default",
        mode: "plain",
        set_active_provider: true,
      },
    });

    expect(response.statusCode).toBe(500);
    expect(parseJson<{ code: string; error: string }>(response.body)).toEqual({
      code: "provider_activation_failed",
      error: "Unable to activate provider",
    });
    expect(response.body).not.toContain("sensitive credential persistence detail");
    expect(mockPreferences.active_provider_profile).toBe("braindrive-models");
    expect(mockPreferences.provider_activation_revision).toBe(4);

    const events = await readAuditEvents(context, "settings.provider_activation_rejected");
    expect(events.at(-1)?.details).toMatchObject({
      source: "credential_save",
      target_profile: "default",
      current_profile: "braindrive-models",
      current_revision: 4,
      decision: "rejected",
      error_code: "provider_activation_failed",
    });
  });

  it("normalizes local Ollama server URLs to the OpenAI-compatible base URL", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: {
        base_url: "https://my.braindrive.ai/credits/v1",
        model: "braindrive-models-default",
        api_key_env: "AI_GATEWAY_API_KEY",
        provider_id: "braindrive-models",
        default_provider_profile: "braindrive-models",
        provider_profiles: {
          "braindrive-models": {
            base_url: "https://my.braindrive.ai/credits/v1",
            model: "braindrive-models-default",
            api_key_env: "AI_GATEWAY_API_KEY",
            provider_id: "braindrive-models",
          },
          ollama: {
            base_url: "http://host.docker.internal:11434/v1",
            model: "",
            api_key_env: "OLLAMA_API_KEY",
            provider_id: "ollama",
          },
        },
      },
    });

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
      payload: {
        active_provider_profile: "ollama",
        provider_base_url: {
          provider_profile: "ollama",
          base_url: "http://localhost:11434",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockPreferences.provider_base_urls?.ollama).toBe("http://localhost:11434/v1");
  });

  it.each(["davidwaring@local.paa", "owner@local.braindrive"])(
    "rejects synthetic checkout email %s before upstream checkout",
    async (email) => {
      context = await createTestServer({
        authMode: "local-owner",
        adapterConfig: brainDriveModelsAdapterConfig(),
      });
      const fetchMock = vi.fn(async (url: string | URL) => {
        const requestUrl = String(url);
        if (requestUrl.endsWith("/credits/key/provision")) {
          return new Response(
            JSON.stringify({
              api_key: "sk-should-not-provision",
              key_id: "token-should-not-provision",
              key_hash: "hash-should-not-provision",
              status: "active",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (requestUrl.endsWith("/credits/checkout")) {
          return new Response(JSON.stringify({ checkout_url: "https://checkout.stripe.com/c/pay_synthetic" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const response = await context.app.inject({
        method: "POST",
        url: "/credits/checkout",
        headers: localOwnerAdminHeaders(),
        payload: { amount: 5, email },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("provisions a BrainDrive Models key only when checkout starts and stores it in the vault", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/key/provision")) {
        return new Response(
          JSON.stringify({
            api_key: "sk-auto-provisioned-key",
            key_id: "token-auto",
            key_hash: "hash-auto",
            status: "active",
            expires_unfunded_at: "2026-07-07T12:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/checkout")) {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer sk-auto-provisioned-key",
        });
        expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
          amount: 5,
          email: "owner@example.com",
        });
        expect(String(init?.body ?? "")).not.toContain("sk-auto-provisioned-key");
        return new Response(JSON.stringify({ checkout_url: "https://checkout.stripe.com/c/pay_auto" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/checkout",
      headers: localOwnerAdminHeaders(),
      payload: { amount: 5, email: "owner@example.com" },
    });

    expect(response.statusCode).toBe(200);
    expect(parseJson<{ checkout_url: string }>(response.body).checkout_url).toBe(
      "https://checkout.stripe.com/c/pay_auto"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(readVaultSecret("provider/ai-gateway/api_key")).resolves.toBe("sk-auto-provisioned-key");
    expect(JSON.stringify(mockPreferences)).not.toContain("sk-auto-provisioned-key");
    expect(mockPreferences.provider_credentials?.["braindrive-models"]).toMatchObject({
      mode: "secret_ref",
      secret_ref: "provider/ai-gateway/api_key",
    });
    expect(mockPreferences.braindrive_models_key).toMatchObject({
      key_id: "token-auto",
      key_hash: "hash-auto",
      masked_key: "sk-...-key",
      status: "provisioned",
      checkout_pending: true,
    });
  });

  it("preserves a valid existing BrainDrive Models vault key during checkout", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-existing-paid-key");

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/status")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-existing-paid-key" });
        return new Response(JSON.stringify({ remaining_usd: 8, key_valid: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (requestUrl.endsWith("/credits/checkout")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-existing-paid-key" });
        return new Response(JSON.stringify({ checkout_url: "https://checkout.stripe.com/c/pay_existing" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (requestUrl.endsWith("/credits/key/provision")) {
        throw new Error("provision must not be called");
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/checkout",
      headers: localOwnerAdminHeaders(),
      payload: { amount: 10, email: "owner@example.com" },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(readVaultSecret("provider/ai-gateway/api_key")).resolves.toBe("sk-existing-paid-key");
  });

  it("returns only the browser-safe checkout contract even if the host adds success-poll fields", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-existing-safe-checkout");

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/status")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-existing-safe-checkout" });
        return new Response(JSON.stringify({ remaining_usd: 0, key_valid: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (requestUrl.endsWith("/credits/checkout")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-existing-safe-checkout" });
        expect(String(init?.body ?? "")).not.toContain("sk-existing-safe-checkout");
        return new Response(
          JSON.stringify({
            checkout_url: "https://checkout.stripe.com/c/pay_safe",
            purchase_status: "ready",
            checkout_pending: false,
            state: "completed_auto_bound",
            mode: "auto_bound",
            message_code: "completed_auto_bound",
            key: "sk-host-must-not-reach-browser",
            api_key: "sk-api-key-must-not-reach-browser",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/checkout",
      headers: localOwnerAdminHeaders(),
      payload: { amount: 5, email: "owner@example.com" },
    });

    expect(response.statusCode).toBe(200);
    expect(parseJson(response.body)).toEqual({
      checkout_url: "https://checkout.stripe.com/c/pay_safe",
      purchase_status: "activating",
    });
    expect(response.body).not.toContain("sk-host-must-not-reach-browser");
    expect(response.body).not.toContain("completed_auto_bound");
  });

  it("preserves an existing zero-balance BrainDrive Models vault key during checkout", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-existing-zero-balance");

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/status")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-existing-zero-balance" });
        return new Response(JSON.stringify({ remaining_usd: 0, total_purchased_usd: 0, key_valid: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (requestUrl.endsWith("/credits/checkout")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-existing-zero-balance" });
        return new Response(JSON.stringify({ checkout_url: "https://checkout.stripe.com/c/pay_zero" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (requestUrl.endsWith("/credits/key/provision")) {
        throw new Error("provision must not be called for zero-balance key");
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/checkout",
      headers: localOwnerAdminHeaders(),
      payload: { amount: 5, email: "owner@example.com" },
    });

    expect(response.statusCode).toBe(200);
    await expect(readVaultSecret("provider/ai-gateway/api_key")).resolves.toBe("sk-existing-zero-balance");
  });

  it("does not silently overwrite an invalid existing BrainDrive Models key", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-invalid-existing-key");

    const fetchMock = vi.fn(async (url: string | URL) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/status")) {
        return new Response(JSON.stringify({ key_valid: false }), { status: 401 });
      }
      if (requestUrl.endsWith("/credits/key/provision")) {
        throw new Error("provision must not be called over an invalid existing key");
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/checkout",
      headers: localOwnerAdminHeaders(),
      payload: { amount: 5, email: "owner@example.com" },
    });

    expect(response.statusCode).toBe(409);
    expect(parseJson<{ code: string }>(response.body).code).toBe("braindrive_models_key_repair_required");
    await expect(readVaultSecret("provider/ai-gateway/api_key")).resolves.toBe("sk-invalid-existing-key");
  });

  it("does not silently provision over a missing vault key when prior BrainDrive Models metadata exists", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-existing",
        masked_key: "sk-...-old",
        status: "provisioned",
        checkout_pending: false,
      },
    };

    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/credits/key/provision")) {
        throw new Error("provision must not be called when metadata says a key existed");
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/checkout",
      headers: localOwnerAdminHeaders(),
      payload: { amount: 5, email: "owner@example.com" },
    });

    expect(response.statusCode).toBe(409);
    expect(parseJson<{ code: string }>(response.body).code).toBe("braindrive_models_key_repair_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps signup and non-BrainDrive provider settings independent when provisioning fails", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    const fetchMock = vi.fn(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const ollamaResponse = await context.app.inject({
      method: "PUT",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
      payload: {
        active_provider_profile: "ollama",
        provider_base_url: {
          provider_profile: "ollama",
          base_url: "http://localhost:11434",
        },
      },
    });
    expect(ollamaResponse.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();

    const checkoutResponse = await context.app.inject({
      method: "POST",
      url: "/credits/checkout",
      headers: localOwnerAdminHeaders(),
      payload: { amount: 5, email: "owner@example.com" },
    });
    expect(checkoutResponse.statusCode).toBe(502);
  });

  it.each(["ollama", "openrouter"] as const)(
    "uses only the dedicated BrainDrive Models key for credits status while %s is active",
    async (activeProvider) => {
      context = await createTestServer({
        authMode: "local-owner",
        adapterConfig: brainDriveModelsAdapterConfig(),
      });
      mockPreferences = {
        ...mockPreferences,
        active_provider_profile: activeProvider,
        provider_credentials: {
          "braindrive-models": {
            mode: "secret_ref",
            secret_ref: "provider/ai-gateway/api_key",
            required: true,
          },
          openrouter: {
            mode: "secret_ref",
            secret_ref: "provider/openrouter/byok",
            required: true,
          },
        },
        braindrive_models_key: {
          install_public_id: "install-status-dedicated",
          masked_key: "sk-...ated",
          status: "ready",
          checkout_pending: false,
        },
      };
      await writeVaultSecret("provider/ai-gateway/api_key", "sk-dedicated-status-key");
      await writeVaultSecret("provider/openrouter/byok", "sk-openrouter-status-key");
      vi.mocked(resolveProviderCredentialForStartup).mockClear();
      vi.mocked(resolveProviderCredentialForStartup).mockResolvedValue({
        providerId: activeProvider,
        secretRef: "provider/openrouter/byok",
        source: "vault",
        apiKey: "sk-openrouter-status-key",
      });

      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://my.braindrive.ai/credits/status");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-dedicated-status-key" });
        expect(JSON.stringify(init)).not.toContain("sk-openrouter-status-key");
        return new Response(
          JSON.stringify({ remaining_usd: 12, total_purchased_usd: 20, total_spent_usd: 8 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const response = await context.app.inject({
        method: "GET",
        url: "/credits/status",
        headers: localOwnerAdminHeaders(),
      });

      expect(response.statusCode).toBe(200);
      expect(parseJson(response.body)).toMatchObject({
        remaining_usd: 12,
        key_valid: true,
        purchase_status: "ready",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(resolveProviderCredentialForStartup).not.toHaveBeenCalled();
    }
  );

  it("maps host checkout_pending status to activating without clearing local pending", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-host-pending",
        masked_key: "sk-...ding",
        status: "checkout_pending",
        checkout_pending: true,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-host-pending-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            remaining_usd: 0,
            total_purchased_usd: 0,
            total_spent_usd: 0,
            checkout_pending: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const response = await context.app.inject({
      method: "GET",
      url: "/credits/status",
      headers: localOwnerAdminHeaders(),
    });

    expect(parseJson(response.body)).toMatchObject({ purchase_status: "activating" });
    expect(mockPreferences.braindrive_models_key).toMatchObject({
      status: "checkout_pending",
      checkout_pending: true,
      last_error: null,
    });
  });

  it("clears pending and returns ready only when the exact host status is funded", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-funded",
        masked_key: "sk-...nded",
        status: "checkout_pending",
        checkout_pending: true,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-funded-status-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ remaining_usd: 6, total_purchased_usd: 10, total_spent_usd: 4 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const response = await context.app.inject({
      method: "GET",
      url: "/credits/status",
      headers: localOwnerAdminHeaders(),
    });

    expect(parseJson(response.body)).toMatchObject({ remaining_usd: 6, purchase_status: "ready" });
    expect(mockPreferences.braindrive_models_key).toMatchObject({
      status: "ready",
      checkout_pending: false,
      last_error: null,
    });
  });

  it("clears pending and returns zero balance when host status is settled at zero", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-zero-settled",
        masked_key: "sk-...zero",
        status: "checkout_pending",
        checkout_pending: true,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-zero-settled-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            remaining_usd: 0,
            total_purchased_usd: 0,
            total_spent_usd: 0,
            checkout_pending: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const response = await context.app.inject({
      method: "GET",
      url: "/credits/status",
      headers: localOwnerAdminHeaders(),
    });

    expect(parseJson(response.body)).toMatchObject({ purchase_status: "zero_balance" });
    expect(mockPreferences.braindrive_models_key).toMatchObject({
      status: "zero_balance",
      checkout_pending: false,
      last_error: null,
    });
  });

  it("does not clear pending solely because historical purchases are nonzero", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-history-pending",
        masked_key: "sk-...tory",
        status: "checkout_pending",
        checkout_pending: true,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-history-pending-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ remaining_usd: 0, total_purchased_usd: 50, total_spent_usd: 50 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const response = await context.app.inject({
      method: "GET",
      url: "/credits/status",
      headers: localOwnerAdminHeaders(),
    });

    expect(parseJson(response.body)).toMatchObject({ purchase_status: "activating" });
    expect(mockPreferences.braindrive_models_key).toMatchObject({
      status: "checkout_pending",
      checkout_pending: true,
    });
  });

  it("maps a missing dedicated secret with prior state to repair required", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-missing-secret",
        masked_key: "sk-...sing",
        status: "ready",
        checkout_pending: false,
      },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "GET",
      url: "/credits/status",
      headers: localOwnerAdminHeaders(),
    });

    expect(parseJson(response.body)).toMatchObject({
      key_valid: false,
      purchase_status: "repair_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPreferences.braindrive_models_key).toMatchObject({
      status: "repair_required",
      checkout_pending: false,
      last_error: "missing_existing_key",
    });
  });

  it("maps a missing dedicated secret without prior setup to zero balance without provisioning", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "GET",
      url: "/credits/status",
      headers: localOwnerAdminHeaders(),
    });

    expect(parseJson(response.body)).toEqual({
      remaining_usd: 0,
      total_purchased_usd: 0,
      total_spent_usd: 0,
      purchase_status: "zero_balance",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPreferences.braindrive_models_key).toBeUndefined();
  });

  it("maps a missing dedicated secret with only a provider credential reference to zero balance without repair", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "GET",
      url: "/credits/status",
      headers: localOwnerAdminHeaders(),
    });

    expect(parseJson(response.body)).toEqual({
      remaining_usd: 0,
      total_purchased_usd: 0,
      total_spent_usd: 0,
      purchase_status: "zero_balance",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPreferences.braindrive_models_key).toBeUndefined();
    expect(mockPreferences.provider_credentials?.["braindrive-models"]).toMatchObject({
      mode: "secret_ref",
      secret_ref: "provider/ai-gateway/api_key",
    });
  });

  it("maps host rejection of the dedicated key to repair required", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-rejected",
        masked_key: "sk-...cted",
        status: "ready",
        checkout_pending: false,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-rejected-status-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ key_valid: false }), { status: 403 })));

    const response = await context.app.inject({
      method: "GET",
      url: "/credits/status",
      headers: localOwnerAdminHeaders(),
    });

    expect(parseJson(response.body)).toMatchObject({
      key_valid: false,
      purchase_status: "repair_required",
    });
    expect(mockPreferences.braindrive_models_key).toMatchObject({
      status: "repair_required",
      checkout_pending: false,
      last_error: "invalid_existing_key",
    });
  });

  it.each(["timeout", "5xx", "malformed"] as const)(
    "maps %s host status failure to unavailable while preserving pending metadata",
    async (failureMode) => {
      context = await createTestServer({
        authMode: "local-owner",
        adapterConfig: brainDriveModelsAdapterConfig(),
      });
      mockPreferences = {
        ...mockPreferences,
        provider_credentials: {
          "braindrive-models": {
            mode: "secret_ref",
            secret_ref: "provider/ai-gateway/api_key",
            required: true,
          },
        },
        braindrive_models_key: {
          install_public_id: `install-${failureMode}`,
          masked_key: "sk-...able",
          status: "checkout_pending",
          checkout_pending: true,
          last_error: null,
        },
      };
      await writeVaultSecret("provider/ai-gateway/api_key", `sk-${failureMode}-status-key`);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (failureMode === "timeout") {
            throw new DOMException("status timeout detail", "AbortError");
          }
          if (failureMode === "5xx") {
            return new Response("host unavailable detail", { status: 503 });
          }
          return new Response(JSON.stringify({ total_purchased_usd: 10, total_spent_usd: 0 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        })
      );

      const response = await context.app.inject({
        method: "GET",
        url: "/credits/status",
        headers: localOwnerAdminHeaders(),
      });

      expect(parseJson(response.body)).toEqual({
        remaining_usd: 0,
        total_purchased_usd: 0,
        total_spent_usd: 0,
        purchase_status: "unavailable",
      });
      expect(response.body).not.toContain("status timeout detail");
      expect(response.body).not.toContain("host unavailable detail");
      expect(mockPreferences.braindrive_models_key).toMatchObject({
        status: "checkout_pending",
        checkout_pending: true,
        last_error: null,
      });
    }
  );

  it("remains compatible with older host status responses without checkout_pending", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-legacy-host",
        masked_key: "sk-...gacy",
        status: "ready",
        checkout_pending: false,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-legacy-host-status-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ remaining_usd: 3, total_purchased_usd: 10, total_spent_usd: 7 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const response = await context.app.inject({
      method: "GET",
      url: "/credits/status",
      headers: localOwnerAdminHeaders(),
    });

    expect(parseJson(response.body)).toMatchObject({
      remaining_usd: 3,
      key_valid: true,
      purchase_status: "ready",
    });
  });

  it("treats absent and managed hosted entitlement capability as disabled", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const localResponse = await context.app.inject({
      method: "GET",
      url: "/credits/entitlements/capability",
      headers: localOwnerAdminHeaders(),
    });
    expect(localResponse.statusCode).toBe(200);
    expect(parseJson(localResponse.body)).toEqual({ available: false, version: null });

    await destroyTestServer(context);
    context = await createTestServer({
      authMode: "local-owner",
      deploymentMode: "managed",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    fetchMock.mockClear();
    const managedResponse = await context.app.inject({
      method: "GET",
      url: "/credits/entitlements/capability",
      headers: localOwnerAdminHeaders(),
    });
    expect(parseJson(managedResponse.body)).toEqual({ available: false, version: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("vaults and records a claim key before using it as the hosted bearer, then returns only safe exact results", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    const rawKey = "sk-entitlement-vault-first";
    let providerMessageUrl: string | null = null;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/key/provision")) {
        return new Response(
          JSON.stringify({ api_key: rawKey, key_id: "claim-key", key_hash: "claim-hash" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/entitlements/claim")) {
        await expect(readVaultSecret("provider/ai-gateway/api_key")).resolves.toBe(rawKey);
        expect(mockPreferences.braindrive_models_key).toMatchObject({
          install_public_id: expect.any(String),
          checkout_pending: false,
        });
        expect(init?.headers).toMatchObject({ Authorization: `Bearer ${rawKey}` });
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "recipient@example.com",
          install_public_id: mockPreferences.braindrive_models_key?.install_public_id,
        });
        return new Response(
          JSON.stringify({ operation_id: "operation-1", status: "completed", applied_cents: 2500 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/status")) {
        expect(init?.headers).toMatchObject({ Authorization: `Bearer ${rawKey}` });
        return new Response(
          JSON.stringify({ remaining_usd: 25, total_purchased_usd: 25, total_spent_usd: 0 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/chat/completions")) {
        providerMessageUrl = requestUrl;
        expect(init?.headers).toMatchObject({ authorization: `Bearer ${rawKey}` });
        return streamingProviderResponse();
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/entitlements/claim",
      headers: localOwnerAdminHeaders(),
      payload: { email: "recipient@example.com" },
    });

    expect(response.statusCode).toBe(200);
    const body = parseJson<{
      state: string;
      operation_id: string;
      applied_cents: number;
      balance: Record<string, unknown>;
      settings: {
        active_provider_profile: string | null;
        provider_activation_revision: number;
      };
    }>(response.body);
    expect(body).toMatchObject({
      state: "completed",
      operation_id: "operation-1",
      applied_cents: 2500,
      balance: {
        remaining_usd: 25,
        total_purchased_usd: 25,
        total_spent_usd: 0,
        key_valid: true,
        purchase_status: "ready",
      },
      settings: {
        active_provider_profile: "braindrive-models",
        provider_activation_revision: 1,
      },
    });
    expect(response.body).not.toContain(rawKey);
    expect(response.body.toLowerCase()).not.toContain("authorization");
    expect(JSON.stringify(mockPreferences)).not.toContain(rawKey);
    expect(JSON.stringify(mockPreferences)).not.toContain("recipient@example.com");
    expect(mockPreferences.braindrive_models_entitlement).toMatchObject({
      operation_id: "operation-1",
      status: "completed",
      applied_cents: 2500,
      provider_activation_revision_at_start: 0,
    });
    expect(mockPreferences.active_provider_profile).toBe("braindrive-models");
    expect(mockPreferences.provider_activation_revision).toBe(1);

    vi.mocked(resolveProviderCredentialForStartup).mockResolvedValue({
      providerId: "braindrive-models",
      secretRef: "provider/ai-gateway/api_key",
      source: "vault",
      apiKey: rawKey,
    });
    const messageResponse = await context.app.inject({
      method: "POST",
      url: "/message",
      headers: localOwnerAdminHeaders(),
      payload: { content: "Use the claimed provider" },
    });
    expect(messageResponse.statusCode).toBe(200);
    expect(providerMessageUrl).toBe("https://my.braindrive.ai/credits/v1/chat/completions");

    const activationEvents = await readAuditEvents(context, "credits.entitlement_provider_activation");
    expect(activationEvents.at(-1)?.details).toMatchObject({
      source: "email_credit_claim",
      operation_id: "operation-1",
      claim_state: "completed",
      previous_profile: null,
      target_profile: "braindrive-models",
      resulting_profile: "braindrive-models",
      captured_revision: 0,
      current_revision: 0,
      resulting_revision: 1,
      decision: "activated",
      error_code: null,
    });
    const serializedEvent = JSON.stringify(activationEvents.at(-1));
    expect(serializedEvent).not.toContain(rawKey);
    expect(serializedEvent).not.toContain("recipient@example.com");
    expect(serializedEvent.toLowerCase()).not.toContain("authorization");
  });

  it("refreshes only the persisted pending operation and a duplicate submit does not create another claim", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-persisted",
        masked_key: "sk-...sted",
        status: "ready",
        checkout_pending: false,
      },
      braindrive_models_entitlement: {
        operation_id: "operation-persisted",
        status: "pending",
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-operation-persisted");
    let statusCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/status")) {
        statusCalls += 1;
        return new Response(
          JSON.stringify({
            remaining_usd: statusCalls === 1 ? 0 : 10,
            total_purchased_usd: statusCalls === 1 ? 0 : 10,
            total_spent_usd: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/entitlements/operations/operation-persisted")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-operation-persisted" });
        return new Response(
          JSON.stringify({ operation_id: "operation-persisted", status: "pending" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/entitlements/claim")) {
        throw new Error("a persisted operation must never create a second claim");
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const refreshResponse = await context.app.inject({
      method: "GET",
      url: "/credits/entitlements/status?operation_id=operation-attacker",
      headers: localOwnerAdminHeaders(),
    });
    expect(refreshResponse.statusCode).toBe(202);
    expect(parseJson<{ operation_id: string }>(refreshResponse.body).operation_id).toBe("operation-persisted");

    const duplicateResponse = await context.app.inject({
      method: "POST",
      url: "/credits/entitlements/claim",
      headers: localOwnerAdminHeaders(),
      payload: { email: "other@example.com" },
    });
    expect(duplicateResponse.statusCode).toBe(202);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/credits/entitlements/claim"))).toBe(false);
  });

  it("starts a new explicit claim after a completed operation and repairs a missing provider mapping", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      active_provider_profile: "braindrive-models",
      provider_activation_revision: 2,
      provider_credentials: undefined,
      braindrive_models_key: {
        install_public_id: "install-retest",
        masked_key: "sk-...test",
        status: "ready",
        checkout_pending: false,
      },
      braindrive_models_entitlement: {
        operation_id: "operation-first",
        status: "completed",
        applied_cents: 100,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-existing-retest-key");
    let statusCalls = 0;
    let claimCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/status")) {
        statusCalls += 1;
        return new Response(
          JSON.stringify({
            remaining_usd: statusCalls === 1 ? 1 : 2,
            total_purchased_usd: statusCalls === 1 ? 1 : 2,
            total_spent_usd: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/entitlements/claim")) {
        claimCalls += 1;
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer sk-existing-retest-key",
        });
        return new Response(
          JSON.stringify({
            operation_id: "operation-retest",
            status: "completed",
            applied_cents: 100,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.includes("/credits/entitlements/operations/")) {
        throw new Error("a completed operation must not block an explicit retest");
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/entitlements/claim",
      headers: localOwnerAdminHeaders(),
      payload: { email: "recipient@example.com" },
    });

    expect(response.statusCode).toBe(200);
    expect(claimCalls).toBe(1);
    expect(parseJson(response.body)).toMatchObject({
      operation_id: "operation-retest",
      settings: {
        active_provider_profile: "braindrive-models",
        provider_activation_revision: 3,
      },
    });
    expect(mockPreferences.provider_credentials?.["braindrive-models"]).toEqual({
      mode: "secret_ref",
      secret_ref: "provider/ai-gateway/api_key",
      required: true,
    });
    expect(mockPreferences.braindrive_models_entitlement).toMatchObject({
      operation_id: "operation-retest",
      status: "completed",
      applied_cents: 100,
      provider_activation_revision_at_start: 2,
    });
    expect(mockPreferences.provider_activation_revision).toBe(3);
    const events = await readAuditEvents(context, "credits.entitlement_provider_activation");
    expect(events.at(-1)?.details).toMatchObject({
      operation_id: "operation-retest",
      captured_revision: 2,
      current_revision: 2,
      resulting_revision: 3,
      decision: "retained",
    });
  });

  it("returns durable partial success when completion is proven but balance refresh fails", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-partial",
        masked_key: "sk-...tial",
        status: "ready",
        checkout_pending: false,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-partial-success");
    let statusCalls = 0;
    let claimCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/status")) {
        statusCalls += 1;
        return statusCalls === 1
          ? new Response(JSON.stringify({ remaining_usd: 0, total_purchased_usd: 0 }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : new Response("balance backend detail", { status: 503 });
      }
      if (requestUrl.endsWith("/credits/entitlements/claim")) {
        claimCalls += 1;
        return new Response(
          JSON.stringify({ operation_id: "operation-partial", status: "completed", applied_cents: 750 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/entitlements/operations/operation-partial")) {
        return new Response(
          JSON.stringify({ operation_id: "operation-partial", status: "completed", applied_cents: 750 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/entitlements/claim",
      headers: localOwnerAdminHeaders(),
      payload: { email: "recipient@example.com" },
    });
    expect(response.statusCode).toBe(200);
    expect(parseJson(response.body)).toMatchObject({
      state: "partial_success",
      operation_id: "operation-partial",
      applied_cents: 750,
      error_code: "balance_refresh_unavailable",
      settings: {
        active_provider_profile: "braindrive-models",
        provider_activation_revision: 1,
      },
    });
    expect(response.body).not.toContain("balance backend detail");
    expect(mockPreferences.braindrive_models_entitlement).toMatchObject({
      operation_id: "operation-partial",
      status: "partial_success",
      applied_cents: 750,
      provider_activation_revision_at_start: 0,
    });
    expect(mockPreferences.provider_activation_revision).toBe(1);

    await context.app.inject({
      method: "POST",
      url: "/credits/entitlements/claim",
      headers: localOwnerAdminHeaders(),
      payload: { email: "different@example.com" },
    });
    expect(claimCalls).toBe(1);
    expect(mockPreferences.provider_activation_revision).toBe(1);
  });

  it("returns safe recovery evidence when claim-side provider activation persistence fails", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: providerActivationAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      active_provider_profile: "openrouter",
      provider_activation_revision: 2,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-activation-failure",
        masked_key: "sk-...lure",
        status: "ready",
        checkout_pending: false,
      },
    };
    const rawKey = "sk-claim-activation-failure";
    await writeVaultSecret("provider/ai-gateway/api_key", rawKey);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const requestUrl = String(url);
        if (requestUrl.endsWith("/credits/entitlements/claim")) {
          return new Response(
            JSON.stringify({
              operation_id: "operation-activation-failure",
              status: "completed",
              applied_cents: 500,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (requestUrl.endsWith("/credits/status")) {
          return new Response(
            JSON.stringify({
              remaining_usd: 5,
              total_purchased_usd: 5,
              total_spent_usd: 0,
              key_valid: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("not found", { status: 404 });
      })
    );
    mockSavePreferencesError = new Error("sensitive claim persistence detail");
    mockSavePreferencesErrorWhen = (nextPreferences) =>
      nextPreferences.active_provider_profile === "braindrive-models" &&
      nextPreferences.provider_activation_revision === 3;

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/entitlements/claim",
      headers: localOwnerAdminHeaders(),
      payload: { email: "activation-failure@example.com" },
    });

    expect(response.statusCode).toBe(500);
    expect(parseJson<{ code: string; error: string }>(response.body)).toEqual({
      code: "provider_activation_failed",
      error: "Unable to activate BrainDrive Models",
    });
    expect(response.body).not.toContain("sensitive claim persistence detail");
    expect(response.body).not.toContain(rawKey);
    expect(mockPreferences.active_provider_profile).toBe("openrouter");
    expect(mockPreferences.provider_activation_revision).toBe(2);
    expect(mockPreferences.braindrive_models_entitlement).toMatchObject({
      operation_id: "operation-activation-failure",
      status: "completed",
      applied_cents: 500,
      provider_activation_revision_at_start: 2,
    });

    const events = await readAuditEvents(
      context,
      "credits.entitlement_provider_activation"
    );
    expect(events.at(-1)?.details).toMatchObject({
      source: "email_credit_claim",
      operation_id: "operation-activation-failure",
      claim_state: "completed",
      previous_profile: "openrouter",
      target_profile: "braindrive-models",
      resulting_profile: "openrouter",
      captured_revision: 2,
      current_revision: 2,
      resulting_revision: 2,
      decision: "failed",
      error_code: "provider_activation_failed",
    });
    const serializedEvent = JSON.stringify(events.at(-1));
    expect(serializedEvent).not.toContain(rawKey);
    expect(serializedEvent).not.toContain("activation-failure@example.com");
    expect(serializedEvent.toLowerCase()).not.toContain("authorization");
  });

  it.each([
    [422, 400, "invalid_email"],
    [404, 404, "no_available_credit"],
    [429, 429, "throttled"],
    [503, 503, "campaign_unavailable"],
  ])("maps hosted claim status %i to safe local category %s", async (hostedStatus, localStatus, code) => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: brainDriveModelsAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      active_provider_profile: "ollama",
      provider_activation_revision: 5,
    };
    const fetchMock = vi.fn(async (url: string | URL) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/key/provision")) {
        return new Response(JSON.stringify({ api_key: "sk-safe-error-mapping" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (requestUrl.endsWith("/credits/entitlements/claim")) {
        return new Response("internal upstream detail must not escape", { status: hostedStatus });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await context.app.inject({
      method: "POST",
      url: "/credits/entitlements/claim",
      headers: localOwnerAdminHeaders(),
      payload: { email: "recipient@example.com" },
    });
    expect(response.statusCode).toBe(localStatus);
    expect(parseJson<{ code: string }>(response.body).code).toBe(code);
    expect(response.body).not.toContain("internal upstream detail");
    expect(mockPreferences.active_provider_profile).toBe("ollama");
    expect(mockPreferences.provider_activation_revision).toBe(5);
  });

  it("preserves a later explicit provider when a deferred claim completes and routes the next message to it", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: providerActivationAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      default_model: "z-ai/glm-5.2",
      active_provider_profile: "openrouter",
      provider_activation_revision: 3,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-concurrent",
        masked_key: "sk-...rent",
        status: "ready",
        checkout_pending: false,
      },
    };
    const rawKey = "sk-concurrent-claim-key";
    await writeVaultSecret("provider/ai-gateway/api_key", rawKey);
    const claimStarted = createDeferred<void>();
    const claimResult = createDeferred<Response>();
    let providerMessageUrl: string | null = null;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/status")) {
        return new Response(
          JSON.stringify({ remaining_usd: 25, total_purchased_usd: 25, total_spent_usd: 0 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/entitlements/claim")) {
        claimStarted.resolve(undefined);
        return claimResult.promise;
      }
      if (requestUrl.endsWith("/chat/completions")) {
        providerMessageUrl = requestUrl;
        return streamingProviderResponse("Ollama response");
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const claimRequest = context.app.inject({
      method: "POST",
      url: "/credits/entitlements/claim",
      headers: localOwnerAdminHeaders(),
      payload: { email: "concurrent@example.com" },
    });
    await claimStarted.promise;

    const activationResponse = await context.app.inject({
      method: "PUT",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
      payload: { active_provider_profile: "ollama" },
    });
    expect(activationResponse.statusCode).toBe(200);
    expect(parseJson<{ provider_activation_revision: number }>(activationResponse.body).provider_activation_revision)
      .toBe(4);

    claimResult.resolve(
      new Response(
        JSON.stringify({ operation_id: "operation-concurrent", status: "completed", applied_cents: 500 }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const claimResponse = await claimRequest;
    expect(claimResponse.statusCode).toBe(200);
    expect(parseJson(claimResponse.body)).toMatchObject({
      state: "completed",
      settings: {
        active_provider_profile: "ollama",
        provider_activation_revision: 4,
      },
    });
    expect(mockPreferences.braindrive_models_entitlement).toMatchObject({
      operation_id: "operation-concurrent",
      provider_activation_revision_at_start: 3,
    });
    expect(mockPreferences.active_provider_profile).toBe("ollama");
    expect(mockPreferences.provider_activation_revision).toBe(4);

    const messageResponse = await context.app.inject({
      method: "POST",
      url: "/message",
      headers: localOwnerAdminHeaders(),
      payload: { content: "Use my newer provider" },
    });
    expect(messageResponse.statusCode).toBe(200);
    expect(providerMessageUrl).toBe("http://host.docker.internal:11434/v1/chat/completions");

    const events = await readAuditEvents(context, "credits.entitlement_provider_activation");
    expect(events.at(-1)?.details).toMatchObject({
      operation_id: "operation-concurrent",
      captured_revision: 3,
      current_revision: 4,
      resulting_revision: 4,
      previous_profile: "ollama",
      resulting_profile: "ollama",
      decision: "preserved_newer_intent",
    });
  });

  it("resumes a pending operation after server reconstruction with its original captured revision", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: providerActivationAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      active_provider_profile: "openrouter",
      provider_activation_revision: 6,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-restart",
        masked_key: "sk-...tart",
        status: "ready",
        checkout_pending: false,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-restart-claim-key");
    let operationStatus: "pending" | "completed" = "pending";
    let operationStatusCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/credits/status")) {
        return new Response(
          JSON.stringify({ remaining_usd: 10, total_purchased_usd: 10, total_spent_usd: 0 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/entitlements/claim")) {
        return new Response(
          JSON.stringify({ operation_id: "operation-restart", status: "pending" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (requestUrl.endsWith("/credits/entitlements/operations/operation-restart")) {
        operationStatusCalls += 1;
        return new Response(
          JSON.stringify({
            operation_id: "operation-restart",
            status: operationStatus,
            ...(operationStatus === "completed" ? { applied_cents: 1000 } : {}),
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pendingResponse = await context.app.inject({
      method: "POST",
      url: "/credits/entitlements/claim",
      headers: localOwnerAdminHeaders(),
      payload: { email: "restart@example.com" },
    });
    expect(pendingResponse.statusCode).toBe(202);
    expect(mockPreferences.braindrive_models_entitlement).toMatchObject({
      operation_id: "operation-restart",
      status: "pending",
      provider_activation_revision_at_start: 6,
    });
    expect(mockPreferences.provider_activation_revision).toBe(6);

    const activationResponse = await context.app.inject({
      method: "PUT",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
      payload: { active_provider_profile: "ollama" },
    });
    expect(activationResponse.statusCode).toBe(200);
    expect(mockPreferences.provider_activation_revision).toBe(7);

    await restartTestServer(context);
    operationStatus = "completed";

    const completedResponse = await context.app.inject({
      method: "GET",
      url: "/credits/entitlements/status",
      headers: localOwnerAdminHeaders(),
    });
    expect(completedResponse.statusCode).toBe(200);
    expect(parseJson(completedResponse.body)).toMatchObject({
      state: "completed",
      settings: {
        active_provider_profile: "ollama",
        provider_activation_revision: 7,
      },
    });
    expect(operationStatusCalls).toBe(1);
    expect(mockPreferences.braindrive_models_entitlement?.provider_activation_revision_at_start).toBe(6);
    expect(mockPreferences.active_provider_profile).toBe("ollama");
    expect(mockPreferences.provider_activation_revision).toBe(7);
  });

  it("keeps replay and legacy completed operations idempotent without replacing current provider intent", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      adapterConfig: providerActivationAdapterConfig(),
    });
    mockPreferences = {
      ...mockPreferences,
      active_provider_profile: "openrouter",
      provider_activation_revision: 4,
      provider_credentials: {
        "braindrive-models": {
          mode: "secret_ref",
          secret_ref: "provider/ai-gateway/api_key",
          required: true,
        },
      },
      braindrive_models_key: {
        install_public_id: "install-legacy",
        masked_key: "sk-...gacy",
        status: "ready",
        checkout_pending: false,
      },
      braindrive_models_entitlement: {
        operation_id: "operation-legacy",
        status: "completed",
        applied_cents: 900,
      },
    };
    await writeVaultSecret("provider/ai-gateway/api_key", "sk-legacy-claim-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).endsWith("/credits/status")) {
          return new Response(
            JSON.stringify({ remaining_usd: 9, total_purchased_usd: 9, total_spent_usd: 0 }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("not found", { status: 404 });
      })
    );

    const legacyResponse = await context.app.inject({
      method: "GET",
      url: "/credits/entitlements/status",
      headers: localOwnerAdminHeaders(),
    });
    expect(legacyResponse.statusCode).toBe(200);
    expect(parseJson(legacyResponse.body)).toMatchObject({
      state: "completed",
      settings: {
        active_provider_profile: "openrouter",
        provider_activation_revision: 4,
      },
    });
    expect(mockPreferences.provider_activation_revision).toBe(4);

    const legacyEvents = await readAuditEvents(context, "credits.entitlement_provider_activation");
    expect(legacyEvents.at(-1)?.details).toMatchObject({
      operation_id: "operation-legacy",
      captured_revision: null,
      current_revision: 4,
      resulting_revision: 4,
      decision: "skipped_missing_revision",
    });

    mockPreferences = {
      ...mockPreferences,
      active_provider_profile: "braindrive-models",
      provider_activation_revision: 5,
      braindrive_models_entitlement: {
        ...mockPreferences.braindrive_models_entitlement,
        provider_activation_revision_at_start: 4,
      },
    };
    const replayResponse = await context.app.inject({
      method: "GET",
      url: "/credits/entitlements/status",
      headers: localOwnerAdminHeaders(),
    });
    expect(replayResponse.statusCode).toBe(200);
    expect(parseJson(replayResponse.body)).toMatchObject({
      settings: {
        active_provider_profile: "braindrive-models",
        provider_activation_revision: 5,
      },
    });
    expect(mockPreferences.provider_activation_revision).toBe(5);

    const replayEvents = await readAuditEvents(context, "credits.entitlement_provider_activation");
    expect(replayEvents.at(-1)?.details.decision).toBe("already_applied");
  });

  it.each(["network", "malformed"] as const)(
    "keeps provider intent unchanged for a %s hosted claim failure",
    async (failureMode) => {
      context = await createTestServer({
        authMode: "local-owner",
        adapterConfig: providerActivationAdapterConfig(),
      });
      mockPreferences = {
        ...mockPreferences,
        active_provider_profile: "ollama",
        provider_activation_revision: 8,
        provider_credentials: {
          "braindrive-models": {
            mode: "secret_ref",
            secret_ref: "provider/ai-gateway/api_key",
            required: true,
          },
        },
        braindrive_models_key: {
          install_public_id: "install-failure",
          masked_key: "sk-...lure",
          status: "ready",
          checkout_pending: false,
        },
      };
      await writeVaultSecret("provider/ai-gateway/api_key", "sk-hosted-failure-key");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL) => {
          const requestUrl = String(url);
          if (requestUrl.endsWith("/credits/status")) {
            return new Response(JSON.stringify({ remaining_usd: 0, total_purchased_usd: 0 }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          if (requestUrl.endsWith("/credits/entitlements/claim")) {
            if (failureMode === "network") {
              throw new Error("upstream network detail");
            }
            return new Response(JSON.stringify({ status: "completed", applied_cents: 500 }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response("not found", { status: 404 });
        })
      );

      const response = await context.app.inject({
        method: "POST",
        url: "/credits/entitlements/claim",
        headers: localOwnerAdminHeaders(),
        payload: { email: "failure@example.com" },
      });

      expect(response.statusCode).toBe(503);
      expect(parseJson<{ code: string }>(response.body).code).toBe("campaign_unavailable");
      expect(response.body).not.toContain("upstream network detail");
      expect(mockPreferences.active_provider_profile).toBe("ollama");
      expect(mockPreferences.provider_activation_revision).toBe(8);
    }
  );

  it("persists memory backup settings and returns a safe payload", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings/memory-backup",
      headers: localOwnerAdminHeaders(),
      payload: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
        git_token: "ghp_test",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = parseJson<{
      memory_backup: {
        repository_url: string;
        frequency: string;
        token_configured: boolean;
        last_result: string;
        last_error: string | null;
      } | null;
    }>(response.body);
    expect(body.memory_backup).toMatchObject({
      repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
      frequency: "manual",
      token_configured: true,
      last_result: "never",
      last_error: null,
    });
    expect(response.body.includes("ghp_test")).toBe(false);
    expect(response.body.includes("token_secret_ref")).toBe(false);

    expect(mockPreferences.memory_backup).toMatchObject({
      repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
      frequency: "manual",
      token_secret_ref: "backup/git/token",
    });
  });

  it("requires token for first-time memory backup setup", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings/memory-backup",
      headers: localOwnerAdminHeaders(),
      payload: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Invalid request");
  });

  it("rejects unsupported memory backup repository URL formats", async () => {
    context = await createTestServer({ authMode: "local-owner" });
    mockPreferences = {
      ...mockPreferences,
      memory_backup: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
        token_secret_ref: "backup/git/token",
      },
    };

    const sshResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/memory-backup",
      headers: localOwnerAdminHeaders(),
      payload: {
        repository_url: "ssh://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
      },
    });
    expect(sshResponse.statusCode).toBe(400);
    expect(parseJson<{ error: string }>(sshResponse.body).error).toBe("Invalid request");

    const credentialsResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/memory-backup",
      headers: localOwnerAdminHeaders(),
      payload: {
        repository_url: "https://user:pass@github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
      },
    });
    expect(credentialsResponse.statusCode).toBe(400);
    expect(parseJson<{ error: string }>(credentialsResponse.body).error).toBe("Invalid request");
  });

  it("allows memory backup updates without token after initial setup", async () => {
    context = await createTestServer({ authMode: "local-owner" });
    mockPreferences = {
      ...mockPreferences,
      memory_backup: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
        token_secret_ref: "backup/git/token",
      },
    };

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings/memory-backup",
      headers: localOwnerAdminHeaders(),
      payload: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "daily",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockPreferences.memory_backup).toMatchObject({
      repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
      frequency: "daily",
      token_secret_ref: "backup/git/token",
    });
  });

  it("rejects unauthenticated manual memory backup saves", async () => {
    context = await createTestServer();

    const response = await context.app.inject({
      method: "POST",
      url: "/settings/memory-backup/save",
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Unauthorized");
  });

  it("runs manual memory backup save and returns refreshed settings", async () => {
    context = await createTestServer({ authMode: "local-owner" });
    mockPreferences = {
      ...mockPreferences,
      memory_backup: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
        token_secret_ref: "backup/git/token",
      },
    };

    const response = await context.app.inject({
      method: "POST",
      url: "/settings/memory-backup/save",
      headers: localOwnerAdminHeaders(),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = parseJson<{
      result: { result: string; saved_at?: string };
      settings: { memory_backup: { last_result: string; last_save_at?: string; last_error: string | null } | null };
    }>(response.body);
    expect(body.result.result).toBe("success");
    expect(body.settings.memory_backup?.last_result).toBe("success");
    expect(body.settings.memory_backup?.last_save_at).toBe("2026-04-07T12:00:01.000Z");
    expect(body.settings.memory_backup?.last_error).toBeNull();
    expect(runMemoryBackupMock).toHaveBeenCalledTimes(1);
  });

  it("passes explicit remote replacement choice to manual memory backup save", async () => {
    context = await createTestServer({ authMode: "local-owner" });
    mockPreferences = {
      ...mockPreferences,
      memory_backup: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
        token_secret_ref: "backup/git/token",
      },
    };

    const response = await context.app.inject({
      method: "POST",
      url: "/settings/memory-backup/save",
      headers: localOwnerAdminHeaders(),
      payload: { on_remote_conflict: "replace_remote" },
    });

    expect(response.statusCode).toBe(200);
    expect(runMemoryBackupMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ memory_backup: expect.any(Object) }),
      { onRemoteConflict: "replace_remote" }
    );
  });

  it("restores memory backup and returns restore summary", async () => {
    context = await createTestServer({ authMode: "local-owner" });
    mockPreferences = {
      ...mockPreferences,
      memory_backup: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
        token_secret_ref: "backup/git/token",
      },
    };

    const response = await context.app.inject({
      method: "POST",
      url: "/settings/memory-backup/restore",
      headers: localOwnerAdminHeaders(),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = parseJson<{
      result: { commit: string; source_branch: string };
      settings: { memory_backup: object | null };
      logout_required: boolean;
    }>(response.body);
    expect(body.result.commit).toBe("abc123def456");
    expect(body.result.source_branch).toBe("braindrive-memory-backup");
    expect(body.settings.memory_backup).not.toBeNull();
    expect(body.logout_required).toBe(false);
    expect(restoreMemoryBackupMock).toHaveBeenCalledTimes(1);
  });

  it("forces logout after memory backup restore in local auth mode", async () => {
    context = await createTestServer();
    mockPreferences = {
      ...mockPreferences,
      memory_backup: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
        token_secret_ref: "backup/git/token",
      },
    };

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);
    const tokenPayload = parseJson<{ access_token: string }>(signupResponse.body);

    const response = await context.app.inject({
      method: "POST",
      url: "/settings/memory-backup/restore",
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = parseJson<{ logout_required: boolean }>(response.body);
    expect(body.logout_required).toBe(true);
    const setCookieHeader = response.headers["set-cookie"];
    expect(typeof setCookieHeader === "string" ? setCookieHeader : "").toContain("Max-Age=0");
  });

  it("round-trips memory backup save then restore through the settings API", async () => {
    context = await createTestServer({ authMode: "local-owner" });
    mockPreferences = {
      ...mockPreferences,
      memory_backup: {
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "manual",
        token_secret_ref: "backup/git/token",
      },
    };

    const memoryRoot = path.join(context.tempRoot, "memory");
    await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
    const notePath = path.join(memoryRoot, "documents", "backup-roundtrip.md");
    await writeFile(notePath, "before-backup\n", "utf8");

    let snapshot = "";
    runMemoryBackupMock.mockImplementationOnce(async (rootArg: string) => {
      snapshot = await readFile(path.join(rootArg, "documents", "backup-roundtrip.md"), "utf8");
      return {
        attempted_at: "2026-04-07T12:00:00.000Z",
        saved_at: "2026-04-07T12:00:01.000Z",
        result: "success" as const,
      };
    });
    restoreMemoryBackupMock.mockImplementationOnce(async (rootArg: string) => {
      await writeFile(path.join(rootArg, "documents", "backup-roundtrip.md"), snapshot, "utf8");
      return {
        attempted_at: "2026-04-07T12:10:00.000Z",
        restored_at: "2026-04-07T12:10:03.000Z",
        commit: "abc123def456",
        source_branch: "braindrive-memory-backup",
        warnings: [],
      };
    });

    const saveResponse = await context.app.inject({
      method: "POST",
      url: "/settings/memory-backup/save",
      headers: localOwnerAdminHeaders(),
      payload: {},
    });
    expect(saveResponse.statusCode).toBe(200);

    await writeFile(notePath, "after-mutation\n", "utf8");

    const restoreResponse = await context.app.inject({
      method: "POST",
      url: "/settings/memory-backup/restore",
      headers: localOwnerAdminHeaders(),
      payload: {},
    });
    expect(restoreResponse.statusCode).toBe(200);

    const restored = await readFile(notePath, "utf8");
    expect(restored).toBe("before-backup\n");
  });

  it("exports and imports migration archives through the gateway API", async () => {
    context = await createTestServer();

    const memoryRoot = path.join(context.tempRoot, "memory");
    const secretsRoot = path.join(context.tempRoot, "secrets");
    await writeFile(path.join(memoryRoot, "documents", "migration-note.md"), "original\n", "utf8").catch(async () => {
      await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
      await writeFile(path.join(memoryRoot, "documents", "migration-note.md"), "original\n", "utf8");
    });

    const signupResponse = await context.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        identifier: "owner",
        password: "password123",
      },
    });
    expect(signupResponse.statusCode).toBe(201);
    const tokenPayload = parseJson<{ access_token: string }>(signupResponse.body);

    const exportResponse = await context.app.inject({
      method: "GET",
      url: "/export",
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
      },
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.headers["content-type"]).toContain("application/gzip");

    await writeFile(path.join(memoryRoot, "documents", "migration-note.md"), "mutated\n", "utf8");

    const importResponse = await context.app.inject({
      method: "POST",
      url: "/migration/import",
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
        "content-type": "application/gzip",
      },
      payload: exportResponse.rawPayload,
    });
    expect(importResponse.statusCode).toBe(201);
    const imported = parseJson<{
      restored: { memory: boolean; secrets: boolean };
      source_format: string;
      settings: { approval_mode: string };
      logout_required: boolean;
    }>(importResponse.body);
    expect(imported.restored.memory).toBe(true);
    expect(imported.source_format).toBe("migration-v1");
    expect(imported.settings.approval_mode).toBe("ask-on-write");
    expect(imported.logout_required).toBe(true);
    const importSetCookie = importResponse.headers["set-cookie"];
    expect(typeof importSetCookie === "string" ? importSetCookie : "").toContain("Max-Age=0");

    const restoredFile = await readFile(path.join(memoryRoot, "documents", "migration-note.md"), "utf8");
    expect(restoredFile).toBe("original\n");

    const restoredVault = await readFile(path.join(secretsRoot, "vault.json"), "utf8");
    expect(restoredVault).toContain("auth/jwt/signing_key");
  });
});
