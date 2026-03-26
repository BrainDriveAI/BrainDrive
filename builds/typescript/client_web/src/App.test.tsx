import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";

import { __resetAuthAdapterForTests } from "@/api/auth-adapter";

import App from "./App";

function renderApp() {
  return render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

describe("App", () => {
  beforeEach(() => {
    __resetAuthAdapterForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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

        if (requestUrl.includes("/api/auth/refresh")) {
          return new Response(JSON.stringify({ error: "invalid_refresh_token" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
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

        if (requestUrl.includes("/api/session")) {
          return new Response(
            JSON.stringify({
              mode: "local",
              user: {
                id: "owner",
                name: "Owner",
                initials: "OW",
                email: "owner@local.paa",
                role: "owner",
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }

        return new Response(
          JSON.stringify({
            onboarding_required: false,
            active_provider_profile: null,
            default_provider_profile: null,
            providers: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows login screen on first load", async () => {
    renderApp();

    expect(await screen.findByText("Welcome back to your BrainDrive.")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("navigates to main interface after login", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.type(await screen.findByLabelText("Username"), "testuser");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      (await screen.findAllByPlaceholderText("Message your BrainDrive...")).length
    ).toBeGreaterThan(0);
  });
});
