import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import type { AdapterConfig, Preferences, RuntimeConfig } from "../contracts.js";
import type { MemoryBackupRunResult } from "../memory/backup.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockRuntimeConfig: RuntimeConfig;
let mockPreferences: Preferences;
const { runMemoryBackupMock, restoreMemoryBackupMock, createMemoryBackupSchedulerMock } = vi.hoisted(() => ({
  runMemoryBackupMock: vi.fn<
    (memoryRoot: string, preferences: Preferences) => Promise<MemoryBackupRunResult>
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
    triggerManualBackup: vi.fn(async () => {
      const result = await runMemoryBackupMock(options.memoryRoot, mockPreferences);
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
            last_result: result.result === "failed" ? "failed" : "success",
            last_error: result.result === "failed" ? failureMessage ?? "Backup failed" : null,
          },
        };
      }

      return {
        result,
        preferences: mockPreferences,
      };
    }),
  })),
}));

const mockAdapterConfig: AdapterConfig = {
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
    updated: false,
  })),
  readBootstrapPrompt: vi.fn(async () => "You are a test bootstrap prompt."),
  savePreferences: vi.fn(async (_memoryRoot: string, nextPreferences: Preferences) => {
    mockPreferences = nextPreferences;
  }),
}));

vi.mock("../tools.js", () => ({
  discoverTools: vi.fn(async () => []),
}));

vi.mock("../git.js", () => ({
  ensureGitReady: vi.fn(async () => {}),
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

type TestServerContext = {
  app: Awaited<ReturnType<typeof buildServer>>["app"];
  tempRoot: string;
  restoreEnv: () => void;
};

async function createTestServer(
  options: {
    bootstrapToken?: string;
    authMode?: RuntimeConfig["auth_mode"];
    deploymentMode?: "managed" | "local";
    managedApiBase?: string;
    allowManagedPublicAccountProxyRoutes?: boolean;
  } = {}
): Promise<TestServerContext> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paa-auth-int-"));
  const memoryRoot = path.join(tempRoot, "memory");
  const preferencesRoot = path.join(memoryRoot, "preferences");
  const secretsRoot = path.join(tempRoot, "secrets");

  await mkdir(preferencesRoot, { recursive: true });
  await mkdir(secretsRoot, { recursive: true });

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

  const previousSecretsHome = process.env.PAA_SECRETS_HOME;
  const previousBootstrapToken = process.env.PAA_AUTH_BOOTSTRAP_TOKEN;
  const previousDeploymentMode = process.env.BD_DEPLOYMENT_MODE;
  const previousManagedApiBase = process.env.BD_MANAGED_API_BASE;
  const previousManagedPublicAccountProxyRoutes = process.env.PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES;

  process.env.PAA_SECRETS_HOME = secretsRoot;
  if (typeof options.bootstrapToken === "string") {
    process.env.PAA_AUTH_BOOTSTRAP_TOKEN = options.bootstrapToken;
  } else {
    delete process.env.PAA_AUTH_BOOTSTRAP_TOKEN;
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

describe.sequential("gateway auth route integration", () => {
  let context: TestServerContext | null = null;

  afterEach(async () => {
    await destroyTestServer(context);
    context = null;
    runMemoryBackupMock.mockClear();
    restoreMemoryBackupMock.mockClear();
    createMemoryBackupSchedulerMock.mockClear();
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

  it("requires authentication for managed account proxy routes by default", async () => {
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

    expect(response.statusCode).toBe(401);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Unauthorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows unauthenticated managed account proxy routes when explicitly enabled", async () => {
    context = await createTestServer({
      authMode: "local-owner",
      deploymentMode: "managed",
      managedApiBase: "https://managed.example",
      allowManagedPublicAccountProxyRoutes: true,
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
    }>(response.body);
    expect(body.result.commit).toBe("abc123def456");
    expect(body.result.source_branch).toBe("braindrive-memory-backup");
    expect(body.settings.memory_backup).not.toBeNull();
    expect(restoreMemoryBackupMock).toHaveBeenCalledTimes(1);
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
    }>(importResponse.body);
    expect(imported.restored.memory).toBe(true);
    expect(imported.source_format).toBe("migration-v1");
    expect(imported.settings.approval_mode).toBe("ask-on-write");

    const restoredFile = await readFile(path.join(memoryRoot, "documents", "migration-note.md"), "utf8");
    expect(restoredFile).toBe("original\n");

    const restoredVault = await readFile(path.join(secretsRoot, "vault.json"), "utf8");
    expect(restoredVault).toContain("auth/jwt/signing_key");
  });
});
