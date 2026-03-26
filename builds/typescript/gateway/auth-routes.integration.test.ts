import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";

import type { AdapterConfig, Preferences, RuntimeConfig } from "../contracts.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockRuntimeConfig: RuntimeConfig;
let mockPreferences: Preferences;

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

import { buildServer } from "./server.js";

type TestServerContext = {
  app: Awaited<ReturnType<typeof buildServer>>["app"];
  tempRoot: string;
  restoreEnv: () => void;
};

async function createTestServer(options: { bootstrapToken?: string } = {}): Promise<TestServerContext> {
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
    auth_mode: "local",
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

describe.sequential("gateway auth route integration", () => {
  let context: TestServerContext | null = null;

  afterEach(async () => {
    await destroyTestServer(context);
    context = null;
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
});
