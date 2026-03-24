import { useState } from "react";
import { ArrowLeft } from "lucide-react";

type ForgotPasswordPageProps = {
  mode: "local" | "managed";
  onRequestReset?: (email: string) => void;
  onNavigateToLogin: () => void;
};

export default function ForgotPasswordPage({
  mode,
  onRequestReset,
  onNavigateToLogin
}: ForgotPasswordPageProps) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
          <div className="space-y-4">
            <div className="rounded-lg border border-bd-border bg-bd-bg-secondary p-5">
              <h3 className="mb-3 text-sm font-medium text-bd-text-primary">
                Local password recovery
              </h3>
              <p className="text-sm leading-relaxed text-bd-text-muted">
                Your credentials are stored in your library at:
              </p>
              <code className="my-3 block rounded-md bg-bd-bg-tertiary px-3 py-2 font-mono text-xs text-bd-text-secondary">
                .braindrive/auth.json
              </code>
              <p className="text-sm leading-relaxed text-bd-text-muted">
                To reset your password:
              </p>
              <ol className="mt-2 space-y-1.5 text-sm text-bd-text-muted">
                <li className="flex gap-2">
                  <span className="shrink-0 text-bd-text-secondary">1.</span>
                  Stop your BrainDrive container
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0 text-bd-text-secondary">2.</span>
                  Delete the auth file from your library folder
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0 text-bd-text-secondary">3.</span>
                  Restart — you'll be prompted to create new credentials
                </li>
              </ol>
              <p className="mt-3 text-xs text-bd-text-muted">
                Your library data is unaffected — only the login credentials
                are reset.
              </p>
            </div>
          </div>
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
                autoFocus
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
