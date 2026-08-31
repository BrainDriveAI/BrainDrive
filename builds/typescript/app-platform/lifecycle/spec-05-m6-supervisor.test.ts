import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createFixtureRepository, MODERN_FIXTURE_VERSION } from "./fixture-repository.js";
import { PackageVerifier } from "./package-verifier.js";
import { ProcessAppSupervisor } from "./process-supervisor.js";
import { makeRuntimeDescriptor } from "./test-helpers.js";

const roots: string[] = [];
const supervisors: ProcessAppSupervisor[] = [];

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureDescriptor(version = MODERN_FIXTURE_VERSION) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-m6-supervisor-"));
  roots.push(root);
  const repository = await createFixtureRepository(path.join(root, "source"));
  const verified = await new PackageVerifier("26.7.23").verifyAndExtract(
    repository,
    version,
    path.join(root, "runtime"),
    "candidate_install_or_update",
  );
  return { root, descriptor: makeRuntimeDescriptor(verified) };
}

async function waitForFailure(supervisor: ProcessAppSupervisor, installationId: string): Promise<void> {
  for (let attempt = 0; attempt < 300 && supervisor.failureFor(installationId) === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Spec 05 M6 process supervisor security and fault policy", () => {
  it("rejects incomplete environment authority and unresolved or mismatched entrypoints before spawn", async () => {
    const { descriptor } = await fixtureDescriptor();
    const supervisor = new ProcessAppSupervisor({ automaticRecovery: false });
    supervisors.push(supervisor);

    await expect(supervisor.start({
      ...descriptor,
      environment_keys: ["BRAINDRIVE_APP_ID"],
    })).rejects.toMatchObject({ code: "descriptor_invalid" });
    await expect(supervisor.start({ ...descriptor, resolved_entrypoint: "relative/index.js" }))
      .rejects.toMatchObject({ code: "descriptor_invalid" });
    await expect(supervisor.start({ ...descriptor, resolved_entrypoint: path.join(path.dirname(descriptor.resolved_entrypoint), "other.js") }))
      .rejects.toMatchObject({ code: "descriptor_invalid" });
    await expect(supervisor.start({
      ...descriptor,
      endpoint_policy: { ...descriptor.endpoint_policy, public_bind_allowed: true },
    } as unknown as typeof descriptor)).rejects.toMatchObject({ code: "descriptor_invalid" });
    expect(supervisor.startCount).toBe(0);
  });

  it("fails readiness and leaves no runtime when a loopback port is occupied before bind", async () => {
    const { descriptor } = await fixtureDescriptor();
    const occupied = net.createServer();
    occupied.on("connection", (socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(0, "127.0.0.1", resolve);
    });
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Occupied-port fixture did not bind TCP");
    const supervisor = new ProcessAppSupervisor({
      automaticRecovery: false,
      startupTimeoutMs: 250,
      allocatePort: async () => address.port,
    });
    supervisors.push(supervisor);
    try {
      const started = await supervisor.start(descriptor);
      await expect(supervisor.awaitReadiness(started.runtime!)).rejects.toMatchObject({ code: "readiness_failed" });
      expect(supervisor.inspect(descriptor.installation_id)).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("spawns only packaged Node plus the verified script, five declared env keys, and a private authenticated port", async () => {
    const { descriptor } = await fixtureDescriptor();
    const supervisor = new ProcessAppSupervisor({ startupTimeoutMs: 5_000, automaticRecovery: false });
    supervisors.push(supervisor);
    const started = await supervisor.start(descriptor);
    const ready = await supervisor.awaitReadiness(started.runtime!);
    const observation = supervisor.processObservationFor(descriptor.installation_id);

    expect(observation).toMatchObject({
      application_argument_count: 0,
      command_token_exposed: false,
      endpoint_class: "container_internal_authenticated",
      environment_keys: [
        "BRAINDRIVE_APP_CONNECTION_TOKEN",
        "BRAINDRIVE_APP_ID",
        "BRAINDRIVE_INSTALLATION_ID",
        "BRAINDRIVE_PACKAGE_DIGEST",
        "BRAINDRIVE_ENDPOINT_BIND",
      ],
      public_bind: false,
    });
    if (process.platform === "win32") expect(observation?.process_group_id).toBeNull();
    else expect(observation?.process_group_id).toBeTypeOf("number");
    if (process.platform === "linux") {
      const commandLine = await readFile(`/proc/${observation!.process_id}/cmdline`, "utf8");
      expect(commandLine).toContain(process.execPath);
      expect(commandLine).toContain(descriptor.resolved_entrypoint);
      expect(commandLine).not.toMatch(/Bearer|BRAINDRIVE_APP_CONNECTION_TOKEN/);
      const environmentKeys = (await readFile(`/proc/${observation!.process_id}/environ`, "utf8"))
        .split("\0")
        .filter(Boolean)
        .map((entry) => entry.slice(0, entry.indexOf("=")))
        .sort();
      expect(environmentKeys).toEqual([...observation!.environment_keys].sort());
    }
    expect((await fetch(`${ready.endpoint!.address}/healthz`)).status).toBe(401);
    const connection = supervisor.connectionFor(descriptor.installation_id);
    expect((await fetch(`${ready.endpoint!.address}/healthz`, {
      headers: { authorization: `Bearer ${connection.authorization}` },
    })).status).toBe(200);
  });

  it("revokes before exact 1/2/4 second recovery backoff and truthfully exhausts three attempts", async () => {
    const { descriptor } = await fixtureDescriptor();
    const sleeps: number[] = [];
    const revocations: number[] = [];
    const supervisor = new ProcessAppSupervisor({
      startupTimeoutMs: 5_000,
      automaticRecovery: false,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      beforeRestart: async (runtime) => { revocations.push(runtime.runtime_generation); },
    });
    supervisors.push(supervisor);
    let runtime = (await supervisor.start(descriptor)).runtime!;
    await supervisor.awaitReadiness(runtime);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await supervisor.crashForTest(descriptor.installation_id);
      await supervisor.recoverCrashesForTest();
      const observed = supervisor.inspect(descriptor.installation_id)[0];
      if (observed) {
        runtime = observed;
        await supervisor.awaitReadiness(runtime);
      }
    }

    expect(sleeps).toEqual([1_000, 2_000, 4_000]);
    expect(revocations).toEqual([1, 2, 3, 4]);
    expect(supervisor.inspect(descriptor.installation_id)).toEqual([]);
    expect(supervisor.failureFor(descriptor.installation_id)).toBe("restart_exhausted");
    expect(supervisor.diagnosticsFor(descriptor.installation_id).map((entry) => entry.state)).toContain("failed_recoverable");
  });

  it("contains log floods, stores only bounded content-free metadata, and applies the restart budget", async () => {
    const { root, descriptor } = await fixtureDescriptor();
    const flood = path.join(root, "runtime", "payload", "docker", "flood.js");
    await writeFile(flood, `setInterval(() => process.stdout.write("sensitive-canary-".repeat(128)), 1);\n`, "utf8");
    const supervisor = new ProcessAppSupervisor({
      startupTimeoutMs: 100,
      stopGraceMs: 100,
      restartBackoffMs: [1, 1, 1],
      outputLimitBytes: 4_096,
      maxDiagnosticEntries: 24,
    });
    supervisors.push(supervisor);
    await supervisor.start({ ...descriptor, verified_entrypoint: "payload/docker/flood.js", resolved_entrypoint: flood });
    await waitForFailure(supervisor, descriptor.installation_id);

    expect(supervisor.failureFor(descriptor.installation_id)).toBe("restart_exhausted");
    const diagnostics = supervisor.diagnosticsFor(descriptor.installation_id);
    expect(diagnostics.length).toBeLessThanOrEqual(24);
    expect(diagnostics.some((entry) => entry.error_code === "output_limit_exceeded")).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain("sensitive-canary");
    expect(supervisor.logSummaryFor(descriptor.installation_id)).toMatchObject({
      content_stored: false,
      limit_bytes: 4_096,
      truncated: true,
    });
  });

  it("uses forced process-group termination for a hung child without touching an unrelated process", async () => {
    const { root, descriptor } = await fixtureDescriptor();
    const hung = path.join(root, "runtime", "payload", "docker", "hung.js");
    await writeFile(hung, `import http from "node:http";
const token=process.env.BRAINDRIVE_APP_CONNECTION_TOKEN;
const port=Number(process.env.BRAINDRIVE_ENDPOINT_BIND.split(":").at(-1));
http.createServer((q,r)=>{if(q.headers.authorization!=="Bearer "+token){r.writeHead(401).end();return}r.writeHead(200,{"content-type":"application/json"});r.end('{"status":"ok"}')}).listen(port,"127.0.0.1");
process.on("SIGTERM",()=>{});\n`, "utf8");
    const supervisor = new ProcessAppSupervisor({ startupTimeoutMs: 5_000, stopGraceMs: 50, automaticRecovery: false });
    supervisors.push(supervisor);
    const started = await supervisor.start({ ...descriptor, verified_entrypoint: "payload/docker/hung.js", resolved_entrypoint: hung });
    await supervisor.awaitReadiness(started.runtime!);
    const ownPid = process.pid;
    const stopped = await supervisor.stop(started.runtime!, "shutdown");
    expect(stopped).toMatchObject({ outcome: "stopped_forced", termination_acknowledged: true });
    expect(() => process.kill(ownPid, 0)).not.toThrow();
    expect(supervisor.inspect(descriptor.installation_id)).toEqual([]);
  });

  it("cleans an exact orphaned descendant group before restart", async () => {
    if (process.platform === "win32") return;
    const { root, descriptor } = await fixtureDescriptor();
    const pidFile = path.join(root, "descendant.pid");
    const orphan = path.join(root, "runtime", "payload", "docker", "orphan.js");
    await writeFile(orphan, `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
setTimeout(()=>process.exit(9),20);\n`, "utf8");
    const supervisor = new ProcessAppSupervisor({ automaticRecovery: false, restartBackoffMs: [1, 1, 1] });
    supervisors.push(supervisor);
    await supervisor.start({ ...descriptor, verified_entrypoint: "payload/docker/orphan.js", resolved_entrypoint: orphan });
    let descendantPid = 0;
    for (let attempt = 0; attempt < 100 && descendantPid === 0; attempt += 1) {
      descendantPid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      if (!descendantPid) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(() => process.kill(descendantPid, 0)).not.toThrow();
    await supervisor.recoverCrashesForTest();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(descendantPid, 0); await new Promise((resolve) => setTimeout(resolve, 10)); }
      catch { break; }
    }
    expect(() => process.kill(descendantPid, 0)).toThrow();
    expect(supervisor.diagnosticsFor(descriptor.installation_id).map((entry) => entry.action)).toContain("revoke_before_restart");
  });
});
