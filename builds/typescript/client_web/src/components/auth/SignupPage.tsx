import { useState } from "react";

type SignupPageProps = {
  mode: "local" | "managed";
  onSignup: (credentials: {
    username?: string;
    email?: string;
    password: string;
  }) => Promise<void> | void;
  onNavigateToLogin: () => void;
  isSubmitting?: boolean;
  error?: string | null;
};

export default function SignupPage({
  mode,
  onSignup,
  onNavigateToLogin,
  isSubmitting = false,
  error
}: SignupPageProps) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const isValid =
    (mode === "local"
      ? username.trim().length > 0 &&
        password.length >= 8 &&
        password === confirmPassword
      : email.trim().length > 0 &&
        password.length >= 8 &&
        password === confirmPassword);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!isValid) return;

    if (mode === "local") {
      onSignup({ username: username.trim(), password });
    } else {
      onSignup({ email: email.trim(), password });
    }
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
          <p className="mt-2 text-center text-lg text-bd-text-secondary">
            Setup Your Login
          </p>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
          {error && (
            <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-4 py-3 text-sm text-bd-danger">
              {error}
            </div>
          )}

          {mode === "local" ? (
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                autoComplete="off"
                autoFocus
                required
                className="h-11 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-4 text-sm text-bd-text-primary outline-none placeholder:text-bd-text-muted focus:border-bd-amber"
              />
            </div>
          ) : (
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="off"
                autoFocus
                required
                className="h-11 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-4 text-sm text-bd-text-primary outline-none placeholder:text-bd-text-muted focus:border-bd-amber"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="new-password"
              className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
            >
              Password
            </label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="off"
              required
              minLength={8}
              className="h-11 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-4 text-sm text-bd-text-primary outline-none placeholder:text-bd-text-muted focus:border-bd-amber"
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
            >
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              autoComplete="off"
              required
              className={[
                "h-11 w-full rounded-lg border bg-bd-bg-tertiary px-4 text-sm text-bd-text-primary outline-none placeholder:text-bd-text-muted focus:border-bd-amber",
                passwordMismatch ? "border-bd-danger" : "border-bd-border"
              ].join(" ")}
            />
            {passwordMismatch && (
              <p className="mt-1.5 text-xs text-bd-danger">
                Passwords don't match
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!isValid || isSubmitting}
            className="h-11 w-full rounded-xl bg-bd-amber text-sm font-medium text-bd-bg-primary transition-colors duration-200 hover:bg-bd-amber-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-bd-text-muted">
          Already have an account?{" "}
          <button
            type="button"
            onClick={onNavigateToLogin}
            className="text-bd-amber transition-colors hover:text-bd-amber-hover"
          >
            Sign in
          </button>
        </p>

        {mode === "local" && (
          <p className="mt-4 text-center text-xs text-bd-text-muted">
            Your credentials are stored locally on your computer. No data
            leaves your machine.
          </p>
        )}
      </div>
    </div>
  );
}
