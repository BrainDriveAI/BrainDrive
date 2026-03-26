import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { fetchBootstrapStatus, login, restoreSession, signup } from "@/api/auth-adapter";

import ForgotPasswordPage from "./ForgotPasswordPage";
import LoginPage from "./LoginPage";
import SignupPage from "./SignupPage";

type AuthFlowProps = {
  mode: "local" | "managed";
  onAuthenticated: () => void;
};

type AuthScreen = "login" | "signup" | "forgot-password";

export default function AuthFlow({ mode, onAuthenticated }: AuthFlowProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [screen, setScreen] = useState<AuthScreen>("login");
  const [error, setError] = useState<string | null>(null);
  const [isLoadingBootstrap, setIsLoadingBootstrap] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accountInitialized, setAccountInitialized] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setIsLoadingBootstrap(true);
    setError(null);

    void (async () => {
      try {
        const status = await fetchBootstrapStatus();
        if (cancelled) {
          return;
        }

        setAccountInitialized(status.account_initialized);

        if (status.mode === "local" && status.account_initialized) {
          const restored = await restoreSession();
          if (!cancelled && restored) {
            onAuthenticated();
            return;
          }
        }

        applyRouteScreen(status.account_initialized);
      } catch {
        if (!cancelled) {
          setAccountInitialized(true);
          setScreen("login");
          setError("Unable to reach the auth service. Please verify the backend is running.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBootstrap(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isLoadingBootstrap) {
      return;
    }

    applyRouteScreen(accountInitialized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, isLoadingBootstrap, accountInitialized]);

  function applyRouteScreen(isInitialized: boolean): void {
    const wantsSignup = location.pathname.startsWith("/signup");

    if (wantsSignup && !isInitialized && mode === "local") {
      setScreen("signup");
      return;
    }

    if (wantsSignup && isInitialized) {
      setError("Account already initialized. Please sign in.");
      navigate("/", { replace: true });
    }

    if (screen !== "forgot-password") {
      setScreen("login");
    }
  }

  async function handleLogin(credentials: { identifier: string; password: string }): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    try {
      await login(credentials);
      onAuthenticated();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Sign-in failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignup(credentials: { identifier: string; password: string }): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    try {
      await signup(credentials);
      setAccountInitialized(true);
      onAuthenticated();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Sign-up failed.";
      setError(message);
      if (message.toLowerCase().includes("already initialized")) {
        setAccountInitialized(true);
        setScreen("login");
        navigate("/", { replace: true });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingBootstrap) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bd-bg-primary px-4">
        <p className="text-sm text-bd-text-muted">Preparing secure sign-in...</p>
      </div>
    );
  }

  switch (screen) {
    case "login":
      return (
        <LoginPage
          mode={mode}
          error={error}
          isSubmitting={isSubmitting}
          showSignupAction={mode === "local" && !accountInitialized}
          onLogin={handleLogin}
          onNavigateToSignup={() => {
            if (accountInitialized || mode !== "local") {
              return;
            }
            setError(null);
            setScreen("signup");
            navigate("/signup");
          }}
          onNavigateToForgotPassword={() => {
            setError(null);
            setScreen("forgot-password");
            navigate("/");
          }}
        />
      );
    case "signup":
      return (
        <SignupPage
          mode={mode}
          error={error}
          isSubmitting={isSubmitting}
          onSignup={(credentials) => {
            const identifier = mode === "local" ? credentials.username ?? "" : credentials.email ?? "";
            return handleSignup({ identifier, password: credentials.password });
          }}
          onNavigateToLogin={() => {
            setError(null);
            setScreen("login");
            navigate("/");
          }}
        />
      );
    case "forgot-password":
      return (
        <ForgotPasswordPage
          mode={mode}
          onNavigateToLogin={() => {
            setError(null);
            setScreen("login");
            navigate("/");
          }}
        />
      );
  }
}
