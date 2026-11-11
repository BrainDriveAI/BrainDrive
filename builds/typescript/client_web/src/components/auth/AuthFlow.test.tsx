import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import AuthFlow from "./AuthFlow";

const fetchBootstrapStatusMock = vi.fn();
const restoreSessionMock = vi.fn();
const loginMock = vi.fn();
const signupMock = vi.fn();
const resetPasswordMock = vi.fn();

vi.mock("@/api/auth-adapter", () => ({
  fetchBootstrapStatus: () => fetchBootstrapStatusMock(),
  restoreSession: () => restoreSessionMock(),
  login: (payload: { identifier: string; password: string }) => loginMock(payload),
  resetPassword: (password: string) => resetPasswordMock(password),
  signup: (payload: { identifier: string; password: string; bootstrapToken?: string }) =>
    signupMock(payload),
}));

describe("AuthFlow", () => {
  beforeEach(() => {
    fetchBootstrapStatusMock.mockReset();
    restoreSessionMock.mockReset();
    loginMock.mockReset();
    signupMock.mockReset();
    resetPasswordMock.mockReset();

    restoreSessionMock.mockResolvedValue(false);
    loginMock.mockResolvedValue(undefined);
    signupMock.mockResolvedValue(undefined);
    resetPasswordMock.mockResolvedValue(undefined);
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

  it("defaults to signup on first load before account initialization", async () => {
    fetchBootstrapStatusMock.mockResolvedValue({
      account_initialized: false,
      mode: "local",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthFlow mode="local" onAuthenticated={() => {}} />
      </MemoryRouter>
    );

    expect(await screen.findByText("Setup Your Login")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
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

  it("completes local password recovery without changing the account data path", async () => {
    const user = userEvent.setup();
    fetchBootstrapStatusMock.mockResolvedValue({
      account_initialized: true,
      mode: "local",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthFlow mode="local" onAuthenticated={() => {}} />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("New password"), "new-password123");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password123");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(resetPasswordMock).toHaveBeenCalledWith("new-password123");
    });
    expect(await screen.findByText("Password reset")).toBeInTheDocument();
    expect(screen.getByText(/Memory and saved data were not changed/)).toBeInTheDocument();
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

  it("requires and forwards the production bootstrap token", async () => {
    const user = userEvent.setup();
    fetchBootstrapStatusMock.mockResolvedValue({
      account_initialized: false,
      mode: "local",
    });

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <AuthFlow mode="local" requiresBootstrapToken onAuthenticated={() => {}} />
      </MemoryRouter>
    );

    await user.type(await screen.findByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Bootstrap token"), "test-bootstrap-token");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(signupMock).toHaveBeenCalledWith({
      identifier: "owner",
      password: "password123",
      bootstrapToken: "test-bootstrap-token",
    });
  });
});
