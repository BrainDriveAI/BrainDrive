import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";

import {
  getApp,
  getAppCatalog,
  launchApp,
  launchAppChatWorkspace,
  mutateApp,
  runRetainedAppDataAction,
  type AppLaunch,
  type AppPresentationProfileSummary,
  type AppLifecycleAction,
  type AppStatus,
  type InstalledPackageStatus,
} from "@/api/apps-adapter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import AppChatWorkspace from "./AppChatWorkspace";
import AppCatalogCard from "./AppCatalogCard";
import PackageLifecycleCard from "./PackageLifecycleCard";
import SandboxedAppFrame from "./SandboxedAppFrame";

type RetainedDataAction = "delete" | "export" | "archive";
type BusyState = AppLifecycleAction | "launch" | `retained-data:${RetainedDataAction}`;
type SelectedSession = { appKey: string; appId: string; appName: string; launch: AppLaunch };

function replaceApp(apps: AppStatus[], next: AppStatus): AppStatus[] {
  return apps.map((candidate) => candidate.route_key === next.route_key ? next : candidate);
}

function primaryChatPresentation(app: AppStatus): Extract<AppPresentationProfileSummary, { type: "chat_workspace" }> | null {
  const presentations = app.catalog?.presentations;
  if (!presentations) return null;
  const defaultProfile = presentations.profiles.find((profile) => profile.presentation_id === presentations.default_presentation_id);
  if (defaultProfile?.type === "chat_workspace" && defaultProfile.owner_visibility !== "internal") return defaultProfile;
  return presentations.profiles.find((profile): profile is Extract<AppPresentationProfileSummary, { type: "chat_workspace" }> =>
    profile.type === "chat_workspace" && profile.owner_visibility === "primary"
  ) ?? null;
}

function isChatWorkspaceLaunch(launch: AppLaunch): launch is Extract<AppLaunch, { kind: "chat_workspace" }> {
  return launch.kind === "chat_workspace";
}

export default function AppsPage({
  entryPoint = "direct",
  onOpenSettings,
  onSessionClosed,
  onWorkspaceActiveChange,
  onLogout,
  tier = "local",
}: {
  entryPoint?: "direct" | "career";
  onOpenSettings?: () => void;
  onSessionClosed?: () => void;
  onWorkspaceActiveChange?: (active: boolean) => void;
  onLogout?: () => void;
  tier?: "local" | "concierge";
}) {
  const [apps, setApps] = useState<AppStatus[] | null>(null);
  const [packages, setPackages] = useState<InstalledPackageStatus[] | null>(null);
  const [selected, setSelected] = useState<SelectedSession | null>(null);
  const [busyByApp, setBusyByApp] = useState<Record<string, BusyState | undefined>>({});
  const [errorsByApp, setErrorsByApp] = useState<Record<string, string | undefined>>({});
  const [noticesByApp, setNoticesByApp] = useState<Record<string, string | undefined>>({});
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [compactCards, setCompactCards] = useState(true);
  const [confirmUninstallKey, setConfirmUninstallKey] = useState<string | null>(null);
  const launchButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const uninstallButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const catalog = await getAppCatalog();
      setApps(catalog.apps);
      setPackages(catalog.packages ?? []);
      setCatalogError(null);
    } catch {
      setApps((current) => current ?? []);
      setPackages((current) => current ?? []);
      setCatalogError("Apps are unavailable in this BrainDrive environment.");
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (confirmUninstallKey) confirmButtonRef.current?.focus(); }, [confirmUninstallKey]);
  useEffect(() => {
    onWorkspaceActiveChange?.(Boolean(selected));
    return () => onWorkspaceActiveChange?.(false);
  }, [onWorkspaceActiveChange, selected]);

  const setAppBusy = (appKey: string, value?: BusyState) => setBusyByApp((current) => ({ ...current, [appKey]: value }));
  const setAppError = (appKey: string, value?: string) => setErrorsByApp((current) => ({ ...current, [appKey]: value }));
  const setAppNotice = (appKey: string, value?: string) => setNoticesByApp((current) => ({ ...current, [appKey]: value }));

  const mutate = async (app: AppStatus, action: AppLifecycleAction) => {
    if (busyByApp[app.route_key]) return;
    setAppBusy(app.route_key, action); setAppError(app.route_key); setAppNotice(app.route_key);
    try {
      const next = await mutateApp(app.route_key, action, app);
      setApps((current) => current ? replaceApp(current, next) : current);
      if (next.request_resolution === "refreshed_after_ambiguous_response") setAppNotice(app.route_key, "The response was interrupted, so BrainDrive refreshed this app's authoritative status.");
    } catch {
      try {
        const refreshed = await getApp(app.route_key);
        setApps((current) => current ? replaceApp(current, refreshed) : current);
      } catch { /* Keep the last safe catalog projection. */ }
      setAppError(app.route_key, "The lifecycle action was not confirmed. BrainDrive refreshed this app's status; review it before retrying.");
    } finally { setAppBusy(app.route_key); }
  };

  const retainedDataAction = async (app: AppStatus, action: RetainedDataAction) => {
    if (busyByApp[app.route_key] || app.state !== "not_installed") return;
    setAppBusy(app.route_key, `retained-data:${action}`); setAppError(app.route_key); setAppNotice(app.route_key);
    try {
      const result = await runRetainedAppDataAction(app.route_key, action, app);
      const refreshed = await getApp(app.route_key);
      setApps((current) => current ? replaceApp(current, refreshed) : current);
      setAppNotice(app.route_key, action === "delete"
        ? "Retained app data was deleted and an audit tombstone was recorded."
        : `Retained app data was ${result.action === "archive" ? "archived" : "exported"} and remains unavailable to uninstalled app code.`);
    } catch {
      try {
        const refreshed = await getApp(app.route_key);
        setApps((current) => current ? replaceApp(current, refreshed) : current);
      } catch { /* Keep the last safe catalog projection. */ }
      setAppError(app.route_key, "The retained-data action was not confirmed. BrainDrive refreshed this app's status; review it before retrying.");
    } finally { setAppBusy(app.route_key); }
  };

  const open = async (app: AppStatus) => {
    if (busyByApp[app.route_key]) return;
    setAppBusy(app.route_key, "launch"); setAppError(app.route_key); setAppNotice(app.route_key);
    try {
      const chatPresentation = primaryChatPresentation(app);
      const launch = chatPresentation
        ? await launchAppChatWorkspace(app.route_key, { presentationId: chatPresentation.presentation_id, workspaceId: chatPresentation.workspace_id })
        : await launchApp(app.route_key, entryPoint);
      setSelected({ appKey: app.route_key, appId: app.identity.app_id, appName: app.identity.display_name, launch });
    } catch {
      setAppError(app.route_key, `${app.identity.display_name} could not connect. Check its status and try again.`);
    } finally { setAppBusy(app.route_key); }
  };

  const closeSession = useCallback(() => {
    const appKey = selected?.appKey;
    setSelected(null);
    onSessionClosed?.();
    if (appKey) queueMicrotask(() => launchButtonRefs.current.get(appKey)?.focus());
  }, [onSessionClosed, selected?.appKey]);

  const reloadSession = useCallback(async () => {
    if (!selected) return;
    const launch = isChatWorkspaceLaunch(selected.launch)
      ? await launchAppChatWorkspace(selected.appKey, {
          presentationId: selected.launch.presentation.presentation_id,
          workspaceId: selected.launch.workspace.workspace_id,
          resume: selected.launch,
        })
      : await launchApp(selected.appKey, "direct", selected.launch);
    setSelected((current) => current ? { ...current, launch } : current);
  }, [selected]);

  const closeConfirmation = () => {
    const appKey = confirmUninstallKey;
    setConfirmUninstallKey(null);
    if (appKey) queueMicrotask(() => uninstallButtonRefs.current.get(appKey)?.focus());
  };

  const uninstallApp = apps?.find((app) => app.route_key === confirmUninstallKey) ?? null;
  const confirmUninstall = async () => {
    if (!uninstallApp) return;
    setConfirmUninstallKey(null);
    await mutate(uninstallApp, "uninstall");
  };

  if (selected) return isChatWorkspaceLaunch(selected.launch)
    ? <AppChatWorkspace appKey={selected.appKey} appName={selected.appName} launch={selected.launch} onSessionClosed={closeSession} onOpenSettings={onOpenSettings} onLogout={onLogout} tier={tier} />
    : <SandboxedAppFrame appKey={selected.appKey} appId={selected.appId} appName={selected.appName} launch={selected.launch} onSessionClosed={closeSession} onReload={reloadSession} onOpenSettings={onOpenSettings} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8" data-testid="apps-page">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[0.16em] text-bd-text-muted">Apps</p><h1 className="mt-1 font-heading text-2xl font-semibold text-bd-text-heading">Your Apps</h1></div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={compactCards ? "Show detailed cards" : "Show compact cards"} aria-pressed={compactCards} onClick={() => setCompactCards((current) => !current)} className="rounded-md p-2 text-bd-text-secondary hover:bg-bd-bg-hover hover:text-bd-text-heading focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber">
                  {compactCards ? <Maximize2 size={18} aria-hidden="true" /> : <Minimize2 size={18} aria-hidden="true" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>{compactCards ? "Show detailed cards" : "Show compact cards"}</TooltipContent>
            </Tooltip>
            <button type="button" aria-label="Refresh app catalog" onClick={() => void refresh()} className="rounded-md p-2 text-bd-text-secondary hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"><RefreshCw size={18} /></button>
          </div>
        </div>
        {catalogError ? <div role="alert" className="mb-4 rounded-lg border border-bd-danger px-4 py-3 text-sm text-bd-text-primary">{catalogError}</div> : null}
        {!apps || !packages ? <p aria-live="polite" className="text-bd-text-secondary">Loading app catalog…</p> : (
          <div className="space-y-8">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" data-testid="app-catalog">
              {apps.map((app) => <AppCatalogCard
                key={app.route_key}
                app={app}
                busy={busyByApp[app.route_key] ?? null}
                error={errorsByApp[app.route_key]}
                notice={noticesByApp[app.route_key]}
                compact={compactCards}
                launchLabel={primaryChatPresentation(app)?.label}
                launchButtonRef={(node) => { if (node) launchButtonRefs.current.set(app.route_key, node); else launchButtonRefs.current.delete(app.route_key); }}
                uninstallButtonRef={(node) => { if (node) uninstallButtonRefs.current.set(app.route_key, node); else uninstallButtonRefs.current.delete(app.route_key); }}
                onAction={(action) => { if (action === "launch") void open(app); else if (action === "uninstall") setConfirmUninstallKey(app.route_key); else void mutate(app, action); }}
                onRetainedDataAction={(action) => void retainedDataAction(app, action)}
              />)}
            </div>
            {packages.length > 0 ? (
              <section aria-labelledby="apps-packages-heading">
                <h2 id="apps-packages-heading" className="mb-3 font-heading text-lg font-semibold text-bd-text-heading">Installed packages</h2>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" data-testid="package-catalog">
                  {packages.map((pack) => <PackageLifecycleCard key={pack.identity.package_id} pack={pack} compact={compactCards} />)}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>

      {uninstallApp ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") closeConfirmation(); if (event.key === "Tab" && event.shiftKey && document.activeElement === confirmButtonRef.current) { event.preventDefault(); cancelButtonRef.current?.focus(); } else if (event.key === "Tab" && !event.shiftKey && document.activeElement === cancelButtonRef.current) { event.preventDefault(); confirmButtonRef.current?.focus(); } }}><div role="dialog" aria-modal="true" aria-labelledby="uninstall-title" aria-describedby="uninstall-description" className="w-full max-w-lg rounded-xl border border-bd-danger bg-bd-bg-secondary p-5 shadow-xl"><h2 id="uninstall-title" className="font-heading text-lg font-semibold text-bd-text-heading">Uninstall {uninstallApp.identity.display_name}?</h2><div id="uninstall-description" className="mt-3 space-y-2 text-sm text-bd-text-primary"><p>BrainDrive will remove {uninstallApp.retention.uninstall_removes.join(", ") || "the app's runtime authority"}.</p><p>BrainDrive will retain {uninstallApp.retention.uninstall_retains.join(", ") || "no app-owned records"}.</p></div><div className="mt-5 flex flex-wrap gap-2"><button ref={confirmButtonRef} type="button" onClick={() => void confirmUninstall()} className="rounded-lg bg-bd-danger px-4 py-2 font-semibold text-white">Uninstall app code</button><button ref={cancelButtonRef} type="button" onClick={closeConfirmation} className="rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary">Cancel</button></div></div></div> : null}
    </div>
  );
}
