import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FirstPartyAppRegistrationSchema } from "../app-platform/contracts/app-registry.js";
import { BRIEF_BUILDER_FIRST_PARTY_REGISTRATION } from "../app-platform/first-party-registrations.js";
import { createBriefAppLifecycle } from "../app-platform/lifecycle/bootstrap.js";

describe("Brief Builder first-party package and registration", () => {
  it("binds exact reviewed capabilities, purpose, adapter, resource, and both platform targets", async () => {
    const registration = FirstPartyAppRegistrationSchema.parse(BRIEF_BUILDER_FIRST_PARTY_REGISTRATION);
    expect(registration).toMatchObject({ app_id: "ai.braindrive.brief-builder", publisher_id: "ai.braindrive", route_key: "brief-builder", data_adapter_registration: { binding_id: "data.brief-builder" } });
    expect(registration.capability_registrations.map((item) => item.key.name)).toEqual(["brief.records.read", "brief.records.write", "brief.approvals.confirm", "app.inference.request"]);
    expect(registration.inference_purpose_registrations).toMatchObject([{ key: { purpose_id: "brief.generate", version: 1 }, prompt_policy_id: "brief.generate.fixed.v1", validation_policy_id: "brief.grounding.v1" }]);

    const root = await mkdtemp(path.join(tmpdir(), "brief-package-"));
    const lifecycle = await createBriefAppLifecycle({ memoryRoot: path.join(root, "memory"), stateRoot: path.join(root, "host"), hostVersion: "26.7.23" });
    try {
      const verified = await lifecycle.dependencies.verifier.verifyForCatalog(lifecycle.dependencies.repository, "1.0.0", { appId: "ai.braindrive.brief-builder", publisherId: "ai.braindrive" });
      expect(verified).toMatchObject({ manifest: { app_id: "ai.braindrive.brief-builder", primary_resource: { uri: "ui://brief-builder/main" }, requested_inference_purposes: [{ purpose_id: "brief.generate", version: 1 }] }, trust: { executable_allowed: true } });
      expect(verified.manifest.platform_artifacts.map((item) => item.target).sort()).toEqual(["desktop_windows_x64", "docker_linux_x64"]);
      expect(verified.packageDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally { await lifecycle.dependencies.supervisor.close(); }

    const windowsLifecycle = await createBriefAppLifecycle({ memoryRoot: path.join(root, "windows-memory"), stateRoot: path.join(root, "windows-host"), hostVersion: "26.7.23", target: "desktop_windows_x64" });
    try {
      const verified = await windowsLifecycle.dependencies.verifier.verifyForCatalog(windowsLifecycle.dependencies.repository, "1.0.0", { appId: "ai.braindrive.brief-builder", publisherId: "ai.braindrive" });
      expect(verified).toMatchObject({ target: "desktop_windows_x64", trust: { executable_allowed: true } });
      expect(verified.manifest.platform_artifacts.find((item) => item.target === verified.target)).toMatchObject({ target: "desktop_windows_x64", os: "windows", architecture: "x64", runtime_kind: "packaged_node" });
    } finally { await windowsLifecycle.dependencies.supervisor.close(); }
  });

  it("contains no Resume/Career/render/export imports in Brief-owned code", async () => {
    const roots = [new URL(".", import.meta.url), new URL("../brief-inference/", import.meta.url), new URL("../../brief_builder/src/", import.meta.url)];
    const files: string[] = [];
    for (const url of roots) {
      const directory = url.pathname;
      for (const name of await readdir(directory)) if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(path.join(directory, name));
    }
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      expect((await stat(file)).isFile()).toBe(true);
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["'][^"']*(?:resume-domain|resume-inference|resume-renderer|career)/i);
    }
  });
});
