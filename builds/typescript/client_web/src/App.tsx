import { useEffect, useState } from "react";

import { logout } from "@/api/auth-adapter";
import { getConfig } from "@/api/config-adapter";
import AuthFlow from "@/components/auth/AuthFlow";
import AppShell from "@/components/layout/AppShell";

type AppScreen = "auth" | "main";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("auth");
  const [deploymentMode, setDeploymentMode] = useState<"local" | "managed">("local");
  const [installMode, setInstallMode] = useState<"local" | "quickstart" | "prod" | "unknown">(
    "unknown"
  );

  useEffect(() => {
    let isCancelled = false;
    void getConfig().then((config) => {
      if (isCancelled) {
        return;
      }
      setDeploymentMode(config.mode);
      setInstallMode(config.installMode);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  const modeToggle = (
    <div className="fixed bottom-4 right-4 z-50 hidden items-center gap-2 rounded-lg border border-bd-border bg-bd-bg-secondary px-3 py-2 text-xs shadow-lg md:flex">
      <span className="text-bd-text-muted">Mode:</span>
      <button
        type="button"
        onClick={() =>
          setDeploymentMode((currentMode) => (currentMode === "local" ? "managed" : "local"))
        }
        className="rounded-md bg-bd-bg-tertiary px-2 py-1 text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
      >
        {deploymentMode}
      </button>
      <span className="text-bd-text-muted">Install: {installMode}</span>
    </div>
  );

  if (screen === "auth") {
    return (
      <>
        <AuthFlow mode={deploymentMode} onAuthenticated={() => setScreen("main")} />
        {modeToggle}
      </>
    );
  }

  return (
    <>
      <AppShell
        deploymentMode={deploymentMode}
        onLogout={() => {
          void logout().finally(() => {
            setScreen("auth");
          });
        }}
      />
      {modeToggle}
    </>
  );
}
