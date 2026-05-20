import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import ErrorBoundary from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isHttpUrl, isTauriRuntime, openExternalUrl } from "@/utils/external-url";

import App from "./App";
import "./index.css";
import "./App.css";

function StartupSplashDismissal(): null {
  useEffect(() => {
    const notifyFrontendReady = async () => {
      if (!("__TAURI_INTERNALS__" in window)) {
        return;
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("frontend_ready");
      } catch (error) {
        console.warn("Unable to notify desktop shell that the frontend is ready", error);
      }
    };

    const splash = document.getElementById("startup-splash");
    if (!splash) {
      void notifyFrontendReady();
      return;
    }

    splash.classList.add("startup-splash--hidden");
    const timeoutId = window.setTimeout(() => {
      splash.remove();
      void notifyFrontendReady();
    }, 260);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return null;
}

function DesktopExternalLinkHandler(): null {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || !isHttpUrl(anchor.href)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void openExternalUrl(anchor.href);
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StartupSplashDismissal />
    <DesktopExternalLinkHandler />
    <ErrorBoundary>
      <BrowserRouter>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
