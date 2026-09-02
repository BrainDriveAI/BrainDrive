import { Database, Puzzle, ShieldCheck } from "lucide-react";

import { hasInternetSearchDependency, isInternetSearchOperationId } from "@/api/apps-adapter";
import type { CapabilityDependencyStatus, InstalledPackageComponentKind, InstalledPackageComponentStatus, InstalledPackageStatus } from "@/api/apps-adapter";

const packageStateCopy: Record<string, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  updating: "Updating",
  uninstalled: "Uninstalled",
  quarantined: "Quarantined",
  failed: "Failed",
};

const componentStateCopy: Record<string, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  stopped: "Stopped",
  running: "Running",
  uninstalled: "Uninstalled",
  unavailable: "Unavailable",
  failed: "Failed",
};

const healthCopy: Record<string, string> = {
  not_applicable: "Not applicable",
  unknown: "Unknown",
  healthy: "Healthy",
  unhealthy: "Unhealthy",
};

const actionLabel: Record<string, string> = {
  enable: "Enable",
  disable: "Disable",
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  health: "Check health",
  update: "Update",
  rollback: "Roll back",
  uninstall: "Uninstall",
  launch: "Launch",
};

const targetCopy: Record<string, string> = {
  docker_linux_x64: "Docker Linux x64",
  desktop_windows_x64: "Desktop Windows x64",
  desktop_macos_universal: "Desktop macOS universal",
};

const runtimeKindCopy: Record<string, string> = {
  container: "Container",
  packaged_process: "Packaged process",
};

const kindCopy: Record<InstalledPackageComponentKind, string> = {
  app: "App surface",
  capability_provider: "Capability provider",
  dependency_service: "Dependency service",
  sidecar: "Sidecar service",
};

const readinessCopy: Record<InstalledPackageStatus["dependency_readiness"]["status"], string> = {
  ready: "Dependencies ready",
  blocked: "Required dependency blocked",
  degraded: "Optional dependency degraded",
  unknown: "Dependency readiness unknown",
};

function primaryKind(pack: InstalledPackageStatus): string {
  if (pack.package_kind.includes("capability_provider")) return "Capability provider";
  if (pack.package_kind.includes("dependency_service")) return "Dependency service";
  return "App package";
}

function hasUnsafeState(pack: InstalledPackageStatus): boolean {
  return pack.state === "failed" || pack.state === "quarantined"
    || pack.dependency_readiness.status === "blocked"
    || pack.components.some((component) => component.health === "unhealthy" || component.state === "unavailable" || component.state === "failed" || component.dependency_readiness.status === "blocked");
}

function packageActions(pack: InstalledPackageStatus): string[] {
  const launchable = pack.components.some((component) => component.launchable);
  return safeActions(pack.available_actions, launchable, pack.dependency_readiness.status);
}

function componentActions(component: InstalledPackageComponentStatus): string[] {
  return safeActions(component.owner_visible_actions, component.launchable, component.dependency_readiness.status);
}

function safeActions(actions: string[], launchable: boolean, readiness: InstalledPackageStatus["dependency_readiness"]["status"]): string[] {
  return actions.filter((action) => action !== "launch" || (launchable && readiness !== "blocked" && readiness !== "unknown"));
}

function formatValue(value: string): string {
  return value.replaceAll("_", " ");
}

function dependencyStatusText(status: InstalledPackageStatus["capability_dependency_status"][number]): string {
  const prefix = status.requirement === "required" ? "Required" : "Optional";
  const state = status.callable ? "available" : status.state;
  return `${prefix}: ${status.operation_id} - ${formatValue(state)}`;
}

function dependencyOperationIds(statuses: CapabilityDependencyStatus[]): string[] {
  return [...new Set(statuses.map((status) => status.operation_id))];
}

function readinessGuidance(statuses: CapabilityDependencyStatus[], readiness: InstalledPackageStatus["dependency_readiness"]): string {
  if (statuses.some((status) => status.state === "selection_required")) {
    return "Owner/admin provider selection is required before dependent apps can use this operation. BrainDrive will not choose a provider silently.";
  }
  if (readiness.status === "degraded") {
    return "Optional capability use is degraded; dependent apps must not present unavailable web lookup as searched or fresh.";
  }
  if (readiness.status === "unknown") {
    return "Refresh Apps or ask an owner/admin to check provider readiness before dependent apps rely on this package.";
  }
  if (readiness.status === "blocked") {
    return "A required capability is unavailable for this package.";
  }
  return "All declared dependencies are available for this package.";
}

function dependencyDetail(statuses: CapabilityDependencyStatus[]): string | null {
  const unavailable = statuses.filter((status) => !status.callable);
  if (unavailable.length === 0) return null;
  return unavailable.map((status) => status.safe_message || `${status.operation_id} is ${formatValue(status.state)}.`).join(" ");
}

export default function PackageLifecycleCard({
  pack,
  compact = false,
}: {
  pack: InstalledPackageStatus;
  compact?: boolean;
}) {
  const titleId = `package-${pack.identity.package_id}-title`;
  const unsafe = hasUnsafeState(pack);
  const operations = pack.operations.map((operation) => operation.operation_id);
  const dependencies = pack.capability_dependency_status.map(dependencyStatusText);
  const dependencyIds = dependencyOperationIds(pack.capability_dependency_status);
  const dependencyDetailText = dependencyDetail(pack.capability_dependency_status);
  const showReadiness = pack.dependency_readiness.status !== "ready" || dependencyIds.length > 0;
  const showSearchDisclosure = hasInternetSearchDependency(pack.capability_dependency_status)
    || operations.some(isInternetSearchOperationId)
    || pack.components.some((component) => component.provided_operations.some(isInternetSearchOperationId) || hasInternetSearchDependency(component.capability_dependency_status));
  const actions = packageActions(pack);

  return (
    <article className="flex h-full flex-col rounded-xl border border-bd-border bg-bd-bg-secondary p-5 sm:p-6" aria-labelledby={titleId} data-package-id={pack.identity.package_id}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-bd-bg-tertiary text-bd-amber">
            {pack.package_kind.includes("dependency_service") ? <Database aria-hidden="true" /> : <Puzzle aria-hidden="true" />}
          </div>
          <div>
            <h2 id={titleId} className="font-heading text-xl font-semibold text-bd-text-heading">{pack.identity.display_name}</h2>
            <p className="text-sm text-bd-text-secondary">By {pack.identity.publisher_id}</p>
          </div>
        </div>
        <div className="shrink-0 whitespace-nowrap text-left sm:text-right">
          <p className="whitespace-nowrap font-medium text-bd-text-primary">{packageStateCopy[pack.state] ?? pack.state}</p>
          <p className="text-xs text-bd-text-muted">Version {pack.version.installed}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-bd-text-primary">
        <span className="rounded-md border border-bd-border px-2 py-1">{primaryKind(pack)}</span>
        <span className="rounded-md border border-bd-border px-2 py-1">{pack.components.length} components</span>
        {operations.length ? <span className="rounded-md border border-bd-border px-2 py-1">{operations.length} operations</span> : null}
        {dependencies.length ? <span className="rounded-md border border-bd-border px-2 py-1">{dependencies.length} dependencies</span> : null}
      </div>

      {showReadiness ? (
        <div role={pack.dependency_readiness.status === "blocked" ? "alert" : "status"} aria-label={`${pack.identity.display_name} dependency readiness`} className={pack.dependency_readiness.status === "blocked" ? "mt-4 rounded-lg border border-bd-danger px-4 py-3 text-sm text-bd-text-primary" : "mt-4 rounded-lg border border-bd-border px-4 py-3 text-sm text-bd-text-primary"}>
          {readinessCopy[pack.dependency_readiness.status]}
          {dependencyIds.length ? `: ${dependencyIds.join(", ")}` : ""}
          <span className="block pt-1 text-xs text-bd-text-secondary">{readinessGuidance(pack.capability_dependency_status, pack.dependency_readiness)}</span>
          {dependencyDetailText ? <span className="block pt-1 text-xs text-bd-text-secondary">{dependencyDetailText}</span> : null}
        </div>
      ) : null}

      {unsafe && pack.dependency_readiness.status !== "blocked" ? (
        <div role="alert" aria-label={`${pack.identity.display_name} package health`} className="mt-4 rounded-lg border border-bd-danger px-4 py-3 text-sm text-bd-text-primary">
          Unhealthy or unavailable components need owner review before dependent apps rely on this package.
        </div>
      ) : null}
      {showSearchDisclosure ? (
        <section aria-labelledby={`${titleId}-search-disclosure`} className="mt-4 rounded-lg border border-bd-border px-4 py-3 text-sm text-bd-text-primary">
          <h3 id={`${titleId}-search-disclosure`} className="font-heading text-sm font-semibold text-bd-text-heading">Search/Read data handling</h3>
          <p className="mt-1 text-xs text-bd-text-secondary">Apps using these operations may send queries and URLs to the selected provider. Provider keys and unrelated owner data are not sent.</p>
          <p className="mt-1 text-xs text-bd-text-secondary">Owner-managed provider costs are handled outside BrainDrive. This package is not a launchable app unless the Host projection includes a launchable app component.</p>
        </section>
      ) : null}

      <section className="mt-5" aria-labelledby={`${titleId}-components`}>
        <h3 id={`${titleId}-components`} className="font-heading font-semibold text-bd-text-heading">Components</h3>
        <div className="mt-2 space-y-3">
          {pack.components.map((component) => (
            <div key={component.component_id} className="rounded-lg border border-bd-border bg-bd-bg-tertiary p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-bd-text-primary">{component.display_name}</p>
                  <p className="text-xs text-bd-text-secondary">{kindCopy[component.component_kind]} · {component.component_id}</p>
                </div>
                <p className="text-xs text-bd-text-secondary">{componentStateCopy[component.state] ?? component.state} · {healthCopy[component.health] ?? component.health}</p>
              </div>
              {component.provided_operations.length ? <p className="mt-2 break-words text-xs text-bd-text-secondary">Operations: {component.provided_operations.join(", ")}</p> : null}
              {component.capability_dependency_status.length ? <p className="mt-2 break-words text-xs text-bd-text-secondary">Dependencies: {component.capability_dependency_status.map(dependencyStatusText).join(", ")}</p> : null}
              {component.dependency_readiness.status !== "ready" ? <p className="mt-1 text-xs text-bd-text-secondary">{readinessCopy[component.dependency_readiness.status]}</p> : null}
              {component.sidecar_count > 0 ? <p className="mt-2 text-xs text-bd-text-secondary">Owns {component.sidecar_count} sidecar service{component.sidecar_count === 1 ? "" : "s"}.</p> : null}
              {component.target_support.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {component.target_support.map((target) => (
                    <span key={`${component.component_id}-${target.target}-${target.runtime_kind}`} className="rounded-md border border-bd-border px-2 py-1 text-xs text-bd-text-secondary">
                      {targetCopy[target.target] ?? target.target} · {runtimeKindCopy[target.runtime_kind] ?? formatValue(target.runtime_kind)}
                    </span>
                  ))}
                </div>
              ) : null}
              {componentActions(component).length ? (
                <div className="mt-3 flex flex-wrap gap-2" aria-label={`${component.display_name} component actions`}>
                  {componentActions(component).map((action) => (
                    <button
                      key={action}
                      type="button"
                      aria-label={`${actionLabel[action] ?? formatValue(action)} ${component.display_name}`}
                      disabled
                      className="rounded-lg border border-bd-border px-3 py-1.5 text-xs font-medium text-bd-text-primary opacity-70"
                    >
                      {actionLabel[action] ?? formatValue(action)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {!compact ? (
        <div className="mt-5 grid gap-5 text-sm sm:grid-cols-2">
          <section aria-labelledby={`${titleId}-trust`}>
            <h3 id={`${titleId}-trust`} className="flex items-center gap-2 font-heading font-semibold text-bd-text-heading"><ShieldCheck size={16} aria-hidden="true" />Trust and source</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-bd-text-secondary">
              <dt>Status</dt><dd className="text-bd-text-primary">{formatValue(pack.trust.status)}</dd>
              <dt>Source</dt><dd>{pack.source.label}</dd>
              <dt>Checked</dt><dd>{pack.trust.checked_at ?? "Not checked"}</dd>
            </dl>
          </section>
          <section aria-labelledby={`${titleId}-operations`}>
            <h3 id={`${titleId}-operations`} className="font-heading font-semibold text-bd-text-heading">Operations and dependencies</h3>
            {operations.length ? <ul className="mt-2 space-y-1 text-bd-text-secondary">{operations.map((operation) => <li key={operation}>{operation}</li>)}</ul> : <p className="mt-2 text-bd-text-secondary">No provided operations.</p>}
            {dependencies.length ? <ul className="mt-2 space-y-1 text-bd-text-secondary">{dependencies.map((dependency) => <li key={dependency}>{dependency}</li>)}</ul> : <p className="mt-2 text-bd-text-secondary">No capability dependencies.</p>}
          </section>
          <section className="sm:col-span-2" aria-labelledby={`${titleId}-retention`}>
            <h3 id={`${titleId}-retention`} className="font-heading font-semibold text-bd-text-heading">Lifecycle retention</h3>
            <p className="mt-1 text-bd-text-secondary">{formatValue(pack.retention.runtime_authority)}.</p>
            <p className="mt-1 text-bd-text-secondary">{formatValue(pack.retention.sidecar_runtime_state)}.</p>
            <p className="mt-1 text-bd-text-secondary">{formatValue(pack.retention.provider_cache)}.</p>
            <p className="mt-1 text-bd-text-secondary">{formatValue(pack.retention.diagnostics)} diagnostics.</p>
            <p className="mt-1 text-bd-text-secondary">{formatValue(pack.retention.evidence)} evidence.</p>
          </section>
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2 pt-6" aria-label={`${pack.identity.display_name} package actions`}>
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            aria-label={`${actionLabel[action] ?? formatValue(action)} ${pack.identity.display_name}`}
            disabled
            className={action === "uninstall" ? "rounded-lg border border-bd-danger px-4 py-2 text-bd-text-primary opacity-70" : "rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary opacity-70"}
          >
            {actionLabel[action] ?? formatValue(action)}
          </button>
        ))}
      </div>
    </article>
  );
}
