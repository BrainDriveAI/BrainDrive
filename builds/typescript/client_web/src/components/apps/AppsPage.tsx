import { useCallback, useEffect, useRef, useState } from "react";
import { AppWindow, RefreshCw } from "lucide-react";

import {
  getResumeBuilderApp,
  launchResumeBuilderApp,
  mutateResumeBuilderApp,
  type AppLaunch,
  type ResumeBuilderAppStatus,
} from "@/api/apps-adapter";
import SandboxedAppFrame from "./SandboxedAppFrame";

const stateCopy: Record<string, string> = {
  not_installed: "Not installed",
  staged: "Preparing installation",
  active: "Active and ready",
  disabled: "Disabled — your saved data is retained",
  updating: "Updating",
  rollback_pending: "Recovering the last working version",
  uninstalling: "Uninstalling app code",
  quarantined: "Unavailable because package trust changed",
  failed_recoverable: "Unavailable — retry or reinstall to recover",
};

export default function AppsPage({ entryPoint = "direct" }: { entryPoint?: "direct" | "career" }) {
  const [app, setApp] = useState<ResumeBuilderAppStatus | null>(null);
  const [launch, setLaunch] = useState<AppLaunch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const launchButtonRef = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async () => {
    try { setApp(await getResumeBuilderApp()); setError(null); }
    catch { setError("Apps are unavailable in this BrainDrive environment."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const mutate = async (action: Parameters<typeof mutateResumeBuilderApp>[0]) => {
    setBusy(action); setError(null); setLaunch(null);
    try { setApp(await mutateResumeBuilderApp(action)); }
    catch { setError(`Resume Builder could not ${action}. Your existing data and last working state were preserved.`); }
    finally { setBusy(null); }
  };
  const open = async () => {
    setBusy("launch"); setError(null);
    try { setLaunch(await launchResumeBuilderApp(entryPoint)); }
    catch { setError("Resume Builder could not connect. Check its status and try again."); }
    finally { setBusy(null); }
  };
  const closeSession = useCallback(() => {
    setLaunch(null);
    queueMicrotask(() => launchButtonRef.current?.focus());
  }, []);

  if (launch) return <SandboxedAppFrame launch={launch} onSessionClosed={closeSession} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8" data-testid="apps-page">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[0.16em] text-bd-text-muted">Apps</p><h1 className="mt-1 font-heading text-2xl font-semibold text-bd-text-heading">Your Apps</h1></div>
          <button type="button" aria-label="Refresh app status" onClick={() => void refresh()} className="rounded-md p-2 text-bd-text-secondary hover:bg-bd-bg-hover"><RefreshCw size={18} /></button>
        </div>
        {error ? <div role="alert" className="mb-4 rounded-lg border border-bd-danger px-4 py-3 text-sm">{error}</div> : null}
        {!app ? <p aria-live="polite" className="text-bd-text-secondary">Loading app status…</p> : (
          <article className="rounded-xl border border-bd-border bg-bd-bg-secondary p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3"><div className="rounded-lg bg-bd-bg-tertiary p-3 text-bd-amber"><AppWindow aria-hidden="true" /></div><div><h2 className="font-heading text-xl font-semibold text-bd-text-heading">{app.display_name}</h2><p className="text-sm text-bd-text-secondary">By {app.publisher}</p></div></div>
              <div className="text-left sm:text-right"><p className="font-medium text-bd-text-primary">{stateCopy[app.state] ?? app.state}</p><p className="text-xs text-bd-text-muted">{app.package_version ? `Version ${app.package_version}` : `Available ${app.available_version}`}</p></div>
            </div>
            <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <section><h3 className="font-heading font-semibold text-bd-text-heading">Capabilities</h3><ul className="mt-2 space-y-1 text-bd-text-secondary">{app.capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul></section>
              <section className="space-y-4"><div><h3 className="font-heading font-semibold text-bd-text-heading">AI use</h3><p className="mt-1 text-bd-text-secondary">{app.inference_disclosure}</p></div><div><h3 className="font-heading font-semibold text-bd-text-heading">Storage</h3><p className="mt-1 text-bd-text-secondary">{app.storage_disclosure}</p></div></section>
            </div>
            <div className="mt-6 flex flex-wrap gap-2" aria-label="Resume Builder controls">
              {app.state === "not_installed" ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("install")} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary disabled:opacity-60">{busy === "install" ? "Installing…" : "Install Resume Builder"}</button> : null}
              {app.state === "active" ? <button ref={launchButtonRef} type="button" disabled={Boolean(busy)} onClick={() => void open()} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary disabled:opacity-60">{busy === "launch" ? "Connecting…" : entryPoint === "career" ? "Continue from Career" : "Launch"}</button> : null}
              {app.state === "active" ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("disable")} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover">Disable</button> : null}
              {app.state === "disabled" ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("enable")} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary">Enable</button> : null}
              {app.state !== "not_installed" && app.package_version !== app.available_version ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("update")} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover">Update</button> : null}
              {app.state !== "not_installed" ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("uninstall")} className="rounded-lg border border-bd-danger px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover">Uninstall</button> : null}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
