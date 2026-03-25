import { useEffect, useState } from "react";

import { updateProviderCredential, getOnboardingStatus } from "@/api/gateway-adapter";
import { resetGatewayChatRuntime } from "@/api/useGatewayChat";
import type { GatewayCredentialUpdateRequest, GatewayOnboardingStatus } from "@/api/types";
import AuthFlow from "@/components/auth/AuthFlow";
import AppShell from "@/components/layout/AppShell";
import ProviderCredentialsOnboarding from "@/components/onboarding/ProviderCredentialsOnboarding";

type AppScreen = "auth" | "main";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("auth");
  // In production, mode comes from GET /api/config (see v1-api-contract-recommendations.md).
  // Hardcoded here with a dev toggle until the backend is wired.
  const [deploymentMode, setDeploymentMode] = useState<"local" | "managed">(
    "local"
  );
  const [onboardingStatus, setOnboardingStatus] = useState<GatewayOnboardingStatus | null>(null);
  const [isLoadingOnboarding, setIsLoadingOnboarding] = useState(false);
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [onboardingRefreshToken, setOnboardingRefreshToken] = useState(0);

  useEffect(() => {
    if (screen !== "main" || deploymentMode !== "local") {
      setOnboardingStatus(null);
      setOnboardingError(null);
      setIsLoadingOnboarding(false);
      return;
    }

    let cancelled = false;
    setIsLoadingOnboarding(true);
    setOnboardingError(null);

    void getOnboardingStatus()
      .then((status) => {
        if (!cancelled) {
          setOnboardingStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setOnboardingError(error instanceof Error ? error.message : String(error));
          setOnboardingStatus(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingOnboarding(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [screen, deploymentMode, onboardingRefreshToken]);

  async function handleCredentialSubmit(payload: GatewayCredentialUpdateRequest): Promise<void> {
    setIsSavingOnboarding(true);
    setOnboardingError(null);
    try {
      const response = await updateProviderCredential(payload);
      setOnboardingStatus(response.onboarding);
      resetGatewayChatRuntime();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOnboardingError(message);
      throw new Error(message);
    } finally {
      setIsSavingOnboarding(false);
    }
  }

  /* Dev-only mode toggle - remove before production */
  const modeToggle = (
    <div className="fixed bottom-4 right-4 z-50 hidden items-center gap-2 rounded-lg border border-bd-border bg-bd-bg-secondary px-3 py-2 text-xs shadow-lg md:flex">
      <span className="text-bd-text-muted">Mode:</span>
      <button
        type="button"
        onClick={() =>
          setDeploymentMode((m) => (m === "local" ? "managed" : "local"))
        }
        className="rounded-md bg-bd-bg-tertiary px-2 py-1 text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
      >
        {deploymentMode}
      </button>
    </div>
  );

  if (screen === "auth") {
    return (
      <>
        <AuthFlow
          mode={deploymentMode}
          onAuthenticated={() => setScreen("main")}
        />
        {modeToggle}
      </>
    );
  }

  const shouldShowOnboarding =
    deploymentMode === "local" &&
    (isLoadingOnboarding || onboardingStatus?.onboarding_required === true || onboardingStatus === null);

  return (
    <>
      <AppShell
        deploymentMode={deploymentMode}
        onLogout={() => setScreen("auth")}
      />
      {deploymentMode === "local" && shouldShowOnboarding && (
        <ProviderCredentialsOnboarding
          status={onboardingStatus}
          isLoading={isLoadingOnboarding}
          isSaving={isSavingOnboarding}
          error={onboardingError}
          onRetry={() => setOnboardingRefreshToken((value) => value + 1)}
          onSubmit={handleCredentialSubmit}
        />
      )}
      {modeToggle}
    </>
  );
}
