import { useState } from "react";

type LoginPageProps = {
  mode: "local" | "managed";
  onLogin: (credentials: { identifier: string; password: string }) => Promise<void> | void;
  onNavigateToSignup: () => void;
  onNavigateToForgotPassword: () => void;
  showSignupAction?: boolean;
  isSubmitting?: boolean;
  error?: string | null;
};

export default function LoginPage({
  mode,
  onLogin,
  onNavigateToSignup,
  onNavigateToForgotPassword,
  showSignupAction = true,
  isSubmitting = false,
  error
}: LoginPageProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const identifierLabel = mode === "local" ? "Username" : "Email";
  const identifierPlaceholder =
    mode === "local" ? "Enter your username" : "you@example.com";
  const identifierType = mode === "local" ? "text" : "email";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onLogin({ identifier, password });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bd-bg-primary px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-10 flex flex-col items-center">
          <img
            src="/braindrive-logo.svg"
            alt="BrainDrive"
            className="mb-6 h-10 w-auto"
          />
          <p className="mt-2 text-lg text-bd-text-secondary">
            Welcome back to your BrainDrive.
          </p>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
          {error && (
            <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-4 py-3 text-sm text-bd-danger">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="identifier"
              className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
            >
              {identifierLabel}
            </label>
            <input
              id="identifier"
              type={identifierType}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={identifierPlaceholder}
              autoComplete="off"
              autoFocus
              required
              className="h-11 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-4 text-sm text-bd-text-primary outline-none placeholder:text-bd-text-muted focus:border-bd-amber"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="password"
                className="text-sm font-medium text-bd-text-secondary"
              >
                Password
              </label>
              <button
                type="button"
                onClick={onNavigateToForgotPassword}
                className="text-xs text-bd-text-muted transition-colors hover:text-bd-amber"
              >
                Forgot password?
              </button>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="off"
              required
              className="h-11 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-4 text-sm text-bd-text-primary outline-none placeholder:text-bd-text-muted focus:border-bd-amber"
            />
          </div>

          <button
            type="submit"
            disabled={!identifier.trim() || !password || isSubmitting}
            className="h-11 w-full rounded-xl bg-bd-amber text-sm font-medium text-bd-bg-primary transition-colors duration-200 hover:bg-bd-amber-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {showSignupAction && (
          <p className="mt-6 text-center text-sm text-bd-text-muted">
            Don't have an account?{" "}
            <button
              type="button"
              onClick={onNavigateToSignup}
              className="text-bd-amber transition-colors hover:text-bd-amber-hover"
            >
              Create account
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
