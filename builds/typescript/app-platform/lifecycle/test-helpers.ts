import path from "node:path";

import { CapabilityTokenBroker } from "./capability-token.js";
import { createFixtureRepository, createSyntheticFirstPartyFixtureRepository } from "./fixture-repository.js";
import { PackageVerifier, type VerifiedPackage } from "./package-verifier.js";
import { InMemoryAppSupervisor, type RuntimeLaunchDescriptor } from "./process-supervisor.js";
import { AppLifecycleService, type LifecycleDependencies } from "./service.js";
import { AppLifecycleStore, type CapabilityGrant } from "./store.js";

export function makeGrant(): CapabilityGrant {
  const now = new Date().toISOString();
  const actorId = crypto.randomUUID();
  return {
    grant_version: 1,
    grant_revision: 1,
    revocation_generation: 0,
    grant_id: crypto.randomUUID(),
    owner_id: crypto.randomUUID(),
    actor_id: actorId,
    app_id: "ai.braindrive.resume-builder",
    publisher_id: "ai.braindrive",
    package_digest: `sha256:${"a".repeat(64)}`,
    installation_id: crypto.randomUUID(),
    capabilities: ["career.context.read"],
    record_scopes: [],
    decision: { decision_id: crypto.randomUUID(), decided_by_actor_id: actorId, decided_at: now, outcome: "approved" },
    issued_at: now,
    expires_at: "2036-01-01T00:00:00.000Z",
    revoked_at: null,
  } satisfies CapabilityGrant;
}

export function makeRuntimeDescriptor(verified: VerifiedPackage): RuntimeLaunchDescriptor {
  const desktop = verified.target !== "docker_linux_x64";
  const artifact = verified.manifest.platform_artifacts.find((candidate) => candidate.target === verified.target)!;
  return {
    supervisor_protocol_version: 1,
    runtime_kind: desktop ? "packaged_node" : "container",
    app_id: "ai.braindrive.resume-builder",
    installation_id: crypto.randomUUID(),
    package_digest: verified.packageDigest,
    grant_id: crypto.randomUUID(),
    verified_entrypoint: artifact.entrypoint,
    arguments: [],
    environment_keys: ["BRAINDRIVE_APP_CONNECTION_TOKEN", "BRAINDRIVE_APP_ID", "BRAINDRIVE_INSTALLATION_ID", "BRAINDRIVE_PACKAGE_DIGEST", "BRAINDRIVE_ENDPOINT_BIND"],
    package_root_ref: crypto.randomUUID(),
    cache_root_ref: crypto.randomUUID(),
    endpoint_policy: { transport: desktop ? "loopback" : "container_internal", authentication: "per_installation_token", public_bind_allowed: false },
    resource_policy_version: 1,
    resolved_entrypoint: verified.entrypoint,
  };
}

export async function createLifecycleHarness(root: string, app?: { appId: string; routeKey: string; displayName: string }) {
  const appId = app?.appId ?? "ai.braindrive.resume-builder";
  const store = new AppLifecycleStore(path.join(root, "state"), { appId });
  const repository = app
    ? await createSyntheticFirstPartyFixtureRepository(path.join(root, "source"), [{ ...app, version: "1.0.0" }])
    : await createFixtureRepository(path.join(root, "source"));
  const supervisor = new InMemoryAppSupervisor();
  const tokenBroker = new CapabilityTokenBroker();
  const ownerDataRoot = path.join(root, "owner-data");
  const dependencies: LifecycleDependencies = {
    appIdentity: { appId, publisherId: "ai.braindrive" },
    store,
    repository,
    verifier: new PackageVerifier("26.7.23"),
    supervisor,
    tokenBroker,
    runtimeRoot: path.join(root, "runtime"),
    ownerDataRoot,
    ownerDataLifecycle: {
      retainedClasses: app
        ? ["app_owner_data", "lifecycle_tombstone"]
        : ["career_data", "resume_history", "job_history", "artifact_metadata", "owner_exports", "lifecycle_tombstone"],
      prepareActivation: async () => undefined,
      cleanupDefaultUninstall: async () => undefined,
    },
  };
  const service = new AppLifecycleService(dependencies);
  await service.initialize();
  return { service, store, repository, supervisor, tokenBroker, ownerDataRoot, dependencies };
}
