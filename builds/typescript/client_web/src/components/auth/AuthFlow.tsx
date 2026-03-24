// Auth screen coordinator — manages navigation between login, signup, and forgot password.
// All screens are UI shells. Backend wiring (httpOnly cookies, session check) comes in Phase 2.
import { useState } from "react";

import ForgotPasswordPage from "./ForgotPasswordPage";
import LoginPage from "./LoginPage";
import SignupPage from "./SignupPage";

type AuthFlowProps = {
  mode: "local" | "managed";
  onAuthenticated: () => void;
};

type AuthScreen = "login" | "signup" | "forgot-password";

export default function AuthFlow({ mode, onAuthenticated }: AuthFlowProps) {
  const [screen, setScreen] = useState<AuthScreen>("login");
  const [error, setError] = useState<string | null>(null);

  switch (screen) {
    case "login":
      return (
        <LoginPage
          mode={mode}
          error={error}
          onLogin={() => {
            setError(null);
            onAuthenticated();
          }}
          onNavigateToSignup={() => {
            setError(null);
            setScreen("signup");
          }}
          onNavigateToForgotPassword={() => {
            setError(null);
            setScreen("forgot-password");
          }}
        />
      );
    case "signup":
      return (
        <SignupPage
          mode={mode}
          error={error}
          onSignup={() => {
            setError(null);
            onAuthenticated();
          }}
          onNavigateToLogin={() => {
            setError(null);
            setScreen("login");
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
          }}
        />
      );
  }
}
