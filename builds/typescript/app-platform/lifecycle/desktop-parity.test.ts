import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAppLifecycle, type AppLifecycleRuntimeTarget } from "./bootstrap.js";

const roots: string[] = [];

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(child);
    else await chmod(child, 0o600).catch(() => undefined);
  }));
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  }
});

async function exercise(target: AppLifecycleRuntimeTarget) {
  const root = await mkdtemp(path.join(os.tmpdir(), `bd-${target}-parity-`));
  roots.push(root);
  const memoryRoot = path.join(root, "memory");
  const service = await createAppLifecycle({ memoryRoot, stateRoot: path.join(root, "host"), hostVersion: "26.7.23", target });
  const states: string[] = [];
  const installed = await service.install({ version: "1.0.0", idempotencyKey: `${target}-install-0001`, approveCapabilities: true });
  states.push(installed.record.state);
  const installedPackage = (await service.dependencies.store.readPackage(installed.record.active_package_digest!))!;
  expect(installedPackage.package_reference_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(installedPackage.package_root).toContain(`${path.sep}host-app-packages${path.sep}${installed.record.active_package_digest!.slice(7)}`);
  expect(installedPackage.package_root).not.toContain(`${path.sep}runtime${path.sep}staging${path.sep}`);
  await expect(readFile(path.join(installedPackage.package_root, "manifest.json"), "utf8")).resolves.toMatch(/"manifest_version":1/);
  const firstConnection = service.dependencies.supervisor.connectionFor(installed.record.installation_id!);
  expect((await fetch(firstConnection.url.replace(/\/mcp$/, "/healthz"))).status).toBe(401);
  expect((await fetch(firstConnection.url.replace(/\/mcp$/, "/healthz"), { headers: { authorization: `Bearer ${firstConnection.authorization}` } })).status).toBe(200);

  states.push((await service.disable({ idempotencyKey: `${target}-disable-0001` })).record.state);
  expect(service.dependencies.supervisor.inspect(installed.record.installation_id!)).toEqual([]);
  states.push((await service.enable({ idempotencyKey: `${target}-enable-00001` })).record.state);
  const updated = await service.update({ version: "2.0.0", idempotencyKey: `${target}-update-00001`, approveCapabilities: true });
  states.push(updated.record.state);
  expect(updated.record.last_known_good_package_digest).toBe(installed.record.active_package_digest);
  states.push((await service.rollback({ idempotencyKey: `${target}-rollback-001` })).record.state);

  const retained = path.join(service.dependencies.ownerDataRoot, "desktop-parity-sentinel.json");
  await mkdir(path.dirname(retained), { recursive: true });
  await writeFile(retained, "retained-owner-data\n", "utf8");
  states.push((await service.uninstall({ idempotencyKey: `${target}-uninstall-01` })).record.state);
  expect(service.dependencies.supervisor.inspect(installed.record.installation_id!)).toEqual([]);
  expect(await readFile(retained, "utf8")).toBe("retained-owner-data\n");
  await expect(stat(installedPackage.package_root)).rejects.toMatchObject({ code: "ENOENT" });
  const reinstalled = await service.install({ version: "1.0.0", idempotencyKey: `${target}-reinstall-01`, approveCapabilities: true });
  states.push(reinstalled.record.state);
  expect(reinstalled.record.installation_id).not.toBe(installed.record.installation_id);
  expect(reinstalled.grant?.grant_id).not.toBe(installed.grant?.grant_id);
  await service.uninstall({ idempotencyKey: `${target}-final-uninstall-01` });
  await service.dependencies.supervisor.close();
  expect(service.dependencies.supervisor.inspect(reinstalled.record.installation_id!)).toEqual([]);
  return states;
}

describe("Docker and packaged desktop lifecycle parity", () => {
  it("converges on the same states, authentication, LKG, retention, and fresh reinstall authority", async () => {
    const dockerStates = await exercise("docker_linux_x64");
    const windowsStates = await exercise("desktop_windows_x64");
    const macStates = await exercise("desktop_macos_universal");
    expect(windowsStates).toEqual(dockerStates);
    expect(macStates).toEqual(dockerStates);
    expect(macStates).toEqual(["active", "disabled", "active", "active", "active", "not_installed", "active"]);
  }, 45_000);
});
