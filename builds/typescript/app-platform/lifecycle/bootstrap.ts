import path from "node:path";

import { auditLog } from "../../logger.js";
import { ResumeDataLifecycleAdapter } from "../../resume-domain/lifecycle.js";
import { CapabilityTokenBroker } from "./capability-token.js";
import { createFixtureRepository, createSyntheticFirstPartyFixtureRepository } from "./fixture-repository.js";
import { PackageVerifier } from "./package-verifier.js";
import { ProcessAppSupervisor } from "./process-supervisor.js";
import { AppLifecycleService } from "./service.js";
import { AppLifecycleStore } from "./store.js";
import { migrateLegacyResumeControlState } from "./state-migration.js";
import { ImmutablePackageStore } from "./verified-package-store.js";
import { BriefDataLifecycleAdapter } from "../../brief-domain/lifecycle.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type AppLifecycleRuntimeTarget = "docker_linux_x64" | "desktop_windows_x64" | "desktop_macos_universal";

export async function createAppLifecycle(input: { memoryRoot: string; hostVersion: string; stateRoot?: string; target?: AppLifecycleRuntimeTarget; ownerActorId?: string; isMemoryMigrationInProgress?: () => boolean }): Promise<AppLifecycleService> {
  const stateRoot = path.resolve(input.stateRoot ?? path.join(path.dirname(input.memoryRoot), "app-platform-host"));
  const target = input.target ?? "docker_linux_x64";
  const repository = await createFixtureRepository(path.join(stateRoot, "fixture-source"));
  const tokenBroker = new CapabilityTokenBroker();
  const supervisor = new ProcessAppSupervisor({
    audit: auditLog,
    beforeRestart: async (runtime) => tokenBroker.revokeInstallation(runtime.installation_id),
    afterRestart: async (runtime) => tokenBroker.permitInstallation(runtime.installation_id),
  });
  const ownerDataRoot = path.join(input.memoryRoot, "apps", "resume-builder");
  const dataAdapter = new ResumeDataLifecycleAdapter(input.memoryRoot, ownerDataRoot, auditLog);
  await migrateLegacyResumeControlState({ stateRoot: path.join(stateRoot, "state"), audit: auditLog });
  const service = new AppLifecycleService({
    appIdentity: { appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive" },
    store: new AppLifecycleStore(path.join(stateRoot, "state", "apps", "resume-builder"), { appId: "ai.braindrive.resume-builder" }),
    verifier: new PackageVerifier(input.hostVersion, target),
    repository,
    supervisor,
    tokenBroker,
    immutablePackages: new ImmutablePackageStore(stateRoot),
    runtimeRoot: path.join(stateRoot, "runtime", "apps", "resume-builder"),
    ownerDataRoot,
    ownerDataLifecycle: dataAdapter,
    dataAdapter,
    isMemoryMigrationInProgress: input.isMemoryMigrationInProgress,
    ownerActorId: input.ownerActorId,
    runtimeTarget: target !== "docker_linux_x64"
      ? { target, runtimeKind: "packaged_node", transport: "loopback" }
      : { target, runtimeKind: "container", transport: "container_internal" },
    audit: auditLog,
  });
  await service.initialize();
  return service;
}

export const createDockerAppLifecycle = createAppLifecycle;

function briefResourceCandidates(): string[] {
  return [
    path.resolve(process.cwd(), "../brief_builder/resources/main.html"),
    fileURLToPath(new URL("../../../brief_builder/resources/main.html", import.meta.url)),
    fileURLToPath(new URL("../../../../brief_builder/resources/main.html", import.meta.url)),
  ];
}

export async function createBriefAppLifecycle(input: { memoryRoot: string; hostVersion: string; stateRoot?: string; target?: AppLifecycleRuntimeTarget; ownerActorId?: string; isMemoryMigrationInProgress?: () => boolean }): Promise<AppLifecycleService> {
  const stateRoot = path.resolve(input.stateRoot ?? path.join(path.dirname(input.memoryRoot), "app-platform-host"));
  const target = input.target ?? "docker_linux_x64";
  const resourcePath = briefResourceCandidates().find((candidate) => existsSync(candidate));
  if (!resourcePath) throw new Error("Brief Builder UI package resource is missing");
  const repository = await createSyntheticFirstPartyFixtureRepository(path.join(stateRoot, "fixture-source-brief"), [{
    appId: "ai.braindrive.brief-builder", routeKey: "brief-builder", displayName: "Brief Builder", version: "1.2.0",
    summary: "Summarize source material into a concise, supported brief you can review, edit, and approve.",
    resourceHtml: await readFile(resourcePath, "utf8"),
    requestedCapabilities: ["brief.records.read", "brief.records.write", "brief.approvals.confirm", "app.inference.request", "web.search", "web.read"],
    requestedInferencePurposes: [{ purpose_id: "brief.generate", version: 1 }],
  }]);
  const tokenBroker = new CapabilityTokenBroker();
  const supervisor = new ProcessAppSupervisor({
    audit: auditLog,
    beforeRestart: async (runtime) => tokenBroker.revokeInstallation(runtime.installation_id),
    afterRestart: async (runtime) => tokenBroker.permitInstallation(runtime.installation_id),
  });
  const ownerDataRoot = path.join(input.memoryRoot, "apps", "brief-builder");
  const dataAdapter = new BriefDataLifecycleAdapter(input.memoryRoot, ownerDataRoot);
  const service = new AppLifecycleService({
    appIdentity: { appId: "ai.braindrive.brief-builder", publisherId: "ai.braindrive" },
    store: new AppLifecycleStore(path.join(stateRoot, "state", "apps", "brief-builder"), { appId: "ai.braindrive.brief-builder" }),
    verifier: new PackageVerifier(input.hostVersion, target), repository, supervisor, tokenBroker,
    immutablePackages: new ImmutablePackageStore(stateRoot), runtimeRoot: path.join(stateRoot, "runtime", "apps", "brief-builder"),
    ownerDataRoot, ownerDataLifecycle: dataAdapter, dataAdapter,
    isMemoryMigrationInProgress: input.isMemoryMigrationInProgress, ownerActorId: input.ownerActorId,
    runtimeTarget: target !== "docker_linux_x64" ? { target, runtimeKind: "packaged_node", transport: "loopback" } : { target, runtimeKind: "container", transport: "container_internal" },
    audit: auditLog,
  });
  await service.initialize();
  return service;
}
