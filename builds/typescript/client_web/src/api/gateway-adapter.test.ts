vi.mock("./auth-adapter", () => ({
  authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));

import {
  getOnboardingStatus,
  getProviderModels,
  importLibraryArchive,
  restoreMemoryBackup,
  runMemoryBackupNow,
  sendTwilioTestSms,
  sendMessage,
  updateTwilioSmsSettings,
  updateMemoryBackupSettings,
  updateProviderCredential,
  type ChatEvent,
} from "./gateway-adapter";

function sseResponse(frames: string, headers?: Record<string, string>): Response {
  return new Response(frames, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      ...(headers ?? {}),
    },
  });
}

async function collectEvents(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("gateway-adapter SSE parsing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts canonical SSE payloads that omit type in data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            'event: text-delta',
            'data: {"delta":"Hello"}',
            "",
            "event: done",
            'data: {"finish_reason":"stop","conversation_id":"conv_1"}',
            "",
          ].join("\n")
        )
      )
    );

    const events = await collectEvents(sendMessage(null, "hi"));
    expect(events).toEqual([
      {
        type: "text-delta",
        delta: "Hello",
      },
      {
        type: "done",
        finish_reason: "stop",
        conversation_id: "conv_1",
      },
    ]);
  });

  it("maps legacy text-delta content field to delta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            "event: text-delta",
            'data: {"content":"Legacy format"}',
            "",
            "event: done",
            'data: {"finish_reason":"stop","conversation_id":"conv_2"}',
            "",
          ].join("\n")
        )
      )
    );

    const events = await collectEvents(sendMessage(null, "hi"));
    expect(events[0]).toMatchObject({
      type: "text-delta",
      delta: "Legacy format",
    });
  });

  it("exposes context-window warnings from response headers", async () => {
    const onContextWarning = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            "event: done",
            'data: {"finish_reason":"stop","conversation_id":"conv_3"}',
            "",
          ].join("\n"),
          {
            "x-context-window-warning": "1",
            "x-context-window-estimated-tokens": "90000",
            "x-context-window-budget-tokens": "100000",
            "x-context-window-ratio": "0.9",
            "x-context-window-threshold": "0.8",
            "x-context-window-managed": "1",
            "x-context-window-message": "This session is getting long.",
          }
        )
      )
    );

    const events = await collectEvents(sendMessage(null, "hi", { onContextWarning }));
    expect(events).toEqual([
      {
        type: "done",
        finish_reason: "stop",
        conversation_id: "conv_3",
      },
    ]);
    expect(onContextWarning).toHaveBeenCalledWith({
      estimated_tokens: 90000,
      budget_tokens: 100000,
      ratio: 0.9,
      threshold: 0.8,
      managed: true,
      message: "This session is getting long.",
    });
  });
});

describe("gateway-adapter settings models", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches provider models for a selected profile", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          provider_profile: "openrouter",
          provider_id: "openrouter",
          source: "provider",
          models: [{ id: "openai/gpt-4o-mini" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await getProviderModels("openrouter");
    expect(payload.provider_profile).toBe("openrouter");
    expect(payload.models).toEqual([{ id: "openai/gpt-4o-mini" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/models?provider_profile=openrouter",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

describe("gateway-adapter onboarding settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches onboarding status", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          onboarding_required: true,
          active_provider_profile: "openrouter",
          default_provider_profile: "openrouter",
          providers: [
            {
              profile_id: "openrouter",
              provider_id: "openrouter",
              credential_mode: "secret_ref",
              credential_ref: "provider/openrouter/api_key",
              requires_secret: true,
              credential_resolved: false,
              resolution_source: "none",
              resolution_error: "Secret reference is not set in vault",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await getOnboardingStatus();
    expect(payload.onboarding_required).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/onboarding-status",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("updates provider credential through settings endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          settings: {
            default_model: "openai/gpt-4o-mini",
            approval_mode: "ask-on-write",
            active_provider_profile: "openrouter",
            default_provider_profile: "openrouter",
            available_models: ["openai/gpt-4o-mini"],
            provider_profiles: [],
            memory_backup: null,
          },
          onboarding: {
            onboarding_required: false,
            active_provider_profile: "openrouter",
            default_provider_profile: "openrouter",
            providers: [],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateProviderCredential({
      provider_profile: "openrouter",
      mode: "secret_ref",
      api_key: "sk-test",
      set_active_provider: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/credentials",
      expect.objectContaining({
        method: "PUT",
        headers: expect.any(Object),
      })
    );
  });

  it("imports migration archives through the migration endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          imported_at: "2026-04-03T00:00:00.000Z",
          schema_version: 1,
          source_format: "migration-v1",
          restored: { memory: true, secrets: true },
          warnings: [],
          settings: {
            default_model: "openai/gpt-4o-mini",
            approval_mode: "ask-on-write",
            active_provider_profile: "openrouter",
            default_provider_profile: "openrouter",
            available_models: ["openai/gpt-4o-mini"],
            provider_profiles: [],
            memory_backup: null,
          },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await importLibraryArchive(new Blob(["archive"], { type: "application/gzip" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/migration/import",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/gzip" }),
      })
    );
  });

  it("updates memory backup settings through the dedicated endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          default_model: "openai/gpt-4o-mini",
          approval_mode: "ask-on-write",
          active_provider_profile: "openrouter",
          default_provider_profile: "openrouter",
          available_models: ["openai/gpt-4o-mini"],
          provider_profiles: [],
          memory_backup: {
            repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
            frequency: "manual",
            token_configured: true,
            last_result: "never",
            last_error: null,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateMemoryBackupSettings({
      repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
      frequency: "manual",
      git_token: "ghp_test",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/memory-backup",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
  });

  it("triggers manual memory backup save", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: {
            attempted_at: "2026-04-07T12:00:00.000Z",
            saved_at: "2026-04-07T12:00:01.000Z",
            result: "success",
          },
          settings: {
            default_model: "openai/gpt-4o-mini",
            approval_mode: "ask-on-write",
            active_provider_profile: "openrouter",
            default_provider_profile: "openrouter",
            available_models: ["openai/gpt-4o-mini"],
            provider_profiles: [],
            memory_backup: {
              repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
              frequency: "manual",
              token_configured: true,
              last_result: "success",
              last_error: null,
              last_save_at: "2026-04-07T12:00:01.000Z",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await runMemoryBackupNow();
    expect(payload.result.result).toBe("success");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/memory-backup/save",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
  });

  it("triggers memory backup restore", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: {
            attempted_at: "2026-04-07T12:10:00.000Z",
            restored_at: "2026-04-07T12:10:03.000Z",
            commit: "abc123def456",
            source_branch: "braindrive-memory-backup",
            warnings: [],
          },
          settings: {
            default_model: "openai/gpt-4o-mini",
            approval_mode: "ask-on-write",
            active_provider_profile: "openrouter",
            default_provider_profile: "openrouter",
            available_models: ["openai/gpt-4o-mini"],
            provider_profiles: [],
            memory_backup: {
              repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
              frequency: "manual",
              token_configured: true,
              last_result: "success",
              last_error: null,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await restoreMemoryBackup({ target_commit: "abc123def456" });
    expect(payload.result.commit).toBe("abc123def456");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/memory-backup/restore",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
  });
});

describe("gateway-adapter twilio sms settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("updates Twilio SMS settings through the dedicated endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          default_model: "openai/gpt-4o-mini",
          approval_mode: "ask-on-write",
          active_provider_profile: "openrouter",
          default_provider_profile: "openrouter",
          available_models: ["openai/gpt-4o-mini"],
          provider_profiles: [],
          memory_backup: null,
          twilio_sms: {
            enabled: true,
            account_sid: "AC1234567890abcdef1234567890abcd",
            from_number: "+14155552671",
            public_base_url: "https://example.com",
            auto_reply: true,
            strict_owner_mode: false,
            owner_phone_number: null,
            rate_limit_period: 60,
            rate_limit_cap_round_trips: 5,
            rate_limit_current_count: 0,
            token_configured: true,
            test_recipient: "+14155553333",
            last_error: null,
            webhook_url: "https://example.com/twilio/sms/webhook",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateTwilioSmsSettings({
      enabled: true,
      account_sid: "AC1234567890abcdef1234567890abcd",
      from_number: "+14155552671",
      public_base_url: "https://example.com",
      auto_reply: true,
      strict_owner_mode: false,
      rate_limit_period: 60,
      rate_limit_cap_round_trips: 5,
      auth_token: "twilio_secret_v1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/twilio-sms",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
  });

  it("triggers Twilio SMS test send", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: "success",
          recipient: "+14155553333",
          message: "hello",
          sent_at: "2026-04-07T12:10:03.000Z",
          provider: {
            message_sid: "SM11111111111111111111111111111111",
            status: "queued",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await sendTwilioTestSms({
      recipient: "+14155553333",
      message: "hello",
    });
    expect(payload.result).toBe("success");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/twilio-sms/test-send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
  });
});
