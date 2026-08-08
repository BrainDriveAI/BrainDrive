import path from "node:path";

import { auditLog } from "../../logger.js";
import { ResumeDataLifecycleAdapter } from "../../resume-domain/lifecycle.js";
import { CapabilityTokenBroker } from "./capability-token.js";
import { createFixtureRepository } from "./fixture-repository.js";
import { PackageVerifier } from "./package-verifier.js";
import { ProcessAppSupervisor } from "./process-supervisor.js";
import { AppLifecycleService } from "./service.js";
import { AppLifecycleStore } from "./store.js";

export type AppLifecycleRuntimeTarget = "docker_linux_x64" | "desktop_windows_x64";

export async function createAppLifecycle(input: { memoryRoot: string; hostVersion: string; stateRoot?: string; target?: AppLifecycleRuntimeTarget; isMemoryMigrationInProgress?: () => boolean }): Promise<AppLifecycleService> {
  const stateRoot = path.resolve(input.stateRoot ?? path.join(path.dirname(input.memoryRoot), "app-platform-host"));
  const target = input.target ?? "docker_linux_x64";
  const repository = await createFixtureRepository(path.join(stateRoot, "fixture-source"));
  const supervisor = new ProcessAppSupervisor({ audit: auditLog });
  const ownerDataRoot = path.join(input.memoryRoot, "apps", "resume-builder");
  const service = new AppLifecycleService({
    store: new AppLifecycleStore(path.join(stateRoot, "state")),
    verifier: new PackageVerifier(input.hostVersion, target),
    repository,
    supervisor,
    tokenBroker: new CapabilityTokenBroker(),
    runtimeRoot: path.join(stateRoot, "runtime"),
    ownerDataRoot,
    ownerDataLifecycle: new ResumeDataLifecycleAdapter(input.memoryRoot, ownerDataRoot, auditLog),
    isMemoryMigrationInProgress: input.isMemoryMigrationInProgress,
    runtimeTarget: target === "desktop_windows_x64"
      ? { target, runtimeKind: "packaged_node", transport: "loopback" }
      : { target, runtimeKind: "container", transport: "container_internal" },
    audit: auditLog,
  });
  await service.initialize();
  return service;
}

export const createDockerAppLifecycle = createAppLifecycle;
