import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("does not terminate a ready runtime after one transient health-probe timeout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-transient-health-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verified = await new PackageVerifier("26.7.23").verifyAndExtract(repository, "1.0.0", path.join(root, "runtime"), "candidate_install_or_update");
    await chmod(verified.entrypoint, 0o700);
    await writeFile(verified.entrypoint, `import http from "node:http";
const token = process.env.BRAINDRIVE_APP_CONNECTION_TOKEN;
const port = Number(process.env.BRAINDRIVE_ENDPOINT_BIND.split(":").at(-1));
let healthCount = 0;
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== "Bearer " + token) { response.writeHead(401).end(); return; }
  if (request.url !== "/healthz") { response.writeHead(404).end(); return; }
  healthCount += 1;
  const reply = () => { response.writeHead(200, { "content-type": "application/json" }); response.end('{"status":"ok"}'); };
  if (healthCount === 2) setTimeout(reply, 75); else reply();
});
server.listen(port, "127.0.0.1");
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop); process.on("SIGINT", stop);\n`, "utf8");
    const supervisor = new ProcessAppSupervisor({
      startupTimeoutMs: 5_000,
      stopGraceMs: 500,
      healthIntervalMs: 20,
      healthProbeTimeoutMs: 10,
      healthFailureThreshold: 3,
      restartBackoffMs: [1, 1, 1],
    });
    const descriptor = makeRuntimeDescriptor(verified);
    const started = await supervisor.start(descriptor);
    await supervisor.awaitReadiness(started.runtime!);

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(supervisor.inspect(descriptor.installation_id)).toEqual([started.runtime]);
    expect((await supervisor.health(started.runtime!)).state).toBe("ready");
    await supervisor.close();
  });

  it("terminates a persistently unhealthy runtime only at the consecutive-failure threshold", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-persistent-health-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verified = await new PackageVerifier("26.7.23").verifyAndExtract(repository, "1.0.0", path.join(root, "runtime"), "candidate_install_or_update");
    const healthCountPath = path.join(root, "health-count.txt");
    await chmod(verified.entrypoint, 0o700);
    await writeFile(verified.entrypoint, `import { writeFileSync } from "node:fs";
import http from "node:http";
const token = process.env.BRAINDRIVE_APP_CONNECTION_TOKEN;
const port = Number(process.env.BRAINDRIVE_ENDPOINT_BIND.split(":").at(-1));
let healthCount = 0;
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== "Bearer " + token) { response.writeHead(401).end(); return; }
  if (request.url !== "/healthz") { response.writeHead(404).end(); return; }
  healthCount += 1;
  writeFileSync(${JSON.stringify(healthCountPath)}, String(healthCount));
  const reply = () => { response.writeHead(200, { "content-type": "application/json" }); response.end('{"status":"ok"}'); };
  if (healthCount === 1) reply(); else setTimeout(reply, 250);
});
server.listen(port, "127.0.0.1");
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop); process.on("SIGINT", stop);\n`, "utf8");
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const supervisor = new ProcessAppSupervisor({
      startupTimeoutMs: 5_000,
      stopGraceMs: 500,
      healthIntervalMs: 50,
      healthProbeTimeoutMs: 10,
      healthFailureThreshold: 3,
      restartBackoffMs: [1_000, 1_000, 1_000],
      audit: (event, details) => events.push({ event, details }),
    });
    const descriptor = makeRuntimeDescriptor(verified);
    const started = await supervisor.start(descriptor);
    await supervisor.awaitReadiness(started.runtime!);
    const waitForHealthCount = async (minimum: number) => {
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const count = Number(await readFile(healthCountPath, "utf8").catch(() => "0"));
        if (count >= minimum) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error(`Health probe ${minimum} was not observed`);
    };

    await waitForHealthCount(2);
    expect(supervisor.inspect(descriptor.installation_id)).toEqual([started.runtime]);
    await waitForHealthCount(3);
    expect(supervisor.inspect(descriptor.installation_id)).toEqual([started.runtime]);
    await waitForHealthCount(4);
    for (let attempt = 0; attempt < 100 && supervisor.inspect(descriptor.installation_id).length > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(supervisor.inspect(descriptor.installation_id)).toEqual([]);
    expect(events.filter((entry) => entry.event === "app.runtime.health_changed")).toHaveLength(1);
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
