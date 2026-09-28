import { describe, expect, it } from "vitest";

import { SUPERVISOR_POLICY } from "../contracts/package.js";
import { InstalledAppSupervisorAdapter } from "./installed-app-supervisor-adapter.js";
import { InMemoryAppSupervisor } from "./process-supervisor.js";
import { InMemoryRuntimeRegistrationNegotiator } from "./runtime-negotiator.js";
import type { ImmutablePackageStore } from "./verified-package-store.js";

const INSTALLATION_ID = "71000000-0000-4000-8000-000000000001";
const PACKAGE_DIGEST = `sha256:${"7".repeat(64)}` as const;

function harness(failPermit = false) {
  const processSupervisor = new InMemoryAppSupervisor();
  const negotiator = new InMemoryRuntimeRegistrationNegotiator();
  const tokenEvents: string[] = [];
  const packages = {
    resolveReferencedRuntime: async () => ({ contentRoot: "/fixture", entrypoint: "payload/server.js" }),
  } as unknown as ImmutablePackageStore;
  const tokenAuthority = {
    permitInstallation: () => { tokenEvents.push("permit"); if (failPermit) throw new Error("issuer failed"); },
    revokeInstallation: () => { tokenEvents.push("revoke"); },
    isRevoked: () => tokenEvents.at(-1) === "revoke",
  };
  const adapter = new InstalledAppSupervisorAdapter({ packages, processSupervisor, negotiator, tokenAuthority });
  const operationId = crypto.randomUUID();
  const descriptor = {
    supervisor_protocol_version: 1 as const,
    runtime_kind: "container" as const,
    app_id: "ai.braindrive.resume-builder" as const,
    installation_id: INSTALLATION_ID,
    package_digest: PACKAGE_DIGEST,
    grant_id: crypto.randomUUID(),
    verified_entrypoint: "payload/server.js",
    arguments: [] as [],
    environment_keys: [...([
      "BRAINDRIVE_APP_CONNECTION_TOKEN",
      "BRAINDRIVE_APP_ID",
      "BRAINDRIVE_INSTALLATION_ID",
      "BRAINDRIVE_PACKAGE_DIGEST",
      "BRAINDRIVE_ENDPOINT_BIND",
    ] as const)],
    package_root_ref: crypto.randomUUID(),
    cache_root_ref: crypto.randomUUID(),
    endpoint_policy: { transport: "container_internal" as const, authentication: "per_installation_token" as const, public_bind_allowed: false as const },
    resource_policy_version: 1 as const,
  };
  return { adapter, processSupervisor, negotiator, tokenEvents, operationId, descriptor };
}

describe("Spec 05 M6 version-1 installed-app adapter", () => {
  it("denies registration before readiness, then negotiates before token permit and maintains one exact registration", async () => {
    const test = harness();
    const started = await test.adapter.start({
      supervisor_protocol_version: 1,
      operation_id: test.operationId,
      descriptor: test.descriptor,
      policy: SUPERVISOR_POLICY,
      requested_at: new Date().toISOString(),
    });
    const premature = await test.adapter.register({
      supervisor_protocol_version: 1,
      operation_id: test.operationId,
      runtime: started.runtime!,
      endpoint: {
        endpoint_id: crypto.randomUUID(), transport: "container_internal", address: "http://fixture:8788",
        authentication: "per_installation_token", endpoint_token_generation: 1, public_bind: false,
      },
      connection_id: crypto.randomUUID(),
    });
    expect(premature.outcome).toBe("failed");
    expect(test.negotiator.calls).toEqual([]);
    expect(test.tokenEvents).toEqual([]);

    const ready = await test.adapter.awaitReady({
      supervisor_protocol_version: 1,
      operation_id: test.operationId,
      runtime: started.runtime!,
      deadline_at: new Date(Date.now() + 30_000).toISOString(),
    });
    const mismatched = await test.adapter.register({
      supervisor_protocol_version: 1,
      operation_id: test.operationId,
      runtime: started.runtime!,
      endpoint: { ...ready.endpoint!, endpoint_id: crypto.randomUUID() },
      connection_id: crypto.randomUUID(),
    });
    expect(mismatched.outcome).toBe("rejected");
    expect(test.negotiator.calls).toEqual([]);
    expect(test.tokenEvents).toEqual([]);
    const request = {
      supervisor_protocol_version: 1 as const,
      operation_id: test.operationId,
      runtime: started.runtime!,
      endpoint: ready.endpoint!,
      connection_id: crypto.randomUUID(),
    };
    const registered = await test.adapter.register(request);
    expect(registered.outcome).toBe("registered");
    expect(test.negotiator.calls.map((call) => call.action)).toEqual(["negotiate"]);
    expect(test.tokenEvents).toEqual(["permit"]);
    expect((await test.adapter.register(request))).toMatchObject({ outcome: "already_registered", registration_id: registered.registration_id });
    expect(test.adapter.registrationCount(INSTALLATION_ID)).toBe(1);

    await test.adapter.stop({
      supervisor_protocol_version: 1,
      operation_id: test.operationId,
      runtime: started.runtime!,
      reason: "disable",
      grace_deadline_at: new Date(Date.now() + 5_000).toISOString(),
    });
    expect(test.negotiator.calls.map((call) => call.action)).toEqual(["negotiate", "close"]);
    expect(test.tokenEvents).toEqual(["permit", "revoke"]);
    expect(test.adapter.registrationCount(INSTALLATION_ID)).toBe(0);
  });

  it("closes negotiated authority and registers nothing when token issuance fails", async () => {
    const test = harness(true);
    const started = await test.adapter.start({ supervisor_protocol_version: 1, operation_id: test.operationId, descriptor: test.descriptor, policy: SUPERVISOR_POLICY, requested_at: new Date().toISOString() });
    const ready = await test.adapter.awaitReady({ supervisor_protocol_version: 1, operation_id: test.operationId, runtime: started.runtime!, deadline_at: new Date(Date.now() + 30_000).toISOString() });
    const result = await test.adapter.register({ supervisor_protocol_version: 1, operation_id: test.operationId, runtime: started.runtime!, endpoint: ready.endpoint!, connection_id: crypto.randomUUID() });
    expect(result).toMatchObject({ outcome: "failed", error_code: "registration_failed" });
    expect(test.negotiator.calls.map((call) => call.action)).toEqual(["negotiate", "close"]);
    expect(test.adapter.registrationCount(INSTALLATION_ID)).toBe(0);
  });
});
