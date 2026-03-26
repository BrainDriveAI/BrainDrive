import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import AuthFlow from "./AuthFlow";

const fetchBootstrapStatusMock = vi.fn();
const restoreSessionMock = vi.fn();
const loginMock = vi.fn();
const signupMock = vi.fn();

vi.mock("@/api/auth-adapter", () => ({
  fetchBootstrapStatus: () => fetchBootstrapStatusMock(),
  restoreSession: () => restoreSessionMock(),
  login: (payload: { identifier: string; password: string }) => loginMock(payload),
  signup: (payload: { identifier: string; password: string }) => signupMock(payload),
}));

describe("AuthFlow", () => {
  beforeEach(() => {
    fetchBootstrapStatusMock.mockReset();
    restoreSessionMock.mockReset();
    loginMock.mockReset();
    signupMock.mockReset();

    restoreSessionMock.mockResolvedValue(false);
    loginMock.mockResolvedValue(undefined);
    signupMock.mockResolvedValue(undefined);
  });

  it("hides create-account CTA when account is initialized", async () => {
    fetchBootstrapStatusMock.mockResolvedValue({
      account_initialized: true,
      mode: "local",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthFlow mode="local" onAuthenticated={() => {}} />
      </MemoryRouter>
    );

    expect(await screen.findByText("Welcome back to your BrainDrive.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
  });

  it("redirects /signup to login when account is initialized", async () => {
    fetchBootstrapStatusMock.mockResolvedValue({
      account_initialized: true,
      mode: "local",
    });

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <AuthFlow mode="local" onAuthenticated={() => {}} />
      </MemoryRouter>
    );

    expect(await screen.findByText("Welcome back to your BrainDrive.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Account already initialized. Please sign in.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
  });

  it("allows signup route before account initialization", async () => {
    fetchBootstrapStatusMock.mockResolvedValue({
      account_initialized: false,
      mode: "local",
    });

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <AuthFlow mode="local" onAuthenticated={() => {}} />
      </MemoryRouter>
    );

    expect(await screen.findByText("Setup Your Login")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });
});
