import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFixtureRepository, MODERN_FIXTURE_VERSION } from "./fixture-repository.js";
import { PackageVerifier } from "./package-verifier.js";
import { ProcessAppSupervisor } from "./process-supervisor.js";
import { M2RuntimeRegistrationNegotiator } from "./runtime-negotiator.js";
import { makeRuntimeDescriptor } from "./test-helpers.js";

const roots: string[] = [];
const supervisors: ProcessAppSupervisor[] = [];

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Spec 05 M6 M2 registration gate", () => {
  it("negotiates the required modern core, Apps extension, and catalogs before returning the requested connection identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m6-negotiation-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verified = await new PackageVerifier("26.7.23").verifyAndExtract(
      repository,
      MODERN_FIXTURE_VERSION,
      path.join(root, "runtime"),
      "candidate_install_or_update",
    );
    const supervisor = new ProcessAppSupervisor({ startupTimeoutMs: 5_000, automaticRecovery: false });
    supervisors.push(supervisor);
    const descriptor = makeRuntimeDescriptor(verified);
    const started = await supervisor.start(descriptor);
    await supervisor.awaitReadiness(started.runtime!);
    const negotiator = new M2RuntimeRegistrationNegotiator();
    const connectionId = crypto.randomUUID();
    const registration = await negotiator.negotiate(supervisor.connectionFor(descriptor.installation_id), connectionId);

    expect(registration).toEqual({ connectionId, runtimeId: started.runtime!.runtime_id });
    await negotiator.close(registration);
  });

  it("does not produce registration authority for a legacy/malformed negotiation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-m6-negotiation-deny-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verified = await new PackageVerifier("26.7.23").verifyAndExtract(
      repository,
      "1.0.0",
      path.join(root, "runtime"),
      "candidate_install_or_update",
    );
    const supervisor = new ProcessAppSupervisor({ startupTimeoutMs: 5_000, automaticRecovery: false });
    supervisors.push(supervisor);
    const descriptor = makeRuntimeDescriptor(verified);
    const started = await supervisor.start(descriptor);
    await supervisor.awaitReadiness(started.runtime!);

    await expect(new M2RuntimeRegistrationNegotiator().negotiate(
      supervisor.connectionFor(descriptor.installation_id),
      crypto.randomUUID(),
    )).rejects.toBeDefined();
  });
});
