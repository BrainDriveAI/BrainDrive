import type { Ref } from "react";
import { AppWindow, Info, ShieldCheck } from "lucide-react";

import { hasInternetSearchDependency } from "@/api/apps-adapter";
import type { AppLifecycleAction, AppStatus, CapabilityDependencyStatus } from "@/api/apps-adapter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

const actionLabel: Record<string, string> = {
  install: "Install",
  reinstall: "Reinstall",
  launch: "Launch",
  disable: "Disable",
  enable: "Enable",
  recover: "Retry recovery",
  update: "Update",
  rollback: "Roll back",
  uninstall: "Uninstall",
};

const retainedDataActionLabel: Record<"delete" | "export" | "archive", string> = {
  delete: "Delete retained data",
  export: "Export retained data",
  archive: "Archive retained data",
};

const readinessCopy: Record<NonNullable<AppStatus["dependency_readiness"]>["status"], string> = {
  ready: "Dependencies ready",
  blocked: "Required dependency blocked",
  degraded: "Optional dependency degraded",
  unknown: "Dependency readiness unknown",
};

const activationActions = new Set(["install", "reinstall", "update", "enable", "launch"]);

const appDescriptionCopy: Record<string, { short: string; long: string }> = {
  "ai.braindrive.brief-builder": {
    short: "Summarize source material.",
    long: "Summarize source material into a concise, supported brief you can review, edit, and approve.",
  },
  "ai.braindrive.resume-builder": {
    short: "Build an evidence-grounded resume.",
    long: "Create, tailor, review, and export resumes using your confirmed career information.",
  },
};

function formatValue(value: string): string {
  return value.replaceAll("_", " ");
}

function dependencyOperationIds(app: AppStatus): string[] {
  const fromStatuses = app.capability_dependency_status?.map((dependency) => dependency.operation_id) ?? [];
  const fromReadiness = [
    ...(app.dependency_readiness?.blocking_operation_ids ?? []),
    ...(app.dependency_readiness?.degraded_operation_ids ?? []),
  ];
  return [...new Set([...fromStatuses, ...fromReadiness])];
}

function dependencyDetail(statuses: CapabilityDependencyStatus[] | undefined): string | null {
  const unavailable = statuses?.filter((status) => !status.callable) ?? [];
  if (unavailable.length === 0) return null;
  return unavailable.map((status) => status.safe_message || `${status.operation_id} is ${formatValue(status.state)}.`).join(" ");
}

function readinessGuidance(app: AppStatus): string {
  const statuses = app.capability_dependency_status ?? [];
  if (statuses.some((status) => status.state === "selection_required")) {
    return "Owner/admin provider selection is required before launch. BrainDrive will not choose a provider silently.";
  }
  if (app.dependency_readiness?.status === "degraded") {
    return "This app can launch only in its declared degraded mode; web lookup is unavailable and output must not be treated as searched or fresh.";
  }
  if (app.dependency_readiness?.status === "unknown") {
    return "Refresh Apps or ask an owner/admin to check provider status before launch.";
  }
  if (app.dependency_readiness?.status === "blocked") {
    return "Install, enable, or repair a compatible provider before launch.";
  }
  return "All declared dependencies are available for this app.";
}

function visibleActions(app: AppStatus): string[] {
  const readiness = app.dependency_readiness?.status;
  if (readiness === "blocked" || readiness === "unknown") {
    return (app.available_actions ?? []).filter((action) => !activationActions.has(action));
  }
  return app.available_actions ?? [];
}

export default function AppCatalogCard({
  app,
  busy,
  error,
  notice,
  compact = false,
  launchLabel,
  launchButtonRef,
  uninstallButtonRef,
  onAction,
  onRetainedDataAction,
}: {
  app: AppStatus;
  busy: AppLifecycleAction | "launch" | `retained-data:${"delete" | "export" | "archive"}` | null;
  error?: string;
  notice?: string;
  compact?: boolean;
  launchLabel?: string;
  launchButtonRef?: Ref<HTMLButtonElement>;
  uninstallButtonRef?: Ref<HTMLButtonElement>;
  onAction: (action: AppLifecycleAction | "launch") => void;
  onRetainedDataAction?: (action: "delete" | "export" | "archive") => void;
}) {
  const titleId = `app-${app.route_key}-title`;
  const actions = visibleActions(app);
  const catalog = app.catalog;
  const fallbackDescription = appDescriptionCopy[app.identity.app_id];
  const shortDescription = fallbackDescription?.short ?? catalog?.summary ?? `Open ${app.identity.display_name}.`;
  const longDescription = catalog?.summary ?? fallbackDescription?.long ?? shortDescription;
  const retainedDataControls = app.state === "not_installed" ? app.retention.post_uninstall_controls ?? [] : [];
  const dependencyReadiness = app.dependency_readiness;
  const dependencyIds = dependencyOperationIds(app);
  const dependencyDetailText = dependencyDetail(app.capability_dependency_status);
  const showDependencyReadiness = dependencyReadiness && (dependencyReadiness.status !== "ready" || dependencyIds.length > 0);
  const showSearchDisclosure = hasInternetSearchDependency(app.capability_dependency_status);

  return (
    <article className="flex h-full flex-col rounded-xl border border-bd-border bg-bd-bg-secondary p-5 sm:p-6" aria-labelledby={titleId} data-app-key={app.route_key}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-bd-bg-tertiary text-bd-amber"><AppWindow aria-hidden="true" /></div>
          <div>
            <h2 id={titleId} className="font-heading text-xl font-semibold text-bd-text-heading">{app.identity.display_name}</h2>
            <p className="text-sm text-bd-text-secondary">By {app.identity.publisher_name}</p>
            <p className="mt-1 break-all text-xs text-bd-text-muted">{app.identity.app_id}</p>
          </div>
        </div>
        <div className="shrink-0 whitespace-nowrap text-left sm:text-right">
          <p className="whitespace-nowrap font-medium text-bd-text-primary">{stateCopy[app.state] ?? app.state}</p>
          <p className="text-xs text-bd-text-muted">{app.version.installed ? `Version ${app.version.installed}` : `Available ${app.version.available}`}</p>
        </div>
      </div>

      <div className="mt-3 flex w-full items-center gap-1.5 text-sm text-bd-text-primary">
        <p>{shortDescription}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`More about ${app.identity.display_name}`} className="shrink-0 rounded-full text-bd-text-secondary hover:text-bd-text-heading focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bd-amber">
              <Info size={15} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8} className="max-w-72 leading-relaxed">
            {longDescription}
          </TooltipContent>
        </Tooltip>
      </div>

      {error ? <div role="alert" className="mt-4 rounded-lg border border-bd-danger px-4 py-3 text-sm text-bd-text-primary">{error}</div> : null}
      {notice ? <div role="status" className="mt-4 rounded-lg border border-bd-amber px-4 py-3 text-sm text-bd-text-primary">{notice}</div> : null}
      {app.availability?.status === "unavailable" ? <div role="alert" className="mt-4 rounded-lg border border-bd-danger px-4 py-3 text-sm text-bd-text-primary">{app.availability.safe_message ?? "This app is unavailable."}</div> : null}
      {showDependencyReadiness ? (
        <div role={dependencyReadiness.status === "blocked" ? "alert" : "status"} aria-label={`${app.identity.display_name} dependency readiness`} className={dependencyReadiness.status === "blocked" ? "mt-4 rounded-lg border border-bd-danger px-4 py-3 text-sm text-bd-text-primary" : "mt-4 rounded-lg border border-bd-border px-4 py-3 text-sm text-bd-text-primary"}>
          {readinessCopy[dependencyReadiness.status]}
          {dependencyIds.length ? `: ${dependencyIds.join(", ")}` : ""}
          <span className="block pt-1 text-xs text-bd-text-secondary">{readinessGuidance(app)}</span>
          {dependencyDetailText ? <span className="block pt-1 text-xs text-bd-text-secondary">{dependencyDetailText}</span> : null}
        </div>
      ) : null}
      {showSearchDisclosure ? (
        <section aria-labelledby={`${titleId}-search-disclosure`} className="mt-4 rounded-lg border border-bd-border px-4 py-3 text-sm text-bd-text-primary">
          <h3 id={`${titleId}-search-disclosure`} className="font-heading text-sm font-semibold text-bd-text-heading">Search/Read data handling</h3>
          <p className="mt-1 text-xs text-bd-text-secondary">Queries and URLs may be sent to the selected provider. Provider keys and unrelated owner data are not sent.</p>
          <p className="mt-1 text-xs text-bd-text-secondary">Owner-managed provider costs are handled outside BrainDrive; denied or revoked approval leaves Search/Read unavailable.</p>
        </section>
      ) : null}
      {app.progress ? <div className="mt-5 rounded-lg border border-bd-border bg-bd-bg-tertiary p-4" role="status" aria-live="polite"><p className="font-medium text-bd-text-primary">{stageCopy[app.progress.stage] ?? "Lifecycle operation in progress"}</p><p className="mt-1 text-xs text-bd-text-secondary">Operation {app.progress.operation_id} · {app.progress.status}</p></div> : null}

      {!compact ? <div className="mt-5 grid gap-5 text-sm sm:grid-cols-2">
        <section aria-labelledby={`${titleId}-trust`}>
          <h3 id={`${titleId}-trust`} className="flex items-center gap-2 font-heading font-semibold text-bd-text-heading"><ShieldCheck size={16} aria-hidden="true" />Trust and source</h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-bd-text-secondary">
            <dt>Status</dt><dd className="text-bd-text-primary">{app.trust.status.replaceAll("_", " ")}</dd>
            <dt>Provenance</dt><dd>{catalog?.provenance === "verified_first_party_package" ? "Verified first-party package" : "Host registration"}</dd>
            <dt>Revocation</dt><dd>{app.trust.revocation_status.replaceAll("_", " ")}</dd>
            <dt>Source</dt><dd>{app.source.label}</dd>
            <dt>Compatibility</dt><dd>{app.compatibility.host === false ? "Host incompatible" : app.compatibility.host === true ? "Host compatible" : "Checked during install"}</dd>
            <dt>Protocol</dt><dd>{app.compatibility.mcp_protocol ?? "Unavailable"}</dd>
          </dl>
        </section>
        <section aria-labelledby={`${titleId}-capabilities`}>
          <h3 id={`${titleId}-capabilities`} className="font-heading font-semibold text-bd-text-heading">Requested capabilities</h3>
          {app.capabilities.requested.length ? <ul className="mt-2 space-y-1 text-bd-text-secondary">{app.capabilities.requested.map((capability) => <li key={capability}>{capability}</li>)}</ul> : <p className="mt-2 text-bd-text-secondary">No host capabilities requested.</p>}
          {app.capability_dependency_status?.length ? <p className="mt-2 break-words text-xs text-bd-text-secondary">Dependencies: {app.capability_dependency_status.map((dependency) => `${dependency.requirement === "required" ? "Required" : "Optional"}: ${dependency.operation_id} - ${dependency.callable ? "available" : formatValue(dependency.state)}`).join(", ")}</p> : null}
          <p className="mt-2 text-xs text-bd-text-muted">{app.capabilities.granted.length} currently granted</p>
        </section>
        <section className="sm:col-span-2" aria-labelledby={`${titleId}-retention`}>
          <h3 id={`${titleId}-retention`} className="font-heading font-semibold text-bd-text-heading">Storage and retention</h3>
          <p className="mt-1 text-bd-text-secondary">{catalog?.retention_summary ?? app.retention.safe_message}</p>
          <p className="mt-2 text-bd-text-secondary">Uninstall retains {app.retention.uninstall_retains.join(", ") || "no app-owned records"}.</p>
          <p className="mt-1 text-bd-text-secondary">It removes {app.retention.uninstall_removes.join(", ") || "no host authority"}.</p>
          {retainedDataControls.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">
            {retainedDataControls.map((action) => <button
              key={action}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => onRetainedDataAction?.(action)}
              className={action === "delete" ? "rounded-lg border border-bd-danger px-3 py-1.5 text-xs font-medium text-bd-text-primary hover:bg-bd-bg-hover disabled:opacity-60" : "rounded-lg border border-bd-border px-3 py-1.5 text-xs font-medium text-bd-text-primary hover:bg-bd-bg-hover disabled:opacity-60"}
            >
              {retainedDataActionLabel[action]}
            </button>)}
          </div> : null}
          {catalog ? <p className="mt-2 break-all text-xs text-bd-text-muted">Primary resource: {catalog.primary_resource_uri}{catalog.icon ? ` · Icon: ${catalog.icon.package_path}` : ""}</p> : null}
        </section>
      </div> : null}

      <div className="mt-auto flex flex-wrap gap-2 pt-6" aria-label={`${app.identity.display_name} controls`}>
        {actions.map((action) => {
          const isPrimary = ["install", "reinstall", "launch", "enable", "recover"].includes(action);
          const label = action === "launch" && launchLabel ? launchLabel : actionLabel[action];
          if (!label) return null;
          return <button
            key={action}
            ref={action === "launch" ? launchButtonRef : action === "uninstall" ? uninstallButtonRef : undefined}
            type="button"
            aria-label={action === "launch" ? label : action === "uninstall" ? `Remove app code for ${app.identity.display_name}` : `${label} ${app.identity.display_name}`}
            disabled={Boolean(busy)}
            onClick={() => onAction(action as AppLifecycleAction | "launch")}
            className={action === "uninstall" ? "rounded-lg border border-bd-danger px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover disabled:opacity-60" : isPrimary ? "rounded-lg bg-bd-amber px-4 py-2 font-semibold text-bd-bg-primary disabled:opacity-60" : "rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover disabled:opacity-60"}
          >{busy === action ? action === "launch" ? "Connecting…" : "Working…" : label}</button>;
        })}
      </div>
    </article>
  );
}
