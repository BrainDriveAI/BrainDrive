import path from "node:path";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import type { AdapterConfig, Preferences, RuntimeConfig, StreamEvent } from "../contracts.js";
import type { MemoryBackupRunResult } from "../memory/backup.js";
import { TwilioSmsLinkStore } from "../memory/twilio-sms-link-store.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockRuntimeConfig: RuntimeConfig;
let mockPreferences: Preferences;
const {
  runMemoryBackupMock,
  restoreMemoryBackupMock,
  createMemoryBackupSchedulerMock,
  sendTwilioOutboundSmsMock,
  runAgentLoopMock,
} = vi.hoisted(() => {
  return {
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
  sendTwilioOutboundSmsMock: vi.fn<
    (
      input: Record<string, unknown>
    ) => Promise<
      | { ok: true; status_code: number; message_sid: string; status: string | null }
      | { ok: false; status_code: number; error_code: number | null; error_message: string }
    >
  >(async (_input: Record<string, unknown>) => ({
    ok: true,
    status_code: 201,
    message_sid: "SM11111111111111111111111111111111",
    status: "queued",
  })),
  runAgentLoopMock: vi.fn<any>(() =>
    (async function* stream() {
      yield {
        type: "done",
        conversation_id: "",
        message_id: "",
        finish_reason: "completed",
      } as const;
    })()
  ),
  };
});

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

vi.mock("../integrations/twilio/client.js", async () => {
  const actual = await vi.importActual<typeof import("../integrations/twilio/client.js")>(
    "../integrations/twilio/client.js"
  );
  return {
    ...actual,
    sendTwilioOutboundSms: sendTwilioOutboundSmsMock,
  };
});

vi.mock("../memory/backup.js", () => ({
  runMemoryBackup: runMemoryBackupMock,
}));

vi.mock("../memory/backup-restore.js", () => ({
  restoreMemoryBackup: restoreMemoryBackupMock,
}));

vi.mock("./memory-backup-scheduler.js", () => ({
  createMemoryBackupScheduler: createMemoryBackupSchedulerMock,
}));

vi.mock("../engine/loop.js", () => ({
  runAgentLoop: runAgentLoopMock,
}));

import { buildServer } from "./server.js";

type TestServerContext = {
  app: Awaited<ReturnType<typeof buildServer>>["app"];
  tempRoot: string;
  restoreEnv: () => void;
};

async function createTestServer(
  options: { bootstrapToken?: string; authMode?: RuntimeConfig["auth_mode"] } = {}
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

  process.env.PAA_SECRETS_HOME = secretsRoot;
  if (typeof options.bootstrapToken === "string") {
    process.env.PAA_AUTH_BOOTSTRAP_TOKEN = options.bootstrapToken;
  } else {
    delete process.env.PAA_AUTH_BOOTSTRAP_TOKEN;
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

function toEventStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  return (async function* stream() {
    for (const event of events) {
      yield event;
    }
  })();
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

function twilioSmsUpdatePayload(
  patch: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    enabled: true,
    account_sid: "AC1234567890abcdef1234567890abcd",
    from_number: "+14155552671",
    public_base_url: "https://example.com",
    auto_reply: true,
    strict_owner_mode: false,
    rate_limit_period: 60,
    rate_limit_cap_round_trips: 5,
    auth_token: "twilio_secret_v1",
    ...patch,
  };
}

const EMPTY_TWIML_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const RATE_LIMIT_CAP_NOTICE =
  "Auto-reply limit reached for now. I will resume SMS replies when the current rate-limit window resets.";

function signTwilioWebhookPayload(options: {
  authToken: string;
  webhookUrl: string;
  formBody: string;
  omitKeys?: string[];
}): string {
  const params = new URLSearchParams(options.formBody);
  const grouped: Record<string, string[]> = {};

  for (const [key, value] of params) {
    if (options.omitKeys?.includes(key)) {
      continue;
    }
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(value);
  }

  let payload = options.webhookUrl;
  for (const key of Object.keys(grouped).sort((left, right) => left.localeCompare(right))) {
    for (const value of grouped[key]!.slice().sort((left, right) => left.localeCompare(right))) {
      payload += `${key}${value}`;
    }
  }

  return createHmac("sha1", options.authToken).update(payload, "utf8").digest("base64");
}

describe.sequential("gateway auth route integration", () => {
  let context: TestServerContext | null = null;

  afterEach(async () => {
    await destroyTestServer(context);
    context = null;
    runMemoryBackupMock.mockClear();
    restoreMemoryBackupMock.mockClear();
    createMemoryBackupSchedulerMock.mockClear();
    sendTwilioOutboundSmsMock.mockClear();
    runAgentLoopMock.mockClear();
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

  it("rejects unauthenticated twilio settings updates", async () => {
    context = await createTestServer();

    const response = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      payload: twilioSmsUpdatePayload(),
    });

    expect(response.statusCode).toBe(401);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Unauthorized");
  });

  it("persists Twilio settings, exposes safe settings payload, and keeps token ref when token is blank", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const initialResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload({
        auth_token_secret_ref: "twilio/auth/custom",
      }),
    });

    expect(initialResponse.statusCode).toBe(200);
    expect(initialResponse.body.includes("twilio_secret_v1")).toBe(false);
    expect(mockPreferences.twilio_sms?.auth_token_secret_ref).toBe("twilio/auth/custom");

    const blankTokenUpdate = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload({
        auth_token: "",
        auto_reply: false,
      }),
    });

    expect(blankTokenUpdate.statusCode).toBe(200);
    expect(mockPreferences.twilio_sms?.auth_token_secret_ref).toBe("twilio/auth/custom");

    const settingsResponse = await context.app.inject({
      method: "GET",
      url: "/settings",
      headers: localOwnerAdminHeaders(),
    });

    expect(settingsResponse.statusCode).toBe(200);
    const body = parseJson<{
      twilio_sms: {
        token_configured: boolean;
        webhook_url: string | null;
      } | null;
    }>(settingsResponse.body);
    expect(body.twilio_sms).toMatchObject({
      token_configured: true,
      webhook_url: "https://example.com/twilio/sms/webhook",
    });
    expect(settingsResponse.body.includes("twilio_secret_v1")).toBe(false);
    expect(settingsResponse.body.includes("auth_token")).toBe(false);
  });

  it("rejects unauthenticated twilio test-send requests", async () => {
    context = await createTestServer();

    const response = await context.app.inject({
      method: "POST",
      url: "/settings/twilio-sms/test-send",
      payload: {
        recipient: "+14155553333",
        message: "hello",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Unauthorized");
  });

  it("sends twilio test SMS with GSM-7 sanitization and updates operational state", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload({
        test_recipient: "+14155553333",
      }),
    });
    expect(updateResponse.statusCode).toBe(200);

    const sendResponse = await context.app.inject({
      method: "POST",
      url: "/settings/twilio-sms/test-send",
      headers: localOwnerAdminHeaders(),
      payload: {
        message: "Café — hi 😊",
      },
    });

    expect(sendResponse.statusCode).toBe(200);
    const body = parseJson<{
      result: string;
      recipient: string;
      message: string;
      provider: { message_sid: string | null; status: string | null };
    }>(sendResponse.body);
    expect(body).toMatchObject({
      result: "success",
      recipient: "+14155553333",
      message: "Cafe - hi ?",
      provider: {
        message_sid: "SM11111111111111111111111111111111",
        status: "queued",
      },
    });

    expect(sendTwilioOutboundSmsMock).toHaveBeenCalledTimes(1);
    expect(sendTwilioOutboundSmsMock).toHaveBeenCalledWith({
      account_sid: "AC1234567890abcdef1234567890abcd",
      auth_token: "twilio_secret_v1",
      from_number: "+14155552671",
      to_number: "+14155553333",
      message: "Cafe - hi ?",
      smart_encoded: true,
    });
    expect(mockPreferences.twilio_sms?.last_result).toBe("success");
    expect(mockPreferences.twilio_sms?.last_error).toBeNull();
    expect(mockPreferences.twilio_sms?.last_outbound_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(sendResponse.body.includes("twilio_secret_v1")).toBe(false);
  });

  it("records twilio test-send failures with sanitized error output", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload(),
    });
    expect(updateResponse.statusCode).toBe(200);

    sendTwilioOutboundSmsMock.mockResolvedValueOnce({
      ok: false,
      status_code: 400,
      error_code: 21606,
      error_message: "The 'From' phone number is invalid",
    });

    const sendResponse = await context.app.inject({
      method: "POST",
      url: "/settings/twilio-sms/test-send",
      headers: localOwnerAdminHeaders(),
      payload: {
        recipient: "+14155553333",
        message: "hello",
      },
    });

    expect(sendResponse.statusCode).toBe(502);
    const body = parseJson<{
      result: string;
      recipient: string;
      message: string;
      error: string;
    }>(sendResponse.body);
    expect(body).toEqual({
      result: "failed",
      recipient: "+14155553333",
      message: "hello",
      sent_at: expect.any(String),
      error: "Twilio request failed (status 400, code 21606)",
    });
    expect(mockPreferences.twilio_sms?.last_result).toBe("failed");
    expect(mockPreferences.twilio_sms?.last_error).toBe("Twilio request failed (status 400, code 21606)");
    expect(sendResponse.body.includes("twilio_secret_v1")).toBe(false);
  });

  it("streams /message responses and persists turns through the shared processing path", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    runAgentLoopMock.mockImplementationOnce(() =>
      toEventStream([
        {
          type: "text-delta",
          delta: "hello from shared flow",
        },
        {
          type: "done",
          conversation_id: "",
          message_id: "",
          finish_reason: "completed",
        },
      ])
    );

    const response = await context.app.inject({
      method: "POST",
      url: "/message",
      headers: localOwnerAdminHeaders(),
      payload: {
        content: "Ping from web route",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: text-delta");
    expect(response.body).toContain("event: done");
    const conversationId = response.headers["x-conversation-id"];
    expect(typeof conversationId).toBe("string");
    if (typeof conversationId !== "string") {
      throw new Error("Expected x-conversation-id response header to be present");
    }
    expect(conversationId.length).toBeGreaterThan(0);

    const conversationResponse = await context.app.inject({
      method: "GET",
      url: `/conversations/${conversationId}`,
      headers: localOwnerAdminHeaders(),
    });
    expect(conversationResponse.statusCode).toBe(200);

    const detail = parseJson<{ messages: Array<{ role: string; content: string }> }>(
      conversationResponse.body
    );
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]).toMatchObject({
      role: "user",
      content: "Ping from web route",
    });
    expect(detail.messages[1]).toMatchObject({
      role: "assistant",
      content: "hello from shared flow",
    });
  });

  it("accepts signed Twilio webhook intake without session auth and returns empty TwiML", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload(),
    });
    expect(updateResponse.statusCode).toBe(200);

    const formBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook0001&From=%2B14155551234&To=%2B14155552671&Body=Hello%20from%20owner&WaId=14155551234";
    const signature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      payload: formBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/xml");
    expect(response.body).toBe(EMPTY_TWIML_RESPONSE);
    expect(mockPreferences.twilio_sms?.last_inbound_at).toMatch(/\d{4}-\d{2}-\d{2}T/);

    const linkStore = new TwilioSmsLinkStore(path.join(context.tempRoot, "memory"));
    const linkedConversationId = await linkStore.getConversationIdForSender({
      account_sid: "AC1234567890abcdef1234567890abcd",
      from_number: "+14155551234",
      to_number: "+14155552671",
    });
    expect(linkedConversationId).toBeTruthy();

    const conversationResponse = await context.app.inject({
      method: "GET",
      url: `/conversations/${linkedConversationId}`,
      headers: localOwnerAdminHeaders(),
    });
    expect(conversationResponse.statusCode).toBe(200);
    const detail = parseJson<{ messages: Array<{ role: string; content: string }> }>(
      conversationResponse.body
    );
    expect(detail.messages.at(-1)).toMatchObject({
      role: "user",
      content: "Hello from owner",
    });
  });

  it("treats duplicate MessageSid deliveries as idempotent for owner senders", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload(),
    });
    expect(updateResponse.statusCode).toBe(200);

    runAgentLoopMock.mockImplementationOnce(() =>
      toEventStream([
        {
          type: "text-delta",
          delta: "single assistant reply",
        },
        {
          type: "done",
          conversation_id: "",
          message_id: "",
          finish_reason: "completed",
        },
      ])
    );

    const formBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-dup-owner-1&From=%2B14155551234&To=%2B14155552671&Body=Owner%20message";
    const signature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody,
    });

    const firstResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      payload: formBody,
    });
    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.body).toBe(EMPTY_TWIML_RESPONSE);

    const secondResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      payload: formBody,
    });
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.body).toBe(EMPTY_TWIML_RESPONSE);

    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
    expect(sendTwilioOutboundSmsMock).toHaveBeenCalledTimes(1);

    const linkStore = new TwilioSmsLinkStore(path.join(context.tempRoot, "memory"));
    await expect(
      linkStore.isMessageSidDuplicate({
        account_sid: "AC1234567890abcdef1234567890abcd",
        message_sid: "SMwebhook-dup-owner-1",
      })
    ).resolves.toBe(true);

    const linkedConversationId = await linkStore.getConversationIdForSender({
      account_sid: "AC1234567890abcdef1234567890abcd",
      from_number: "+14155551234",
      to_number: "+14155552671",
    });
    expect(linkedConversationId).toBeTruthy();
    if (!linkedConversationId) {
      throw new Error("Expected sender to be linked to a conversation");
    }

    const conversationResponse = await context.app.inject({
      method: "GET",
      url: `/conversations/${linkedConversationId}`,
      headers: localOwnerAdminHeaders(),
    });
    expect(conversationResponse.statusCode).toBe(200);
    const detail = parseJson<{ messages: Array<{ role: string; content: string }> }>(
      conversationResponse.body
    );
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]).toMatchObject({
      role: "user",
      content: "Owner message",
    });
    expect(detail.messages[1]).toMatchObject({
      role: "assistant",
      content: "single assistant reply",
    });
  });

  it("runs Twilio auto-replies through shared processing and sends GSM-7 sanitized outbound SMS", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload(),
    });
    expect(updateResponse.statusCode).toBe(200);

    runAgentLoopMock.mockImplementationOnce(() =>
      toEventStream([
        {
          type: "text-delta",
          delta: "Café — hi 😊",
        },
        {
          type: "done",
          conversation_id: "",
          message_id: "",
          finish_reason: "completed",
        },
      ])
    );

    const formBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-auto-reply-1&From=%2B14155551234&To=%2B14155552671&Body=Hello%20from%20owner";
    const signature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      payload: formBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(EMPTY_TWIML_RESPONSE);
    expect(sendTwilioOutboundSmsMock).toHaveBeenCalledTimes(1);
    expect(sendTwilioOutboundSmsMock).toHaveBeenLastCalledWith({
      account_sid: "AC1234567890abcdef1234567890abcd",
      auth_token: "twilio_secret_v1",
      from_number: "+14155552671",
      to_number: "+14155551234",
      message: "Cafe - hi ?",
      smart_encoded: true,
    });
    expect(mockPreferences.twilio_sms?.last_outbound_at).toMatch(/\d{4}-\d{2}-\d{2}T/);

    const linkStore = new TwilioSmsLinkStore(path.join(context.tempRoot, "memory"));
    const linkedConversationId = await linkStore.getConversationIdForSender({
      account_sid: "AC1234567890abcdef1234567890abcd",
      from_number: "+14155551234",
      to_number: "+14155552671",
    });
    expect(linkedConversationId).toBeTruthy();
    if (!linkedConversationId) {
      throw new Error("Expected sender to be linked to a conversation");
    }

    const conversationResponse = await context.app.inject({
      method: "GET",
      url: `/conversations/${linkedConversationId}`,
      headers: localOwnerAdminHeaders(),
    });
    expect(conversationResponse.statusCode).toBe(200);
    const detail = parseJson<{ messages: Array<{ role: string; content: string }> }>(
      conversationResponse.body
    );
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]).toMatchObject({
      role: "user",
      content: "Hello from owner",
    });
    expect(detail.messages[1]).toMatchObject({
      role: "assistant",
      content: "Café — hi 😊",
    });
  });

  it("suppresses capped auto-replies and emits one cap notice per active window", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload({
        rate_limit_period: 60,
        rate_limit_cap_round_trips: 1,
      }),
    });
    expect(updateResponse.statusCode).toBe(200);

    runAgentLoopMock.mockImplementationOnce(() =>
      toEventStream([
        {
          type: "text-delta",
          delta: "first auto reply",
        },
        {
          type: "done",
          conversation_id: "",
          message_id: "",
          finish_reason: "completed",
        },
      ])
    );

    const firstBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-cap-1&From=%2B14155551234&To=%2B14155552671&Body=First%20inbound";
    const firstSignature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody: firstBody,
    });
    const firstResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": firstSignature,
      },
      payload: firstBody,
    });
    expect(firstResponse.statusCode).toBe(200);

    const secondBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-cap-2&From=%2B14155551234&To=%2B14155552671&Body=Second%20inbound";
    const secondSignature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody: secondBody,
    });
    const secondResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": secondSignature,
      },
      payload: secondBody,
    });
    expect(secondResponse.statusCode).toBe(200);

    const thirdBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-cap-3&From=%2B14155551234&To=%2B14155552671&Body=Third%20inbound";
    const thirdSignature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody: thirdBody,
    });
    const thirdResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": thirdSignature,
      },
      payload: thirdBody,
    });
    expect(thirdResponse.statusCode).toBe(200);

    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
    expect(sendTwilioOutboundSmsMock).toHaveBeenCalledTimes(2);
    expect(sendTwilioOutboundSmsMock.mock.calls[0]?.[0]).toMatchObject({
      to_number: "+14155551234",
      message: "first auto reply",
    });
    expect(sendTwilioOutboundSmsMock.mock.calls[1]?.[0]).toMatchObject({
      to_number: "+14155551234",
      message: RATE_LIMIT_CAP_NOTICE,
    });

    const linkStore = new TwilioSmsLinkStore(path.join(context.tempRoot, "memory"));
    const rateLimitState = await linkStore.getRateLimitState({
      account_sid: "AC1234567890abcdef1234567890abcd",
      from_number: "+14155551234",
      to_number: "+14155552671",
    });
    expect(rateLimitState).toMatchObject({
      current_count: 1,
      cap_round_trips: 1,
      period_seconds: 60,
    });
    expect(rateLimitState?.last_notified_at).toBeTruthy();
  });

  it("resets Twilio auto-reply rate-limit state after the configured period elapses", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload({
        rate_limit_period: 1,
        rate_limit_cap_round_trips: 1,
      }),
    });
    expect(updateResponse.statusCode).toBe(200);

    runAgentLoopMock
      .mockImplementationOnce(() =>
        toEventStream([
          {
            type: "text-delta",
            delta: "first-window-reply",
          },
          {
            type: "done",
            conversation_id: "",
            message_id: "",
            finish_reason: "completed",
          },
        ])
      )
      .mockImplementationOnce(() =>
        toEventStream([
          {
            type: "text-delta",
            delta: "second-window-reply",
          },
          {
            type: "done",
            conversation_id: "",
            message_id: "",
            finish_reason: "completed",
          },
        ])
      );

    const firstBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-reset-1&From=%2B14155551234&To=%2B14155552671&Body=Reset%20window%201";
    const firstSignature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody: firstBody,
    });
    const firstResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": firstSignature,
      },
      payload: firstBody,
    });
    expect(firstResponse.statusCode).toBe(200);

    const secondBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-reset-2&From=%2B14155551234&To=%2B14155552671&Body=Reset%20window%202";
    const secondSignature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody: secondBody,
    });
    const secondResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": secondSignature,
      },
      payload: secondBody,
    });
    expect(secondResponse.statusCode).toBe(200);

    const thirdBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-reset-3&From=%2B14155551234&To=%2B14155552671&Body=Reset%20window%203";
    const thirdSignature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody: thirdBody,
    });
    const thirdResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": thirdSignature,
      },
      payload: thirdBody,
    });
    expect(thirdResponse.statusCode).toBe(200);

    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
    expect(sendTwilioOutboundSmsMock).toHaveBeenCalledTimes(2);

    const linkStore = new TwilioSmsLinkStore(path.join(context.tempRoot, "memory"));
    const senderKey = {
      account_sid: "AC1234567890abcdef1234567890abcd",
      from_number: "+14155551234",
      to_number: "+14155552671",
    };
    const stateBeforeReset = await linkStore.getRateLimitState(senderKey);
    expect(stateBeforeReset).toMatchObject({
      current_count: 1,
      cap_round_trips: 1,
      period_seconds: 1,
    });
    expect(stateBeforeReset?.last_notified_at).toBeTruthy();

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 1200);
    });

    const fourthBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-reset-4&From=%2B14155551234&To=%2B14155552671&Body=Reset%20window%204";
    const fourthSignature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody: fourthBody,
    });
    const fourthResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": fourthSignature,
      },
      payload: fourthBody,
    });
    expect(fourthResponse.statusCode).toBe(200);
    expect(fourthResponse.body).toBe(EMPTY_TWIML_RESPONSE);

    expect(runAgentLoopMock).toHaveBeenCalledTimes(2);
    expect(sendTwilioOutboundSmsMock).toHaveBeenCalledTimes(3);
    expect(sendTwilioOutboundSmsMock.mock.calls[0]?.[0]).toMatchObject({
      to_number: "+14155551234",
      message: "first-window-reply",
    });
    expect(sendTwilioOutboundSmsMock.mock.calls[1]?.[0]).toMatchObject({
      to_number: "+14155551234",
      message: RATE_LIMIT_CAP_NOTICE,
    });
    expect(sendTwilioOutboundSmsMock.mock.calls[2]?.[0]).toMatchObject({
      to_number: "+14155551234",
      message: "second-window-reply",
    });

    const stateAfterReset = await linkStore.getRateLimitState(senderKey);
    expect(stateAfterReset).toMatchObject({
      current_count: 1,
      cap_round_trips: 1,
      period_seconds: 1,
    });
    expect(stateAfterReset?.last_notified_at).toBeUndefined();
    expect(stateAfterReset?.period_started_at).not.toBe(stateBeforeReset?.period_started_at);
  });

  it("processes same-sender inbound bursts sequentially in arrival order", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload({
        rate_limit_period: 60,
        rate_limit_cap_round_trips: 5,
      }),
    });
    expect(updateResponse.statusCode).toBe(200);

    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    runAgentLoopMock
      .mockImplementationOnce(
        () =>
          (async function* stream() {
            await firstGate;
            yield {
              type: "text-delta",
              delta: "assistant-1",
            } as const;
            yield {
              type: "done",
              conversation_id: "",
              message_id: "",
              finish_reason: "completed",
            } as const;
          })()
      )
      .mockImplementationOnce(() =>
        toEventStream([
          {
            type: "text-delta",
            delta: "assistant-2",
          },
          {
            type: "done",
            conversation_id: "",
            message_id: "",
            finish_reason: "completed",
          },
        ])
      );

    const firstBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-seq-1&From=%2B14155551234&To=%2B14155552671&Body=First%20message";
    const firstSignature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody: firstBody,
    });
    const firstRequest = context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": firstSignature,
      },
      payload: firstBody,
    });

    await Promise.resolve();

    const secondBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook-seq-2&From=%2B14155551234&To=%2B14155552671&Body=Second%20message";
    const secondSignature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody: secondBody,
    });
    const secondRequest = context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": secondSignature,
      },
      payload: secondBody,
    });

    releaseFirst?.();
    const [firstResponse, secondResponse] = await Promise.all([firstRequest, secondRequest]);
    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(runAgentLoopMock).toHaveBeenCalledTimes(2);

    const linkStore = new TwilioSmsLinkStore(path.join(context.tempRoot, "memory"));
    const linkedConversationId = await linkStore.getConversationIdForSender({
      account_sid: "AC1234567890abcdef1234567890abcd",
      from_number: "+14155551234",
      to_number: "+14155552671",
    });
    expect(linkedConversationId).toBeTruthy();
    if (!linkedConversationId) {
      throw new Error("Expected sender to be linked to a conversation");
    }

    const conversationResponse = await context.app.inject({
      method: "GET",
      url: `/conversations/${linkedConversationId}`,
      headers: localOwnerAdminHeaders(),
    });
    expect(conversationResponse.statusCode).toBe(200);
    const detail = parseJson<{ messages: Array<{ role: string; content: string }> }>(
      conversationResponse.body
    );
    expect(detail.messages).toHaveLength(4);
    expect(detail.messages[0]).toMatchObject({ role: "user", content: "First message" });
    expect(detail.messages[1]).toMatchObject({ role: "assistant", content: "assistant-1" });
    expect(detail.messages[2]).toMatchObject({ role: "user", content: "Second message" });
    expect(detail.messages[3]).toMatchObject({ role: "assistant", content: "assistant-2" });
  });

  it("rejects Twilio webhook intake with an invalid signature", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload(),
    });
    expect(updateResponse.statusCode).toBe(200);

    const formBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook0002&From=%2B14155551234&To=%2B14155552671&Body=Hello%20from%20owner";
    const response = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "invalid-signature",
      },
      payload: formBody,
    });

    expect(response.statusCode).toBe(403);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Forbidden");
  });

  it("requires Twilio signatures built from the full webhook form parameter set", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload(),
    });
    expect(updateResponse.statusCode).toBe(200);

    const formBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook0003&From=%2B14155551234&To=%2B14155552671&Body=Hello%20from%20owner&WaId=14155551234";
    const signatureWithoutWaId = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody,
      omitKeys: ["WaId"],
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signatureWithoutWaId,
      },
      payload: formBody,
    });

    expect(response.statusCode).toBe(403);
    expect(parseJson<{ error: string }>(response.body).error).toBe("Forbidden");
  });

  it("silently ignores non-owner senders in strict-owner mode and records MessageSid dedup state", async () => {
    context = await createTestServer({ authMode: "local-owner" });

    const updateResponse = await context.app.inject({
      method: "PUT",
      url: "/settings/twilio-sms",
      headers: localOwnerAdminHeaders(),
      payload: twilioSmsUpdatePayload({
        strict_owner_mode: true,
        owner_phone_number: "+14155550000",
      }),
    });
    expect(updateResponse.statusCode).toBe(200);

    const formBody =
      "AccountSid=AC1234567890abcdef1234567890abcd&MessageSid=SMwebhook0004&From=%2B14155559999&To=%2B14155552671&Body=Hello%20from%20non-owner";
    const signature = signTwilioWebhookPayload({
      authToken: "twilio_secret_v1",
      webhookUrl: "https://example.com/twilio/sms/webhook",
      formBody,
    });

    const firstResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      payload: formBody,
    });
    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.body).toBe(EMPTY_TWIML_RESPONSE);

    const dedupStore = new TwilioSmsLinkStore(path.join(context.tempRoot, "memory"));
    await expect(
      dedupStore.isMessageSidDuplicate({
        account_sid: "AC1234567890abcdef1234567890abcd",
        message_sid: "SMwebhook0004",
      })
    ).resolves.toBe(true);

    const secondResponse = await context.app.inject({
      method: "POST",
      url: "/twilio/sms/webhook",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      payload: formBody,
    });
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.body).toBe(EMPTY_TWIML_RESPONSE);
    expect(mockPreferences.twilio_sms?.last_inbound_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
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
