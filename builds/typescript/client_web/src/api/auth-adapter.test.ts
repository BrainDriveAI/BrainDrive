import { __resetAuthAdapterForTests, login, logout, signup } from "./auth-adapter";

describe("auth-adapter security behavior", () => {
  beforeEach(() => {
    __resetAuthAdapterForTests();
    vi.restoreAllMocks();
  });

  it("fails closed when bootstrap status cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "unavailable" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        })
      )
    );

    await expect(
      login({
        identifier: "owner",
        password: "password123",
      })
    ).rejects.toThrow("bootstrap_status_500");
  });

  it("does not allow password login outside local JWT mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const requestUrl = typeof input === "string" ? input : input.toString();
        if (requestUrl.includes("/api/auth/bootstrap-status")) {
          return new Response(
            JSON.stringify({
              account_initialized: true,
              mode: "local-owner",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }

        return new Response(null, { status: 404 });
      })
    );

    await expect(
      login({
        identifier: "owner",
        password: "password123",
      })
    ).rejects.toThrow("Password sign-in is unavailable in the current auth mode.");
  });

  it("sends authenticated logout requests in local mode", async () => {
    const observedAuthorizationHeaders: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = typeof input === "string" ? input : input.toString();

        if (requestUrl.includes("/api/auth/bootstrap-status")) {
          return new Response(
            JSON.stringify({
              account_initialized: true,
              mode: "local",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }

        if (requestUrl.includes("/api/auth/login")) {
          return new Response(
            JSON.stringify({
              access_token: "test-access-token",
              token_type: "Bearer",
              expires_at: "2099-01-01T00:00:00.000Z",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }

        if (requestUrl.includes("/api/auth/logout")) {
          const headers = new Headers(init?.headers);
          observedAuthorizationHeaders.push(headers.get("authorization") ?? "");
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(null, { status: 404 });
      })
    );

    await login({
      identifier: "owner",
      password: "password123",
    });
    await logout();

    expect(observedAuthorizationHeaders).toEqual(["Bearer test-access-token"]);
  });

  it("surfaces signup bootstrap protection errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const requestUrl = typeof input === "string" ? input : input.toString();
        if (requestUrl.includes("/api/auth/bootstrap-status")) {
          return new Response(
            JSON.stringify({
              account_initialized: false,
              mode: "local",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }

        if (requestUrl.includes("/api/auth/signup")) {
          return new Response(JSON.stringify({ error: "signup_local_only" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(null, { status: 404 });
      })
    );

    await expect(
      signup({
        identifier: "owner",
        password: "password123",
      })
    ).rejects.toThrow("Sign-up is restricted to localhost until the first account is created.");
  });
});
