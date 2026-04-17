import { useEffect, useState } from "react";

import { logout } from "@/api/auth-adapter";
import { getConfig } from "@/api/config-adapter";
import AuthFlow from "@/components/auth/AuthFlow";
import AppShell from "@/components/layout/AppShell";

type AppScreen = "loading" | "auth" | "main";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("loading");
  const [deploymentMode, setDeploymentMode] = useState<"local" | "managed">("local");
  const [installMode, setInstallMode] = useState<"dev" | "local" | "quickstart" | "prod" | "unknown">(
    "unknown"
  );
  const [appVersion, setAppVersion] = useState<string>("unknown");

  useEffect(() => {
    let isCancelled = false;
    void getConfig().then((config) => {
      if (isCancelled) {
        return;
      }
      setDeploymentMode(config.mode);
      setInstallMode(config.installMode);
      setAppVersion(config.appVersion);

      if (config.mode === "managed") {
        // Managed mode: user is already authenticated via gateway proxy headers.
        // Skip the auth screen entirely.
        setScreen("main");
      } else {
        setScreen("auth");
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  if (screen === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bd-bg-primary px-4">
        <p className="text-sm text-bd-text-muted">Loading...</p>
      </div>
    );
  }

  if (screen === "auth") {
    return (
      <AuthFlow mode={deploymentMode} onAuthenticated={() => setScreen("main")} />
    );
  }

  return (
    <AppShell
      deploymentMode={deploymentMode}
      installMode={installMode}
      appVersion={appVersion}
      onLogout={() => {
        void logout().finally(() => {
          if (deploymentMode === "managed") {
            // In managed mode, hit the Gateway logout endpoint which stops the
            // container, clears the bd_session cookie, and redirects to /login.
            window.location.href = "/api/gateway/auth/logout";
          } else {
            setScreen("auth");
          }
        });
      }}
    />
  );
}
