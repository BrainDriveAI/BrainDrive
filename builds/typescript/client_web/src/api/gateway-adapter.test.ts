import {
  getOnboardingStatus,
  getProviderModels,
  sendMessage,
  updateProviderCredential,
  type ChatEvent,
} from "./gateway-adapter";

function sseResponse(frames: string): Response {
  return new Response(frames, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
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
});
