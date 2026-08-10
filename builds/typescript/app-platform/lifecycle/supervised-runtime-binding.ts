import type { CapabilityTokenBroker } from "./capability-token.js";
import {
  InstalledAppSupervisorAdapter,
  type InstalledAppSupervisorAdapterOptions,
} from "./installed-app-supervisor-adapter.js";
import type { InstallationGrantStore } from "./install-grants.js";
import { ProcessAppSupervisor } from "./process-supervisor.js";
import type { ImmutablePackageStore } from "./verified-package-store.js";

export type SupervisedRuntimeTarget = "docker_linux_x64" | "desktop_windows_x64";

export type SupervisedRuntimeBinding = {
  target: SupervisedRuntimeTarget;
  runtimeKind: "container" | "packaged_node";
  transport: "container_internal" | "loopback";
  supervisor: InstalledAppSupervisorAdapter;
  processSupervisor: ProcessAppSupervisor;
};

type BindingInput = {
  target: SupervisedRuntimeTarget;
  packages: ImmutablePackageStore;
  grants: InstallationGrantStore;
  tokenAuthority: Pick<CapabilityTokenBroker, "revokeInstallation" | "permitInstallation" | "isRevoked">;
  ids?: InstalledAppSupervisorAdapterOptions["ids"];
  clock?: () => Date;
  audit?: (event: string, details: Record<string, unknown>) => void;
  negotiator?: InstalledAppSupervisorAdapterOptions["negotiator"];
  process?: {
    startupTimeoutMs?: number;
    stopGraceMs?: number;
    automaticRecovery?: boolean;
  };
};

/** Shared M4 Docker/Tauri binding over the one accepted Spec 05 process supervisor. */
export function createSupervisedRuntimeBinding(input: BindingInput): SupervisedRuntimeBinding {
  let installedSupervisor: InstalledAppSupervisorAdapter | null = null;
  const processSupervisor = new ProcessAppSupervisor({
    ...input.process,
    audit: input.audit,
    beforeRestart: async (runtime) => {
      if (installedSupervisor) await installedSupervisor.runtimeLost(runtime);
      else input.tokenAuthority.revokeInstallation(runtime.installation_id);
    },
    afterRestart: async (runtime, endpoint) => {
      if (!installedSupervisor) throw new Error("Installed-app adapter is unavailable");
      await installedSupervisor.runtimeRecovered(runtime, endpoint);
    },
  });
  const supervisor = new InstalledAppSupervisorAdapter({
    packages: input.packages,
    processSupervisor,
    target: input.target,
    grants: input.grants,
    tokenAuthority: input.tokenAuthority,
    ids: input.ids,
    clock: input.clock,
    audit: input.audit,
    negotiator: input.negotiator,
  });
  installedSupervisor = supervisor;
  const desktop = input.target === "desktop_windows_x64";
  return {
    target: input.target,
    runtimeKind: desktop ? "packaged_node" : "container",
    transport: desktop ? "loopback" : "container_internal",
    supervisor,
    processSupervisor,
  };
}
