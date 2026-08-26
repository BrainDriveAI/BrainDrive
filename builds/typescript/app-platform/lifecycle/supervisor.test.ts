import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProcessAppSupervisor } from "./process-supervisor.js";
import { createFixtureRepository } from "./fixture-repository.js";
import { PackageVerifier } from "./package-verifier.js";
import { makeRuntimeDescriptor } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Docker process supervisor adapter", () => {
  it("starts one authenticated non-public fixture, waits for readiness, checks health, and stops without an orphan", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-supervisor-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verified = await new PackageVerifier("26.7.23").verifyAndExtract(repository, "1.0.0", path.join(root, "runtime"), "candidate_install_or_update");
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const supervisor = new ProcessAppSupervisor({ startupTimeoutMs: 5_000, stopGraceMs: 1_000, audit: (event, details) => events.push({ event, details }) });
    const descriptor = makeRuntimeDescriptor(verified);

    const started = await supervisor.start(descriptor);
    const duplicate = await supervisor.start(descriptor);
    expect(started.outcome).toBe("started");
    expect(duplicate.outcome).toBe("already_running");
    const ready = await supervisor.awaitReadiness(started.runtime!);
    expect(ready.endpoint?.public_bind).toBe(false);
    expect((await supervisor.health(started.runtime!)).state).toBe("ready");
    expect(await fetch(`${ready.endpoint!.address}/healthz`)).toHaveProperty("status", 401);

    expect((await supervisor.stop(started.runtime!, "shutdown")).termination_acknowledged).toBe(true);
    expect(supervisor.inspect(descriptor.installation_id)).toEqual([]);
    expect(events.map((entry) => entry.event)).toEqual(["app.runtime.started", "app.runtime.readiness_completed", "app.runtime.stopped"]);
    expect(JSON.stringify(events).toLowerCase()).not.toMatch(/authorization|connection_token|raw_path|resume_content|job_description|secret|credential/);
    await supervisor.close();
  });

  it("detects a crash, rotates connection authority, applies the three-restart budget, then requires owner retry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-crash-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verified = await new PackageVerifier("26.7.23").verifyAndExtract(repository, "1.0.0", path.join(root, "runtime"), "candidate_install_or_update");
    const supervisor = new ProcessAppSupervisor({ startupTimeoutMs: 5_000, stopGraceMs: 500, restartBackoffMs: [1, 1, 1], automaticRecovery: false });
    const descriptor = makeRuntimeDescriptor(verified);
    const started = await supervisor.start(descriptor);
    await supervisor.awaitReadiness(started.runtime!);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await supervisor.crashForTest(descriptor.installation_id);
      await supervisor.recoverCrashesForTest();
    }
    const inspection = supervisor.inspect(descriptor.installation_id);
    expect(inspection).toHaveLength(0);
    expect(supervisor.failureFor(descriptor.installation_id)).toBe("restart_exhausted");
    await supervisor.close();
  });

  it("automatically restarts an unexpected crash with rotated runtime and endpoint-token generations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-auto-restart-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verified = await new PackageVerifier("26.7.23").verifyAndExtract(repository, "1.0.0", path.join(root, "runtime"), "candidate_install_or_update");
    const supervisor = new ProcessAppSupervisor({ startupTimeoutMs: 5_000, stopGraceMs: 500, restartBackoffMs: [1, 1, 1] });
    const descriptor = makeRuntimeDescriptor(verified);
    const started = await supervisor.start(descriptor);
    await supervisor.awaitReadiness(started.runtime!);
    await supervisor.crashForTest(descriptor.installation_id);
    let replacement = supervisor.inspect(descriptor.installation_id)[0];
    for (let attempt = 0; attempt < 100 && !replacement; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      replacement = supervisor.inspect(descriptor.installation_id)[0];
    }
    expect(replacement.runtime_id).not.toBe(started.runtime!.runtime_id);
    expect(replacement.runtime_generation).toBe(2);
    expect(replacement.endpoint_token_generation).toBe(2);
    await supervisor.awaitReadiness(replacement);
    expect((await supervisor.health(replacement)).state).toBe("ready");
    await supervisor.close();
  });
});

describe("desktop packaged-node supervisor parity", () => {
  it("uses authenticated random loopback transport and leaves no supervised process after stop", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-desktop-supervisor-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verified = await new PackageVerifier("26.7.23", "desktop_windows_x64").verifyAndExtract(repository, "1.0.0", path.join(root, "runtime"), "candidate_install_or_update");
    const supervisor = new ProcessAppSupervisor({ startupTimeoutMs: 5_000, stopGraceMs: 1_000 });
    const descriptor = makeRuntimeDescriptor(verified);
    const started = await supervisor.start(descriptor);
    const ready = await supervisor.awaitReadiness(started.runtime!);
    expect(ready.endpoint).toMatchObject({ transport: "loopback", public_bind: false, authentication: "per_installation_token" });
    expect(ready.endpoint?.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${ready.endpoint!.address}/healthz`)).status).toBe(401);
    const connection = supervisor.connectionFor(descriptor.installation_id);
    expect((await fetch(`${ready.endpoint!.address}/healthz`, { headers: { authorization: `Bearer ${connection.authorization}` } })).status).toBe(200);
    expect((await supervisor.stop(started.runtime!, "shutdown")).termination_acknowledged).toBe(true);
    expect(supervisor.inspect(descriptor.installation_id)).toEqual([]);
    await supervisor.close();
  });
});
