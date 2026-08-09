import { useCallback, useEffect, useRef, useState } from "react";
import { AppWindow, RefreshCw, ShieldCheck } from "lucide-react";

import {
  getResumeBuilderApp,
  launchResumeBuilderApp,
  mutateResumeBuilderApp,
  type AppLaunch,
  type AppLifecycleAction,
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
  uninstalling: "Removing app authority and code",
  quarantined: "Quarantined because package trust changed",
  failed_recoverable: "Recovery required — your saved data is retained",
};

const stageCopy: Record<string, string> = {
  verifying_source: "Verifying trusted source",
  verifying_package: "Verifying signed package",
  granting: "Recording approved capabilities",
  starting: "Starting isolated app runtime",
  awaiting_readiness: "Waiting for app readiness",
  switching_active_pointer: "Committing the verified version",
  stopping: "Stopping runtime and registrations",
  revoking_tokens: "Revoking capability authority",
  clearing_references: "Clearing executable references",
  removing_package_bytes: "Removing unshared app code",
  removing_disposable_cache: "Removing disposable cache",
  recording_tombstone: "Recording retained-data evidence",
  completed: "Completed",
};

export default function AppsPage({ entryPoint = "direct" }: { entryPoint?: "direct" | "career" }) {
  const [app, setApp] = useState<ResumeBuilderAppStatus | null>(null);
  const [launch, setLaunch] = useState<AppLaunch | null>(null);
  const [busy, setBusy] = useState<AppLifecycleAction | "launch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const launchButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const uninstallButtonRef = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async () => {
    try { setApp(await getResumeBuilderApp()); setError(null); }
    catch { setError("Apps are unavailable in this BrainDrive environment."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (confirmUninstall) confirmButtonRef.current?.focus(); }, [confirmUninstall]);

  const mutate = async (action: AppLifecycleAction) => {
    if (!app || busy) return;
    setBusy(action); setError(null); setNotice(null); setLaunch(null);
    try {
      const next = await mutateResumeBuilderApp(action, app);
      setApp(next);
      if (next.request_resolution === "refreshed_after_ambiguous_response") setNotice("The response was interrupted, so BrainDrive refreshed the authoritative app status.");
    } catch {
      await refresh();
      setError("The lifecycle action was not confirmed. BrainDrive refreshed the current status; review it before retrying.");
    } finally { setBusy(null); }
  };

  const open = async () => {
    setBusy("launch"); setError(null); setNotice(null);
    try { setLaunch(await launchResumeBuilderApp(entryPoint)); }
    catch { setError("Resume Builder could not connect. Check its status and try again."); }
    finally { setBusy(null); }
  };
  const closeSession = useCallback(() => {
    setLaunch(null);
    queueMicrotask(() => launchButtonRef.current?.focus());
  }, []);
  const closeConfirmation = () => {
    setConfirmUninstall(false);
    queueMicrotask(() => uninstallButtonRef.current?.focus());
  };
  const uninstall = async () => {
    setConfirmUninstall(false);
    await mutate("uninstall");
  };

  if (launch) return <SandboxedAppFrame launch={launch} onSessionClosed={closeSession} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8" data-testid="apps-page">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[0.16em] text-bd-text-muted">Apps</p><h1 className="mt-1 font-heading text-2xl font-semibold text-bd-text-heading">Your Apps</h1></div>
          <button type="button" aria-label="Refresh app status" onClick={() => void refresh()} className="rounded-md p-2 text-bd-text-secondary hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"><RefreshCw size={18} /></button>
        </div>
        {error ? <div role="alert" className="mb-4 rounded-lg border border-bd-danger px-4 py-3 text-sm text-bd-text-primary">{error}</div> : null}
        {notice ? <div role="status" className="mb-4 rounded-lg border border-bd-amber px-4 py-3 text-sm text-bd-text-primary">{notice}</div> : null}
        {!app ? <p aria-live="polite" className="text-bd-text-secondary">Loading app status…</p> : (
          <article className="rounded-xl border border-bd-border bg-bd-bg-secondary p-5 sm:p-6" aria-labelledby="resume-builder-title">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3"><div className="rounded-lg bg-bd-bg-tertiary p-3 text-bd-amber"><AppWindow aria-hidden="true" /></div><div><h2 id="resume-builder-title" className="font-heading text-xl font-semibold text-bd-text-heading">{app.identity.display_name}</h2><p className="text-sm text-bd-text-secondary">By {app.identity.publisher_name}</p><p className="mt-1 break-all text-xs text-bd-text-muted">{app.identity.app_id}</p></div></div>
              <div className="text-left sm:text-right"><p className="font-medium text-bd-text-primary">{stateCopy[app.state] ?? app.state}</p><p className="text-xs text-bd-text-muted">{app.version.installed ? `Version ${app.version.installed}` : `Available ${app.version.available}`}</p></div>
            </div>

            {app.progress ? <div className="mt-5 rounded-lg border border-bd-border bg-bd-bg-tertiary p-4" role="status" aria-live="polite"><p className="font-medium text-bd-text-primary">{stageCopy[app.progress.stage] ?? "Lifecycle operation in progress"}</p><p className="mt-1 text-xs text-bd-text-secondary">Operation {app.progress.operation_id} · {app.progress.status}</p></div> : null}

            <div className="mt-5 grid gap-5 text-sm sm:grid-cols-2">
              <section aria-labelledby="app-trust-heading"><h3 id="app-trust-heading" className="flex items-center gap-2 font-heading font-semibold text-bd-text-heading"><ShieldCheck size={16} aria-hidden="true" />Trust and source</h3><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-bd-text-secondary"><dt>Status</dt><dd className="text-bd-text-primary">{app.trust.status.replaceAll("_", " ")}</dd><dt>Revocation</dt><dd>{app.trust.revocation_status.replaceAll("_", " ")}</dd><dt>Source</dt><dd>{app.source.label}</dd><dt>Compatibility</dt><dd>{app.compatibility.host === false ? "Host incompatible" : app.compatibility.host === true ? "Host compatible" : "Checked during install"}</dd><dt>Protocol</dt><dd>{app.compatibility.mcp_protocol}</dd></dl></section>
              <section aria-labelledby="app-capabilities-heading"><h3 id="app-capabilities-heading" className="font-heading font-semibold text-bd-text-heading">Approved capabilities</h3>{app.capabilities.granted.length ? <ul className="mt-2 space-y-1 text-bd-text-secondary">{app.capabilities.granted.map((capability) => <li key={capability}>{capability}</li>)}</ul> : <p className="mt-2 text-bd-text-secondary">Capabilities are granted only after owner approval during install.</p>}</section>
              <section className="sm:col-span-2" aria-labelledby="app-retention-heading"><h3 id="app-retention-heading" className="font-heading font-semibold text-bd-text-heading">Storage and retention</h3><p className="mt-1 text-bd-text-secondary">{app.retention.safe_message}</p><p className="mt-2 text-bd-text-secondary">Uninstall retains {app.retention.uninstall_retains.join(", ")}.</p><p className="mt-1 text-bd-text-secondary">It removes {app.retention.uninstall_removes.join(", ")}.</p></section>
            </div>

            <div className="mt-6 flex flex-wrap gap-2" aria-label="Resume Builder controls">
              {app.state === "not_installed" ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate(app.retention.retained_data_present ? "reinstall" : "install")} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary disabled:opacity-60">{busy === "install" || busy === "reinstall" ? "Verifying and installing…" : app.retention.retained_data_present ? "Reinstall Resume Builder" : "Install Resume Builder"}</button> : null}
              {app.state === "active" ? <button ref={launchButtonRef} type="button" disabled={Boolean(busy)} onClick={() => void open()} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary disabled:opacity-60">{busy === "launch" ? "Connecting…" : entryPoint === "career" ? "Continue from Career" : "Launch"}</button> : null}
              {app.state === "active" ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("disable")} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover">Disable</button> : null}
              {app.state === "disabled" ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("enable")} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary">Enable</button> : null}
              {app.recovery.available ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("recover")} className="rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary">Retry recovery</button> : null}
              {["active", "disabled"].includes(app.state) && app.version.installed !== app.version.available ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("update")} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover">Update</button> : null}
              {app.state === "active" ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate("rollback")} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover">Roll back</button> : null}
              {app.state !== "not_installed" && !["staged", "updating", "rollback_pending", "uninstalling"].includes(app.state) ? <button ref={uninstallButtonRef} type="button" disabled={Boolean(busy)} onClick={() => setConfirmUninstall(true)} className="rounded-lg border border-bd-danger px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover">Uninstall</button> : null}
            </div>
          </article>
        )}
      </div>

      {confirmUninstall ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") closeConfirmation(); if (event.key === "Tab" && event.shiftKey && document.activeElement === confirmButtonRef.current) { event.preventDefault(); cancelButtonRef.current?.focus(); } else if (event.key === "Tab" && !event.shiftKey && document.activeElement === cancelButtonRef.current) { event.preventDefault(); confirmButtonRef.current?.focus(); } }}><div role="dialog" aria-modal="true" aria-labelledby="uninstall-title" aria-describedby="uninstall-description" className="w-full max-w-lg rounded-xl border border-bd-danger bg-bd-bg-secondary p-5 shadow-xl"><h2 id="uninstall-title" className="font-heading text-lg font-semibold text-bd-text-heading">Uninstall Resume Builder?</h2><div id="uninstall-description" className="mt-3 space-y-2 text-sm text-bd-text-primary"><p>BrainDrive will stop the app, revoke its capability authority, and remove unshared app code and disposable cache.</p><p>Your career data, resume and job history, artifact metadata, owner exports, and lifecycle evidence will remain.</p></div><div className="mt-5 flex flex-wrap gap-2"><button ref={confirmButtonRef} type="button" onClick={() => void uninstall()} className="rounded-lg bg-bd-danger px-4 py-2 font-semibold text-white">Uninstall app code</button><button ref={cancelButtonRef} type="button" onClick={closeConfirmation} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary">Cancel</button></div></div></div> : null}
    </div>
  );
}
