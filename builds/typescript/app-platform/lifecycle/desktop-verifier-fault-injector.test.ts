import { describe, expect, it } from "vitest";

import { createDesktopVerifierFaultInjector } from "./desktop-verifier-fault-injector.js";

describe("desktop verifier fault injector", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(createDesktopVerifierFaultInjector({ BRAINDRIVE_DESKTOP_VERIFIER_FAULT_POINT: "network" })).toBeUndefined();
  });

  it("injects one selected failure and does not provide recovery", async () => {
    const injector = createDesktopVerifierFaultInjector({
      BRAINDRIVE_DESKTOP_VERIFIER_FAULT_INJECTION: "1",
      BRAINDRIVE_DESKTOP_VERIFIER_FAULT_POINT: "verification",
      BRAINDRIVE_DESKTOP_VERIFIER_FAULT_ACTION: "install",
    });
    expect(injector).toBeDefined();
    await expect(injector!.beforeStage({ kind: "install", stage: "verifying_source", operationId: "op-1" })).resolves.toBeUndefined();
    await expect(injector!.beforeStage({ kind: "install", stage: "verifying_package", operationId: "op-1" })).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    await expect(injector!.beforeStage({ kind: "install", stage: "verifying_package", operationId: "op-1" })).resolves.toBeUndefined();
  });
});
