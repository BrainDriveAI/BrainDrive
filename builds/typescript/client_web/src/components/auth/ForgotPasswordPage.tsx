import { useState } from "react";
import { ArrowLeft } from "lucide-react";

type ForgotPasswordPageProps = {
  mode: "local" | "managed";
  error?: string | null;
  isSubmitting?: boolean;
  onRequestReset?: (value: string) => Promise<void> | void;
  onNavigateToLogin: () => void;
};

export default function ForgotPasswordPage({
  mode,
  error = null,
  isSubmitting = false,
  onRequestReset,
  onNavigateToLogin
}: ForgotPasswordPageProps) {
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (mode === "local") {
      if (newPassword !== confirmPassword) {
        setFormError("Passwords do not match.");
        return;
      }

      try {
        await onRequestReset?.(newPassword);
        setSubmitted(true);
      } catch {
        // AuthFlow owns the service error; keep the form available for retry.
      }
      return;
    }

    onRequestReset?.(email.trim());
    setSubmitted(true);
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
          <h1 className="font-heading text-2xl font-semibold text-bd-text-heading">
            Reset password
          </h1>
        </div>

        {mode === "local" ? (
          submitted ? (
            <div className="rounded-lg border border-bd-border bg-bd-bg-secondary p-5 text-center">
              <h3 className="mb-2 text-sm font-medium text-bd-text-primary">
                Password reset
              </h3>
              <p className="text-sm text-bd-text-muted">
                Your local password was reset. Your Memory and saved data were not changed. Return to sign in with the new password.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-center text-sm text-bd-text-muted">
                Set a new password from this local BrainDrive installation. Your Memory and saved data stay in place.
              </p>

              <div>
                <label
                  htmlFor="new-password"
                  className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
                >
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="h-11 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-4 text-sm text-bd-text-primary outline-none placeholder:text-bd-text-muted focus:border-bd-amber"
                />
              </div>

              <div>
                <label
                  htmlFor="confirm-new-password"
                  className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
                >
                  Confirm new password
                </label>
                <input
                  id="confirm-new-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="h-11 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-4 text-sm text-bd-text-primary outline-none placeholder:text-bd-text-muted focus:border-bd-amber"
                />
              </div>

              {(formError || error) && (
                <p role="alert" className="text-sm text-red-300">
                  {formError ?? error}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="h-11 w-full rounded-xl bg-bd-amber text-sm font-medium text-bd-bg-primary transition-colors duration-200 hover:bg-bd-amber-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Resetting password…" : "Reset password"}
              </button>
            </form>
          )
        ) : submitted ? (
          <div className="rounded-lg border border-bd-border bg-bd-bg-secondary p-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bd-bg-tertiary">
              <span className="text-xl">✉</span>
            </div>
            <h3 className="mb-2 text-sm font-medium text-bd-text-primary">
              Check your email
            </h3>
            <p className="text-sm text-bd-text-muted">
              If an account exists for{" "}
              <span className="text-bd-text-secondary">{email}</span>, we've
              sent password reset instructions.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-center text-sm text-bd-text-muted">
              Enter your email and we'll send you a link to reset your
              password.
            </p>

            <div>
              <label
                htmlFor="reset-email"
                className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
              >
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="h-11 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-4 text-sm text-bd-text-primary outline-none placeholder:text-bd-text-muted focus:border-bd-amber"
              />
            </div>

              <button
              type="submit"
              disabled={!email.trim()}
              className="h-11 w-full rounded-xl bg-bd-amber text-sm font-medium text-bd-bg-primary transition-colors duration-200 hover:bg-bd-amber-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send reset link
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={onNavigateToLogin}
          className="mt-6 flex w-full items-center justify-center gap-2 text-sm text-bd-text-muted transition-colors hover:text-bd-text-secondary"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          Back to sign in
        </button>
      </div>
    </div>
  );
}
